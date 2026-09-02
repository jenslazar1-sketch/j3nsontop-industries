#!/usr/bin/env node
/* J3NSONTOP INDUSTRIES - selftest.js
 *
 * Runs the whole analysis path under Node, with WebCrypto deleted so the
 * environment matches React Native's. Nothing here needs a device, an emulator
 * or a Metro bundle — the engines and analyse.js are deliberately free of any
 * React Native import, so the parsing half of the app is testable on a desktop.
 *
 *   node scripts/selftest.js                 # built-in vectors only
 *   node scripts/selftest.js path/to/app.apk # plus a real end-to-end analysis
 *
 * Exit code is non-zero if anything fails, so it drops straight into CI.
 */
'use strict';

// Match React Native: no WebCrypto. Must happen before the engines load.
delete globalThis.crypto;

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

let pass = 0;
let fail = 0;

function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra ? '\n        ' + extra : '')); }
}

function section(name) { console.log('\n' + name); }

const hex = (b) => Buffer.from(b).toString('hex');
const enc = (t) => new Uint8Array(Buffer.from(t, 'utf8'));

/* ------------------------------------------------------------ crypto shim */

section('crypto shim (React Native has no WebCrypto)');
const shim = require('../engines/cryptoShim.js');

ok('SHA-256 empty', hex(shim.sha256(enc(''))) ===
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
ok('SHA-256 "abc"', hex(shim.sha256(enc('abc'))) ===
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
ok('SHA-1 "abc"', hex(shim.sha1(enc('abc'))) ===
  'a9993e364706816aba3e25717850c26c9cd0d89d');
ok('SHA-256 multi-block (1e6 x "a")', hex(shim.sha256(enc('a'.repeat(1000000)))) ===
  'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');

let digestFail = 0;
for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 127, 128, 129, 1000, 4096]) {
  const buf = nodeCrypto.randomBytes(n);
  const u = new Uint8Array(buf);
  if (hex(shim.sha256(u)) !== nodeCrypto.createHash('sha256').update(buf).digest('hex')) digestFail++;
  if (hex(shim.sha1(u)) !== nodeCrypto.createHash('sha1').update(buf).digest('hex')) digestFail++;
}
ok('differential vs node crypto (14 block-boundary lengths)', digestFail === 0, digestFail + ' mismatches');
ok('installed as global crypto.subtle.digest',
  typeof globalThis.crypto === 'object' && typeof globalThis.crypto.subtle.digest === 'function');

/* ---------------------------------------------------------------- engines */

section('engines load as CommonJS');
const E = require('../engines');
for (const k of ['J3Bin', 'J3Zip', 'J3Attrs', 'J3Axml', 'J3Dex', 'J3Smali', 'J3Cert', 'J3Elf', 'J3Vr', 'J3Tamper']) {
  ok(k, !!E[k] && typeof E[k] === 'object');
}
ok('engines are unmodified copies', (() => {
  // Same bytes as the Android/iOS/CLI copies, if that tree is present.
  const src = path.resolve(__dirname, '../../../app/src/main/assets/js');
  if (!fs.existsSync(src)) { console.log('        (source tree not present, skipped)'); return true; }
  const names = ['binary', 'zip', 'attrs', 'axml', 'dex', 'smali', 'cert', 'elf', 'vrscan', 'tamper'];
  return names.every((n) => {
    const a = fs.readFileSync(path.join(src, n + '.js'));
    const b = fs.readFileSync(path.resolve(__dirname, '../engines', n + '.js'));
    if (Buffer.compare(a, b) !== 0) { console.log('        differs: ' + n + '.js'); return false; }
    return true;
  });
})());

/* ------------------------------------------------------------ base64 path */

section('base64 decode (the device read path)');
{
  const src = fs.readFileSync(path.resolve(__dirname, '../src/lib/files.ts'), 'utf8');
  const B64src = src.match(/const B64 =[\s\S]*?;/)[0];
  const LOOKUPsrc = src.match(/const LOOKUP = \(\(\) => \{[\s\S]*?\}\)\(\);/)[0].replace(/: number/g, '');
  const FNsrc = src.match(/export function base64ToBytes[\s\S]*?\n\}/)[0]
    .replace('export function', 'function')
    .replace('(b64: string): Uint8Array', '(b64)');
  // eslint-disable-next-line no-eval
  const base64ToBytes = eval('(function(){' + B64src + LOOKUPsrc + FNsrc + 'return base64ToBytes;})()');

  let b64fail = 0;
  for (const n of [0, 1, 2, 3, 4, 5, 100, 255, 1000, 4095, 4096, 65537]) {
    const buf = nodeCrypto.randomBytes(n);
    if (Buffer.compare(Buffer.from(base64ToBytes(buf.toString('base64'))), buf) !== 0) b64fail++;
  }
  ok('round-trips 12 lengths (all padding remainders)', b64fail === 0);
  const w = nodeCrypto.randomBytes(500);
  ok('tolerates newline-wrapped base64',
    Buffer.compare(Buffer.from(base64ToBytes(w.toString('base64').replace(/(.{60})/g, '$1\n'))), w) === 0);
}

/* ----------------------------------------------------------- end-to-end */

const target = process.argv[2];
if (!target) {
  section('end-to-end');
  console.log('  SKIP  no APK given. Run: node scripts/selftest.js <file.apk>');
  finish();
} else if (!fs.existsSync(target)) {
  section('end-to-end');
  ok('APK exists: ' + target, false);
  finish();
} else {
  section('end-to-end: ' + path.basename(target));
  const { analyse, human } = require('../src/lib/analyse.js');
  const bytes = new Uint8Array(fs.readFileSync(target));
  const t0 = Date.now();
  analyse(bytes).then((a) => {
    const ms = Date.now() - t0;
    console.log('        ' + human(bytes.length) + ' analysed in ' + ms + ' ms');
    ok('zip opened', a.shape.entries > 0);
    ok('manifest parsed', !!a.manifest && !!a.facts.package,
      a.facts.package ? '' : 'no package name');
    ok('dex parsed', a.dexStats.length === 0 || a.dexStats[0].classes > 0);
    ok('tamper verdict produced', !!a.tamper && typeof a.tamper.verdict === 'string');
    ok('vr verdict produced', !!a.vrVerdict && typeof a.vrVerdict.text === 'string');
    ok('signers recovered', a.certs.length > 0 || a.zip.signing.schemes.length === 0);
    if (a.certs.length) {
      ok('fingerprint computed by the shim',
        !!a.certs[0].fp && /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(a.certs[0].fp.sha256),
        a.certs[0].fp ? a.certs[0].fp.sha256 : 'null');
    }
    console.log('');
    console.log('        package  ' + a.facts.package + ' ' + a.facts.versionName);
    console.log('        integrity ' + a.tamper.verdict + ' (score ' + a.tamper.score + ')');
    console.log('        vr        ' + a.vrVerdict.text);
    if (a.errors.length) console.log('        notes     ' + a.errors.join('; '));
    finish();
  }).catch((e) => {
    ok('analyse() did not throw', false, String(e && e.stack ? e.stack : e));
    finish();
  });
}

function finish() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
