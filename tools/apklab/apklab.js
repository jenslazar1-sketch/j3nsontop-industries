#!/usr/bin/env node
/* J3NSONTOP INDUSTRIES - apklab CLI
 *
 * The desktop half of APK LAB. It deliberately shares the *exact* engine the
 * Android app runs (../../app/src/main/assets/js), so there is one AXML
 * decoder, one dex reader and one zip writer in this project rather than two
 * that drift apart. Running this CLI is therefore also the regression test for
 * what ships on the phone.
 *
 * What the desktop adds over the phone: signing and verification, which need a
 * keystore and the Android SDK build-tools.
 *
 *   apklab info    app.apk
 *   apklab decode  app.apk -o out/
 *   apklab patch   app.apk --label "NEW" --version-code 7 -o new.apk
 *   apklab build   out/ -o new.apk
 *   apklab sign    new.apk
 *   apklab verify  new.apk
 *   apklab strings app.apk
 *   apklab diff    a.apk b.apk
 *   apklab selftest
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const ENGINE = path.resolve(__dirname, '../../app/src/main/assets/js');
const B = require(path.join(ENGINE, 'binary.js'));
const Z = require(path.join(ENGINE, 'zip.js'));
const X = require(path.join(ENGINE, 'axml.js'));
const D = require(path.join(ENGINE, 'dex.js'));
const C = require(path.join(ENGINE, 'cert.js'));

/* ------------------------------------------------------------------ paint */

const TTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n, s) => TTY ? `\x1b[${n}m${s}\x1b[0m` : String(s);
const acid = s => c('92', s), cyan = s => c('96', s), mag = s => c('95', s);
const dim = s => c('90', s), red = s => c('91', s), amber = s => c('93', s), bold = s => c('1', s);

function head(t) { console.log('\n' + bold(acid('▚ ' + t))); }
function kv(k, v) { console.log('  ' + dim((k + ' ').padEnd(16, '·')) + ' ' + v); }
function die(msg) { console.error(red('✕ ' + msg)); process.exit(1); }

/* --------------------------------------------------------- sdk discovery */

function sdkRoot() {
  const cands = [
    process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'AppData/Local/Android/Sdk'),
    path.join(os.homedir(), 'Library/Android/sdk'),
    path.join(os.homedir(), 'Android/Sdk')
  ].filter(Boolean);
  // local.properties wins if the project has one - that is what Gradle uses.
  const lp = path.resolve(__dirname, '../../local.properties');
  if (fs.existsSync(lp)) {
    const m = /^sdk\.dir=(.+)$/m.exec(fs.readFileSync(lp, 'utf8'));
    if (m) cands.unshift(m[1].replace(/\\\\/g, '\\').replace(/\\:/g, ':').trim());
  }
  return cands.find(p => { try { return fs.statSync(path.join(p, 'build-tools')).isDirectory(); } catch (e) { return false; } });
}

let _bt = undefined;
function buildTools() {
  if (_bt !== undefined) return _bt;
  const root = sdkRoot();
  if (!root) return (_bt = null);
  const versions = fs.readdirSync(path.join(root, 'build-tools'))
    .filter(v => /^\d+/.test(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return (_bt = versions.length ? path.join(root, 'build-tools', versions[versions.length - 1]) : null);
}

function tool(name) {
  const bt = buildTools();
  if (!bt) return null;
  for (const ext of ['.bat', '.exe', '']) {
    const p = path.join(bt, name + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function run(bin, args, opts) {
  // apksigner ships as a .bat on Windows, and since the CVE-2024-27980 fix
  // Node refuses to spawn .bat/.cmd unless a shell is involved. Going through
  // the shell means quoting every argument ourselves - SDK paths have spaces.
  const batch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(bin);
  const q = s => /[\s"&|<>^()]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
  // One pre-quoted command string rather than an args array: with shell:true
  // an array trips Node's DEP0190 warning on every single call.
  const r = batch
    ? spawnSync([q(bin)].concat(args.map(q)).join(' '), { encoding: 'utf8', shell: true, ...opts })
    : spawnSync(bin, args, { encoding: 'utf8', ...opts });
  return {
    ok: r.status === 0 && !r.error,
    out: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error.message) : ''),
    code: r.status
  };
}

/* ------------------------------------------------------------------ read */

function readApk(file) {
  if (!fs.existsSync(file)) die(`No such file: ${file}`);
  const bytes = new Uint8Array(fs.readFileSync(file));
  let zip;
  try { zip = Z.open(bytes); } catch (e) { die(`${path.basename(file)}: ${e.message}`); }
  return { file, bytes, zip };
}

async function analyse(apk) {
  const out = { manifest: null, arsc: null, dexes: [], certs: [], warn: [] };

  if (apk.zip.has('resources.arsc')) {
    try { out.arsc = X.parseArsc(await apk.zip.read('resources.arsc')); }
    catch (e) { out.warn.push('resources.arsc: ' + e.message); }
  }
  if (apk.zip.has('AndroidManifest.xml')) {
    try { out.manifest = X.parseXml(await apk.zip.read('AndroidManifest.xml')); }
    catch (e) { out.warn.push('AndroidManifest.xml: ' + e.message); }
  }
  for (const e of apk.zip.entries.filter(e => /^classes\d*\.dex$/.test(e.name))) {
    try { out.dexes.push({ name: e.name, size: e.usize, dex: D.parse(await apk.zip.read(e)) }); }
    catch (err) { out.warn.push(e.name + ': ' + err.message); }
  }

  for (const b of apk.zip.signing.blocks) {
    if (b.id === 0x7109871a || b.id === 0xf05368c0) {
      try { C.certsFromSigBlock(b.data).forEach(x => { x.scheme = b.name; out.certs.push(x); }); } catch (e) { }
    }
  }
  for (const e of apk.zip.entries.filter(e => /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(e.name))) {
    try { C.certsFromPkcs7(await apk.zip.read(e)).forEach(x => { x.scheme = 'v1 (JAR)'; out.certs.push(x); }); } catch (err) { }
  }
  // collapse the same key appearing once per scheme
  const seen = new Map();
  out.certs = out.certs.filter(x => {
    const k = x.serial + '|' + x.subject;
    if (seen.has(k)) { seen.get(k).schemes.push(x.scheme); return false; }
    x.schemes = [x.scheme]; seen.set(k, x); return true;
  });
  for (const x of out.certs) x.fp = await C.fingerprints(x.der);

  return out;
}

function identity(a) {
  if (!a.manifest) return {};
  const root = a.manifest.root;
  const app = X.children(root, 'application')[0];
  const sdk = X.children(root, 'uses-sdk')[0];
  let label = app ? X.attrValue(a.manifest, app, 'label') : null;
  // android:label is nearly always a reference, and attrValue renders it as a
  // bare id, so resolve it through the resource table to get the real name.
  if (label && a.arsc) {
    const hex = /^@0x([0-9a-f]+)$/i.exec(label);
    if (hex) {
      label = a.arsc.stringOf(parseInt(hex[1], 16)) || label;
    } else if (label.startsWith('@string/')) {
      const key = label.slice(8);
      for (const id of Object.keys(a.arsc.byId)) {
        const e = a.arsc.byId[id];
        if (e.type === 'string' && e.key === key) { label = a.arsc.stringOf(+id) || label; break; }
      }
    }
  }
  return {
    pkg: X.attrValue(a.manifest, root, 'package') || (a.arsc && a.arsc.packageName),
    versionCode: X.attrValue(a.manifest, root, 'versionCode'),
    versionName: X.attrValue(a.manifest, root, 'versionName'),
    minSdk: sdk && X.attrValue(a.manifest, sdk, 'minSdkVersion'),
    targetSdk: sdk && X.attrValue(a.manifest, sdk, 'targetSdkVersion'),
    label,
    debuggable: app && X.attrValue(a.manifest, app, 'debuggable'),
    app, root
  };
}

const perms = a => a.manifest
  ? X.children(a.manifest.root, 'uses-permission')
      .map(e => X.attrValue(a.manifest, e, 'name')).filter(Boolean).sort()
  : [];

/* ------------------------------------------------------------ cmd: info */

async function cmdInfo(args) {
  const apk = readApk(args._[0] || die('usage: apklab info <apk>'));
  const a = await analyse(apk);
  const id = identity(a);

  head(path.basename(apk.file));
  kv('Size', B.human(apk.bytes.length) + dim(`  (${apk.bytes.length} bytes)`));
  kv('Package', acid(id.pkg || '?'));
  kv('Label', id.label || dim('—'));
  kv('Version', `${id.versionName || '?'} ${dim('code ' + (id.versionCode || '?'))}`);
  kv('SDK', `min ${id.minSdk || '?'} → target ${id.targetSdk || '?'}`);
  kv('Entries', apk.zip.entries.length);
  if (id.debuggable === 'true') kv('Debuggable', red('YES — never ship this'));

  head('Signing');
  const schemes = apk.zip.signing.schemes.slice();
  if (apk.zip.entries.some(e => /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(e.name))) schemes.unshift('v1 (JAR)');
  kv('Schemes', schemes.length ? cyan(schemes.join(', ')) : red('unsigned'));
  for (const x of a.certs) {
    kv('Subject', x.subject);
    kv('Valid', `${x.notBefore?.toISOString().slice(0, 10)} → ${x.notAfter?.toISOString().slice(0, 10)}` +
      (x.expired ? red('  EXPIRED') : ''));
    kv('Key', `${x.sigAlg} · ${x.keyAlg} ${x.keyBits}-bit`);
    if (x.fp) kv('SHA-256', dim(x.fp.sha256.toLowerCase()));
  }

  head(`Permissions (${perms(a).length})`);
  if (!perms(a).length) console.log('  ' + dim('none'));
  for (const p of perms(a)) console.log('  ' + (/(SMS|CONTACTS|LOCATION|CAMERA|RECORD_AUDIO|CALL|STORAGE|ACCESSIBILITY|INSTALL_PACKAGES)/.test(p) ? amber('⚠ ' + p) : dim('· ') + p));

  if (a.dexes.length) {
    head('Code');
    let cls = 0, meth = 0;
    for (const d of a.dexes) {
      kv(d.name, `${d.dex.counts.classes} classes · ${d.dex.counts.methods} methods · ${B.human(d.size)}`);
      cls += d.dex.counts.classes; meth += d.dex.counts.methods;
    }
    kv('Total', `${cls} classes, ${meth} method refs` + (meth > 60000 ? amber('  near the 65536 dex limit') : ''));
  }

  if (a.warn.length) { head('Warnings'); a.warn.forEach(w => console.log('  ' + amber(w))); }
  console.log();
}

/* ---------------------------------------------------------- cmd: decode */

async function cmdDecode(args) {
  const apk = readApk(args._[0] || die('usage: apklab decode <apk> -o <dir>'));
  const dir = args.o || args.out || (apk.file.replace(/\.(apk|aab|jar|zip)$/i, '') + '-decoded');
  const a = await analyse(apk);

  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const e of apk.zip.entries) {
    if (e.isDir) continue;
    const dest = path.join(dir, e.name);
    if (!path.resolve(dest).startsWith(path.resolve(dir))) continue;   // zip-slip
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await apk.zip.read(e)));
    n++;
  }

  // The readable copies sit alongside the originals so `build` can repack the
  // directory untouched and still produce a working APK.
  if (a.manifest) {
    fs.writeFileSync(path.join(dir, 'AndroidManifest.decoded.xml'),
      X.toXml(a.manifest, { resolve: a.arsc ? a.arsc.resolve : null }));
  }
  if (a.arsc) {
    const lines = Object.keys(a.arsc.byId).map(id => {
      const e = a.arsc.byId[id];
      const v = a.arsc.stringOf(+id);
      return `0x${(+id).toString(16)}  @${e.type}/${e.key}` + (v ? `  = ${JSON.stringify(v)}` : '');
    }).sort();
    fs.writeFileSync(path.join(dir, 'resources.decoded.txt'),
      `# ${a.arsc.packageName} · ${lines.length} resources\n` + lines.join('\n') + '\n');
  }
  for (const d of a.dexes) {
    const out = [`# ${d.name} · dex ${d.dex.version} · ${d.dex.counts.classes} classes`];
    for (let i = 0; i < d.dex.classes.length; i++) {
      const ci = d.dex.classInfo(i);
      out.push('');
      out.push(`${ci.modifiers} ${ci.isInterface ? 'interface' : 'class'} ${ci.name}` +
        (ci.superName && ci.superName !== 'java.lang.Object' ? ` extends ${ci.superName}` : '') +
        (ci.interfaces.length ? ` implements ${ci.interfaces.join(', ')}` : '') + ' {');
      ci.fields.forEach(f => out.push(`    ${f.modifiers} ${f.type} ${f.name};`));
      ci.methods.forEach(m => out.push(`    ${m.modifiers} ${m.ret} ${m.name}(${m.args.join(', ')})` +
        (m.hasCode ? `   // ${m.insns} insns` : ';')));
      out.push('}');
    }
    fs.writeFileSync(path.join(dir, d.name + '.txt'), out.join('\n') + '\n');
  }

  head('Decoded');
  kv('Into', dir);
  kv('Files', n);
  if (a.manifest) kv('Manifest', 'AndroidManifest.decoded.xml');
  if (a.arsc) kv('Resources', 'resources.decoded.txt');
  a.dexes.forEach(d => kv('Code', d.name + '.txt'));
  console.log('\n' + dim('  Edit what you want, then: ') + acid(`apklab build ${dir} -o new.apk`));
  console.log(dim('  For Java source, if jadx is installed: ') + acid(`apklab jadx ${apk.file}`) + '\n');
}

/* ----------------------------------------------------------- cmd: build */

async function cmdBuild(args) {
  const dir = args._[0] || die('usage: apklab build <dir> -o <apk>');
  if (!fs.existsSync(dir)) die(`No such directory: ${dir}`);
  const out = args.o || args.out || 'rebuilt.apk';

  const items = [];
  (function walk(d, rel) {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const r = rel ? rel + '/' + name : name;
      if (fs.statSync(full).isDirectory()) { walk(full, r); continue; }
      // our own readable dumps are not part of the package
      if (/\.decoded\.(xml|txt)$/.test(r) || /^classes\d*\.dex\.txt$/.test(r)) continue;
      if (/^META-INF\/.*\.(RSA|DSA|EC|SF|MF)$/i.test(r)) continue;
      items.push({ name: r, data: new Uint8Array(fs.readFileSync(full)) });
    }
  }(dir, ''));

  if (!items.length) die('Nothing to pack');
  const bytes = await Z.build(items, {});
  fs.writeFileSync(out, Buffer.from(bytes));

  head('Built');
  kv('Output', out);
  kv('Entries', items.length);
  kv('Size', B.human(bytes.length));
  kv('Signature', amber('stripped — sign before installing'));
  console.log('\n' + dim('  Next: ') + acid(`apklab sign ${out}`) + '\n');
}

/* ----------------------------------------------------------- cmd: patch */

async function cmdPatch(args) {
  const apk = readApk(args._[0] || die('usage: apklab patch <apk> [--label X] [--version-name X] [--version-code N] [--debuggable on|off] [--add-perm P] [--rm-perm P] -o <apk>'));
  const out = args.o || args.out || apk.file.replace(/\.apk$/i, '') + '-patched.apk';
  const a = await analyse(apk);
  if (!a.manifest) die('This archive has no readable AndroidManifest.xml');

  const id = identity(a);
  const changes = [];

  if (args.label && id.app) { X.setString(id.app, 'label', args.label); changes.push('label = ' + args.label); }
  if (args['version-name']) { X.setString(id.root, 'versionName', args['version-name']); changes.push('versionName = ' + args['version-name']); }
  if (args['version-code']) { X.setInt(id.root, 'versionCode', parseInt(args['version-code'], 10)); changes.push('versionCode = ' + args['version-code']); }
  if (args.debuggable && id.app) {
    const on = /^(1|on|true|yes)$/i.test(args.debuggable);
    X.setBool(id.app, 'debuggable', on);
    changes.push('debuggable = ' + on);
  }
  if (args.cleartext && id.app) {
    const on = /^(1|on|true|yes)$/i.test(args.cleartext);
    X.setBool(id.app, 'usesCleartextTraffic', on);
    changes.push('usesCleartextTraffic = ' + on);
  }
  for (const p of [].concat(args['add-perm'] || [])) {
    if (perms(a).includes(p)) continue;
    a.manifest.root.children.unshift({
      name: 'uses-permission', nsUri: null, line: 1, children: [],
      attrs: [{ name: 'name', nsUri: X.ANDROID_NS, resId: 0x01010003, type: X.T.STRING, data: 0, raw: p }]
    });
    changes.push('+ permission ' + p);
  }
  for (const p of [].concat(args['rm-perm'] || [])) {
    const before = a.manifest.root.children.length;
    a.manifest.root.children = a.manifest.root.children.filter(ch =>
      !(ch.name === 'uses-permission' && X.attrValue(a.manifest, ch, 'name') === p));
    if (a.manifest.root.children.length !== before) changes.push('− permission ' + p);
  }

  if (!changes.length) die('Nothing to change — pass at least one option');

  const newManifest = X.encode(a.manifest);
  const items = [];
  for (const e of apk.zip.entries) {
    if (e.isDir) continue;
    if (/^META-INF\/.*\.(RSA|DSA|EC|SF|MF)$/i.test(e.name)) continue;
    if (e.name === 'AndroidManifest.xml') { items.push({ name: e.name, data: newManifest }); continue; }
    items.push({ name: e.name, rawData: apk.zip.raw(e).slice(), method: e.method,
                 crc: e.crc, usize: e.usize, date: e.date });
  }
  const bytes = await Z.build(items, {});
  fs.writeFileSync(out, Buffer.from(bytes));

  head('Patched');
  changes.forEach(ch => console.log('  ' + acid('✓ ') + ch));
  kv('Output', out);
  kv('Size', B.human(bytes.length));
  console.log('\n' + dim('  Signature was stripped. Next: ') + acid(`apklab sign ${out}`) + '\n');
}

/* ------------------------------------------------------------ cmd: sign */

function cmdSign(args) {
  const file = args._[0] || die('usage: apklab sign <apk> [--ks keystore] [--ks-pass p] [--alias a] [--key-pass p]');
  if (!fs.existsSync(file)) die(`No such file: ${file}`);

  const apksigner = tool('apksigner');
  const zipalign = tool('zipalign');
  if (!apksigner) die('apksigner not found. Install the Android SDK build-tools, or set ANDROID_HOME.');

  const ks = args.ks || path.join(os.homedir(), '.android/debug.keystore');
  const ksPass = args['ks-pass'] || 'android';
  const alias = args.alias || 'androiddebugkey';
  const keyPass = args['key-pass'] || ksPass;
  if (!fs.existsSync(ks)) {
    die(`Keystore not found: ${ks}\n  Make one with:\n  keytool -genkeypair -v -keystore my.jks -alias mykey -keyalg RSA -keysize 2048 -validity 10000`);
  }

  // zipalign first: apksigner refuses to align, and an unaligned APK installs
  // but then mmaps badly at runtime.
  let target = file;
  if (zipalign) {
    const aligned = file.replace(/\.apk$/i, '') + '-aligned.apk';
    const r = run(zipalign, ['-f', '-p', '4', file, aligned]);
    if (r.ok) { target = aligned; } else { console.log(amber('  zipalign failed, signing as-is: ' + r.out.trim())); }
  }

  const out = args.o || args.out || file.replace(/\.apk$/i, '') + '-signed.apk';
  const r = run(apksigner, ['sign', '--ks', ks, '--ks-pass', 'pass:' + ksPass,
    '--key-pass', 'pass:' + keyPass, '--ks-key-alias', alias, '--out', out, target]);

  if (target !== file) { try { fs.unlinkSync(target); } catch (e) { } }
  if (!r.ok) die('apksigner failed:\n' + r.out);

  head('Signed');
  kv('Output', out);
  kv('Keystore', ks === path.join(os.homedir(), '.android/debug.keystore') ? dim('debug key (side-loading only)') : ks);
  kv('Size', B.human(fs.statSync(out).size));
  console.log('\n' + dim('  Check it: ') + acid(`apklab verify ${out}`) + '\n');
}

/* ---------------------------------------------------------- cmd: verify */

async function cmdVerify(args) {
  const file = args._[0] || die('usage: apklab verify <apk>');
  const apk = readApk(file);
  const a = await analyse(apk);

  head('Verify ' + path.basename(file));

  const zipalign = tool('zipalign');
  if (zipalign) {
    const r = run(zipalign, ['-c', '-p', '4', file]);
    kv('Alignment', r.ok ? acid('OK') : red('NOT ALIGNED'));
  } else kv('Alignment', dim('zipalign not found — skipped'));

  const apksigner = tool('apksigner');
  if (apksigner) {
    const r = run(apksigner, ['verify', '-v', file]);
    const schemes = (r.out.match(/Verified using (v\d[^:]*): (true|false)/g) || [])
      .filter(s => s.endsWith('true')).map(s => s.match(/(v[\d.]+)/)[1]);
    kv('Signature', r.ok ? acid('VERIFIES ') + dim('(' + (schemes.join(', ') || '?') + ')') : red('FAILS'));
    if (!r.ok) console.log(dim(r.out.split('\n').slice(0, 6).map(l => '    ' + l).join('\n')));
  } else kv('Signature', dim('apksigner not found — skipped'));

  // our own structural pass, independent of the SDK
  let bad = 0;
  for (const e of apk.zip.entries) {
    if (e.isDir) continue;
    try { if (B.crc32(await apk.zip.read(e)) !== e.crc) bad++; } catch (err) { bad++; }
  }
  kv('Entries', bad ? red(`${bad} of ${apk.zip.entries.length} corrupt`) : acid(`all ${apk.zip.entries.length} readable`));
  kv('Manifest', a.manifest ? acid('parses') : red('unreadable'));
  const arsc = apk.zip.get('resources.arsc');
  if (arsc) {
    const off = apk.zip.locate(arsc);
    kv('resources.arsc', (arsc.method === 0 ? acid('stored') : red('COMPRESSED — will fail on API 30+')) +
      dim(' @' + off) + (off % 4 === 0 ? acid(' aligned') : red(' MISALIGNED')));
  }
  console.log();
}

/* --------------------------------------------------------- cmd: strings */

async function cmdStrings(args) {
  const apk = readApk(args._[0] || die('usage: apklab strings <apk>'));
  const a = await analyse(apk);
  const merged = {};
  for (const d of a.dexes) {
    const r = d.dex.scanStrings({ cap: 2000 });
    for (const k of Object.keys(r.buckets)) merged[k] = (merged[k] || []).concat(r.buckets[k]);
  }
  const LABEL = { url: 'URLs', host: 'Hostnames', ip: 'IP addresses', secret: 'Possible secrets',
                  path: 'File paths', sql: 'SQL', intent: 'Android actions', b64: 'Base64 blobs' };
  for (const k of ['url', 'host', 'ip', 'secret', 'path', 'sql', 'intent', 'b64']) {
    if (!merged[k] || !merged[k].length) continue;
    const uniq = [...new Set(merged[k])].sort();
    head(`${LABEL[k]} (${uniq.length})`);
    uniq.forEach(s => console.log('  ' + s));
  }
  console.log();
}

/* ------------------------------------------------------------ cmd: diff */

async function cmdDiff(args) {
  const [fa, fb] = args._;
  if (!fa || !fb) die('usage: apklab diff <a.apk> <b.apk>');
  const A = readApk(fa), Bk = readApk(fb);
  const ia = identity(await analyse(A)), ib = identity(await analyse(Bk));

  head('Identity');
  for (const k of ['pkg', 'label', 'versionName', 'versionCode', 'minSdk', 'targetSdk']) {
    const va = ia[k] ?? '—', vb = ib[k] ?? '—';
    kv(k, va === vb ? dim(va) : `${red(va)} → ${acid(vb)}`);
  }

  const ma = new Map(A.zip.entries.map(e => [e.name, e]));
  const mb = new Map(Bk.zip.entries.map(e => [e.name, e]));
  const added = [...mb.keys()].filter(n => !ma.has(n));
  const removed = [...ma.keys()].filter(n => !mb.has(n));
  const changed = [...ma.keys()].filter(n => mb.has(n) && ma.get(n).crc !== mb.get(n).crc);

  head(`Entries  ${acid('+' + added.length)} ${red('−' + removed.length)} ${amber('~' + changed.length)}`);
  added.slice(0, 40).forEach(n => console.log('  ' + acid('+ ') + n));
  removed.slice(0, 40).forEach(n => console.log('  ' + red('− ') + n));
  changed.slice(0, 40).forEach(n => console.log('  ' + amber('~ ') + n +
    dim(`  ${B.human(ma.get(n).usize)} → ${B.human(mb.get(n).usize)}`)));
  const more = added.length + removed.length + changed.length - 120;
  if (more > 0) console.log(dim(`  …and ${more} more`));
  console.log();
}

/* ------------------------------------------------------------ cmd: jadx */

function cmdJadx(args) {
  const file = args._[0] || die('usage: apklab jadx <apk>');
  const which = run(process.platform === 'win32' ? 'where' : 'which', ['jadx']);
  if (!which.ok) {
    die('jadx is not on PATH.\n' +
        '  It is the tool for bytecode → Java, which this project does not reimplement.\n' +
        '  Get it from https://github.com/skylot/jadx/releases and put jadx/bin on PATH.');
  }
  const out = args.o || args.out || file.replace(/\.apk$/i, '') + '-src';
  console.log(dim(`  jadx -d ${out} ${file}`));
  const r = spawnSync('jadx', ['-d', out, file], { stdio: 'inherit' });
  if (r.status !== 0) die('jadx exited ' + r.status);
  head('Decompiled'); kv('Into', out); console.log();
}

/* -------------------------------------------------------- cmd: selftest */

async function cmdSelftest() {
  let pass = 0, fail = 0;
  const t = (name, cond, detail) => {
    if (cond) { pass++; console.log('  ' + acid('✓ ') + name); }
    else { fail++; console.log('  ' + red('✕ ') + name + (detail ? dim('  ' + detail) : '')); }
  };

  head('Engine selftest');

  // inflate: both paths must agree, on data that exercises back-references
  const src = B.toUtf8('J3NSONTOP '.repeat(400) + JSON.stringify(process.versions));
  const packed = await B.deflate(src);
  t('deflate available', !!packed);
  if (packed) {
    const viaNative = await B.inflate(packed, src.length);
    const viaJs = B.inflateRaw(packed, src.length);
    t('native inflate round-trips', B.crc32(viaNative) === B.crc32(src));
    t('pure-JS inflate round-trips', B.crc32(viaJs) === B.crc32(src));
    t('both inflaters agree', B.crc32(viaNative) === B.crc32(viaJs));
  }

  t('crc32 of "123456789" is 0xCBF43926', B.crc32(B.toUtf8('123456789')) === 0xCBF43926,
    '0x' + B.crc32(B.toUtf8('123456789')).toString(16));

  // attribute table
  const A = require(path.join(ENGINE, 'attrs.js'));
  t('attr table loaded', A.count > 1000, A.count + ' entries');
  t('0x01010003 is android:name', A.name(0x01010003) === 'name');
  t('android:label is 0x01010001', A.id('label') === 0x01010001);

  // zip + axml + dex against a real APK if one is around
  const apks = [];
  const outDir = path.resolve(__dirname, '../../app/build/outputs/apk');
  (function scan(d) {
    if (!fs.existsSync(d)) return;
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) scan(p);
      else if (/\.apk$/i.test(n)) apks.push(p);
    }
  }(outDir));

  if (!apks.length) {
    console.log('  ' + amber('· no built APK found — run gradlew assembleDebug for the full test'));
  } else {
    const apk = readApk(apks[0]);
    console.log(dim('  against ' + path.basename(apk.file)));
    let bad = 0;
    for (const e of apk.zip.entries) {
      if (e.isDir) continue;
      try { if (B.crc32(await apk.zip.read(e)) !== e.crc) bad++; } catch (err) { bad++; }
    }
    t('every entry inflates with a matching CRC', bad === 0, bad + ' bad');

    const a = await analyse(apk);
    t('manifest decodes', !!a.manifest);
    t('resources.arsc parses', !!a.arsc);
    t('dex parses', a.dexes.length > 0);
    t('certificate reads', a.certs.length > 0);

    if (a.manifest) {
      // the one that matters: re-encode must survive a round trip unchanged
      const xml1 = X.toXml(a.manifest);
      const doc2 = X.parseXml(X.encode(a.manifest));
      t('AXML re-encode round-trips identically', xml1 === X.toXml(doc2));
    }

    // rebuild must stay aligned
    const items = [];
    for (const e of apk.zip.entries) {
      if (e.isDir) continue;
      items.push({ name: e.name, data: await apk.zip.read(e) });
    }
    const rebuilt = Z.open(await Z.build(items, {}));
    const arsc = rebuilt.get('resources.arsc');
    t('rebuild keeps every entry', rebuilt.entries.length === items.length);
    if (arsc) {
      t('rebuild stores resources.arsc', arsc.method === 0);
      t('rebuild 4-byte aligns resources.arsc', rebuilt.locate(arsc) % 4 === 0);
    }
  }

  head(fail ? red(`${fail} failed, ${pass} passed`) : acid(`all ${pass} checks passed`));
  console.log();
  process.exit(fail ? 1 : 0);
}

/* ------------------------------------------------------------------ cli */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      let val = eq > 0 ? a.slice(eq + 1) : (argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : true);
      // repeatable flags (--add-perm) collect instead of overwrite
      if (out[key] !== undefined) out[key] = [].concat(out[key], val);
      else out[key] = val;
    } else if (a === '-o') out.o = argv[++i];
    else out._.push(a);
  }
  return out;
}

const USAGE = `
${bold(acid('J3NSONTOP APK LAB'))} ${dim('— decompile, inspect, patch, repack, sign')}

  ${acid('apklab info')}    <apk>                      identity, permissions, certs, code
  ${acid('apklab decode')}  <apk> [-o dir]             unpack + readable manifest/resources/classes
  ${acid('apklab build')}   <dir> [-o apk]             repack a decoded folder, zipalign-correct
  ${acid('apklab patch')}   <apk> [options] [-o apk]   rewrite the manifest without unpacking
  ${acid('apklab sign')}    <apk> [--ks ...]           zipalign + apksigner (debug key by default)
  ${acid('apklab verify')}  <apk>                      alignment, signature, CRCs, arsc placement
  ${acid('apklab strings')} <apk>                      URLs, hosts, secrets from the dex pools
  ${acid('apklab diff')}    <a.apk> <b.apk>            what changed between two builds
  ${acid('apklab jadx')}    <apk>                      hand off to jadx for Java source
  ${acid('apklab selftest')}                           verify the engine against a real APK

${dim('patch options')}
  --label "NEW NAME"        --version-name 2.1      --version-code 12
  --debuggable on|off       --cleartext on|off
  --add-perm android.permission.INTERNET            (repeatable)
  --rm-perm  android.permission.CAMERA              (repeatable)

${dim('sign options')}
  --ks path.jks  --ks-pass secret  --alias mykey  --key-pass secret

${dim('The engine is shared with the Android app: app/src/main/assets/js')}
`;

const CMDS = {
  info: cmdInfo, decode: cmdDecode, build: cmdBuild, patch: cmdPatch,
  sign: cmdSign, verify: cmdVerify, strings: cmdStrings, diff: cmdDiff,
  jadx: cmdJadx, selftest: cmdSelftest
};

(async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') { console.log(USAGE); return; }
  if (!CMDS[cmd]) { console.log(USAGE); die(`Unknown command: ${cmd}`); }
  try { await CMDS[cmd](parseArgs(argv)); }
  catch (e) { die(e.stack || e.message); }
}());
