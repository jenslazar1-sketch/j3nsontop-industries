/* J3NSONTOP INDUSTRIES - apklab.js
 *
 * Decompile, read, edit, repack. On the phone. Offline.
 *
 * What it honestly does:
 *   - unpacks the ZIP and reads every entry
 *   - decodes AndroidManifest.xml from binary XML back to real XML
 *   - reads resources.arsc well enough to resolve @string/@mipmap references
 *   - reads every classes*.dex: classes, methods, fields, string constants
 *   - reads the signing certificate out of v1 PKCS#7 or the v2/v3 block
 *   - rewrites the manifest, swaps or deletes files, and repacks it aligned
 *
 * What it does not do, and says so in the UI rather than pretending:
 *   - bytecode -> Java source (that is jadx, and it needs a desktop)
 *   - signing (needs a keystore; tools/apklab does it with apksigner)
 * A repacked APK therefore comes out UNSIGNED and will not install until it
 * is signed. Saying that plainly beats shipping a file that fails at install
 * with an error nobody can read.
 */
(function () {
  'use strict';

  var $ = J3.$, $$ = J3.$$, esc = J3.esc;

  var apk = null;          // { name, bytes, zip, manifest, arsc, dexes, certs }
  var nativeDigest = null; // set when libj3native hashed the file on the way in
  var edits = {};          // entry name -> { data } | { deleted:true }
  var tab = 'overview';

  var DANGEROUS = {
    'android.permission.READ_SMS': 'Read your text messages',
    'android.permission.SEND_SMS': 'Send texts (can cost money)',
    'android.permission.RECEIVE_SMS': 'Intercept incoming texts',
    'android.permission.READ_CONTACTS': 'Read your contacts',
    'android.permission.WRITE_CONTACTS': 'Change your contacts',
    'android.permission.READ_CALL_LOG': 'Read who you called',
    'android.permission.CALL_PHONE': 'Place calls without asking',
    'android.permission.RECORD_AUDIO': 'Use the microphone',
    'android.permission.CAMERA': 'Use the camera',
    'android.permission.ACCESS_FINE_LOCATION': 'Exact location',
    'android.permission.ACCESS_BACKGROUND_LOCATION': 'Location even when closed',
    'android.permission.READ_EXTERNAL_STORAGE': 'Read your files',
    'android.permission.WRITE_EXTERNAL_STORAGE': 'Write to your files',
    'android.permission.MANAGE_EXTERNAL_STORAGE': 'Full access to all storage',
    'android.permission.REQUEST_INSTALL_PACKAGES': 'Install other apps',
    'android.permission.SYSTEM_ALERT_WINDOW': 'Draw over other apps',
    'android.permission.BIND_ACCESSIBILITY_SERVICE': 'Accessibility - can read and tap the whole screen',
    'android.permission.PACKAGE_USAGE_STATS': 'See which apps you use',
    'android.permission.QUERY_ALL_PACKAGES': 'List every installed app',
    'android.permission.READ_PHONE_STATE': 'Phone number and network identity',
    'android.permission.GET_ACCOUNTS': 'See the accounts on the device'
  };

  /* ------------------------------------------------------------- loading */

  function reset() {
    apk = null; edits = {}; tab = 'overview';
  }

  /* A short list of what has been opened, so returning to a build you were
   * looking at yesterday does not mean hunting through the file picker. */
  function recall() { return J3.store.get('apkHistory', []); }

  function remember(info) {
    var list = recall().filter(function (h) { return h.name !== info.name; });
    list.unshift(info);
    J3.store.set('apkHistory', list.slice(0, 12));
  }

  function setBusy(msg, pct) {
    var host = $('#al-body');
    if (!host) return;
    host.innerHTML = '<div class="panel"><h3>⧗ ' + esc(msg) + '</h3>' +
      '<div class="bar"><i style="width:' + (pct || 0) + '%"></i></div></div>';
  }

  function load(bytes, name) {
    reset();
    setBusy('Opening ' + name + '…', 10);

    return J3.yieldFrame().then(function () {
      var zip = J3Zip.open(bytes);
      apk = { name: name, bytes: bytes, zip: zip, manifest: null, arsc: null, dexes: [], certs: [], warnings: [] };

      setBusy('Reading resources…', 35);
      return J3.yieldFrame().then(function () {
        if (!zip.has('resources.arsc')) return null;
        return zip.read('resources.arsc')
          .then(function (b) { try { apk.arsc = J3Axml.parseArsc(b); } catch (e) { apk.warnings.push('resources.arsc: ' + e.message); } })
          .catch(function (e) { apk.warnings.push('resources.arsc: ' + e.message); });
      });
    }).then(function () {
      setBusy('Decoding the manifest…', 55);
      if (!apk.zip.has('AndroidManifest.xml')) {
        apk.warnings.push('No AndroidManifest.xml - this is an archive, not an APK.');
        return;
      }
      return apk.zip.read('AndroidManifest.xml').then(function (b) {
        try { apk.manifest = J3Axml.parseXml(b); }
        catch (e) { apk.warnings.push('AndroidManifest.xml: ' + e.message); }
      });
    }).then(function () {
      setBusy('Reading signatures…', 70);
      return readCerts();
    }).then(function () {
      setBusy('Scanning dex…', 85);
      var dexEntries = apk.zip.entries.filter(function (e) { return /^classes\d*\.dex$/.test(e.name); });
      var i = 0;
      function next() {
        if (i >= dexEntries.length) return Promise.resolve();
        var e = dexEntries[i++];
        return apk.zip.read(e).then(function (b) {
          try { apk.dexes.push({ name: e.name, size: b.length, dex: J3Dex.parse(b) }); }
          catch (err) { apk.warnings.push(e.name + ': ' + err.message); }
          return J3.yieldFrame().then(next);
        });
      }
      return next();
    }).then(function () {
      tab = 'overview';
      var id = identity();
      remember({
        name: name, size: bytes.length, at: Date.now(),
        pkg: id.pkg || '?', label: id.label || name,
        version: id.versionName || '?'
      });
      draw();
      J3.buzz(30);
      J3.toast('Opened ' + name);
    }).catch(function (e) {
      $('#al-body').innerHTML = '<div class="panel"><h3 class="rd">✕ Could not open that file</h3>' +
        '<p class="sub">' + esc(e.message) + '</p>' +
        '<button class="btn ghost" id="al-again">Try another file</button></div>';
      var b = $('#al-again'); if (b) b.onclick = function () { reset(); draw(); };
    });
  }

  function readCerts() {
    var jobs = [];
    apk.zip.signing.blocks.forEach(function (b) {
      if (b.id === 0x7109871a || b.id === 0xf05368c0) {
        try {
          J3Cert.certsFromSigBlock(b.data).forEach(function (c) {
            c.scheme = b.name; apk.certs.push(c);
          });
        } catch (e) { }
      }
    });
    apk.zip.entries.filter(function (e) { return /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(e.name); })
      .forEach(function (e) {
        jobs.push(apk.zip.read(e).then(function (b) {
          try {
            J3Cert.certsFromPkcs7(b).forEach(function (c) { c.scheme = 'v1 (JAR) · ' + e.name; apk.certs.push(c); });
          } catch (err) { }
        }).catch(function () { }));
      });

    return Promise.all(jobs).then(function () {
      // Same key signing v1/v2/v3 shows up three times; collapse by serial.
      var seen = {}, uniq = [];
      apk.certs.forEach(function (c) {
        var k = c.serial + '|' + c.subject;
        if (seen[k]) { seen[k].schemes.push(c.scheme); return; }
        c.schemes = [c.scheme];
        seen[k] = c; uniq.push(c);
      });
      apk.certs = uniq;
      return Promise.all(uniq.map(function (c) {
        return J3Cert.fingerprints(c.der).then(function (f) { c.fp = f; });
      }));
    });
  }

  /* ------------------------------------------------------------- reading */

  function mattr(el, name) { return apk.manifest ? J3Axml.attrValue(apk.manifest, el, name) : null; }

  function appEl() {
    if (!apk.manifest) return null;
    return J3Axml.children(apk.manifest.root, 'application')[0] || null;
  }

  function resolveRes(v) {
    if (!v || typeof v !== 'string' || v.charAt(0) !== '@' || !apk.arsc) return v;
    var m = /^@0x([0-9a-f]+)$/i.exec(v);
    if (m) {
      var s = apk.arsc.stringOf(parseInt(m[1], 16));
      return s || v;
    }
    return v;
  }

  function identity() {
    if (!apk.manifest) return {};
    var root = apk.manifest.root, app = appEl();
    var sdk = J3Axml.children(root, 'uses-sdk')[0];
    var label = app ? mattr(app, 'label') : null;
    // android:label is nearly always a reference rather than a literal, and it
    // arrives here as a bare "@0x7f030000", so put it through the table.
    if (label && label.charAt(0) === '@' && apk.arsc) {
      var hex = /^@0x([0-9a-f]+)$/i.exec(label);
      var byName = /^@string\/(.+)$/.exec(label);
      if (hex) {
        label = apk.arsc.stringOf(parseInt(hex[1], 16)) || label;
      } else if (byName) {
        Object.keys(apk.arsc.byId).some(function (id) {
          var e = apk.arsc.byId[id];
          if (e.type === 'string' && e.key === byName[1]) {
            var s = apk.arsc.stringOf(+id);
            if (s) label = s;
            return true;
          }
          return false;
        });
      }
    }
    return {
      pkg: mattr(root, 'package') || (apk.arsc && apk.arsc.packageName) || '?',
      versionCode: mattr(root, 'versionCode'),
      versionName: mattr(root, 'versionName'),
      minSdk: sdk ? mattr(sdk, 'minSdkVersion') : null,
      targetSdk: sdk ? mattr(sdk, 'targetSdkVersion') : null,
      label: label,
      debuggable: app ? mattr(app, 'debuggable') : null,
      allowBackup: app ? mattr(app, 'allowBackup') : null,
      cleartext: app ? mattr(app, 'usesCleartextTraffic') : null
    };
  }

  function permissions() {
    if (!apk.manifest) return [];
    return J3Axml.find(apk.manifest.root, 'uses-permission')
      .concat(J3Axml.children(apk.manifest.root, 'uses-permission'))
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .map(function (e) { return J3Axml.attrValue(apk.manifest, e, 'name'); })
      .filter(Boolean)
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .sort();
  }

  function components() {
    if (!apk.manifest) return [];
    var app = appEl();
    if (!app) return [];
    var out = [];
    ['activity', 'activity-alias', 'service', 'receiver', 'provider'].forEach(function (kind) {
      J3Axml.children(app, kind).forEach(function (c) {
        out.push({
          kind: kind,
          name: J3Axml.attrValue(apk.manifest, c, 'name') || '?',
          exported: J3Axml.attrValue(apk.manifest, c, 'exported'),
          permission: J3Axml.attrValue(apk.manifest, c, 'permission'),
          filters: J3Axml.children(c, 'intent-filter').length
        });
      });
    });
    return out;
  }

  function risks() {
    var out = [], id = identity();
    if (id.debuggable === 'true') {
      out.push({ c: '#FF3B3B', t: 'Debuggable build',
        d: 'Anyone with a USB cable can attach a debugger and read this app\'s memory and data. Never ship this.' });
    }
    if (id.cleartext === 'true') {
      out.push({ c: '#FFC400', t: 'Cleartext traffic allowed',
        d: 'The app is permitted to use plain HTTP, which anyone on the same network can read or alter.' });
    }
    if (id.allowBackup !== 'false' && apk.manifest) {
      out.push({ c: '#FFC400', t: 'Backups allowed',
        d: 'App data can be pulled off the device with adb backup on older Android versions.' });
    }
    var dang = permissions().filter(function (p) { return DANGEROUS[p]; });
    if (dang.length) {
      out.push({ c: '#FFC400', t: dang.length + ' sensitive permission' + (dang.length === 1 ? '' : 's'),
        d: dang.map(function (p) { return DANGEROUS[p]; }).join(' · ') });
    }
    var exported = components().filter(function (c) { return c.exported === 'true' && !c.permission; });
    if (exported.length) {
      out.push({ c: '#00E5FF', t: exported.length + ' exported component' + (exported.length === 1 ? '' : 's') + ' with no permission',
        d: 'Other apps on the device can start these directly: ' +
           exported.slice(0, 4).map(function (c) { return c.name.split('.').pop(); }).join(', ') +
           (exported.length > 4 ? ' and more' : '') });
    }
    if (!apk.zip.signing.present && !apk.zip.entries.some(function (e) { return /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(e.name); })) {
      out.push({ c: '#FF3B3B', t: 'Unsigned',
        d: 'No v1, v2 or v3 signature. Android will refuse to install this until it is signed.' });
    }
    var natives = apk.zip.entries.filter(function (e) { return /\.so$/.test(e.name); });
    if (natives.length) {
      var abis = {};
      natives.forEach(function (e) { var m = /^lib\/([^/]+)\//.exec(e.name); if (m) abis[m[1]] = 1; });
      out.push({ c: '#8ea79a', t: natives.length + ' native librar' + (natives.length === 1 ? 'y' : 'ies'),
        d: 'ABIs: ' + (Object.keys(abis).join(', ') || 'unknown') + '. Native code is not readable here.' });
    }
    apk.certs.forEach(function (c) {
      if (c.expired) out.push({ c: '#FF3B3B', t: 'Signing certificate expired', d: 'Expired ' + c.notAfter.toISOString().slice(0, 10) + '.' });
    });
    if (!out.length) out.push({ c: '#7CFF00', t: 'Nothing alarming', d: 'No debuggable flag, no sensitive permissions, signature present.' });
    return out;
  }

  /* -------------------------------------------------------------- panels */

  function kv(rows) {
    return '<dl class="kv">' + rows.filter(Boolean).map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + (r[2] ? r[1] : esc(r[1] === null || r[1] === undefined ? '—' : r[1])) + '</dd>';
    }).join('') + '</dl>';
  }

  function paneOverview() {
    var id = identity();
    var totalUncompressed = apk.zip.entries.reduce(function (a, e) { return a + (e.usize || 0); }, 0);
    var schemes = apk.zip.signing.schemes.slice();
    if (apk.zip.entries.some(function (e) { return /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(e.name); })) schemes.unshift('v1 (JAR)');

    return '<div class="panel">' +
      '<h3>' + esc(id.label || apk.name) + '</h3>' +
      '<p class="sub">' + esc(apk.name) + ' · ' + J3Bin.human(apk.bytes.length) + '</p>' +
      kv([
        ['Package', id.pkg],
        ['Version', (id.versionName || '?') + ' (code ' + (id.versionCode || '?') + ')'],
        ['SDK', 'min ' + (id.minSdk || '?') + ' → target ' + (id.targetSdk || '?')],
        ['Entries', apk.zip.entries.length + ' files, ' + J3Bin.human(totalUncompressed) + ' unpacked'],
        nativeDigest && nativeDigest.sha256
          ? ['SHA-256', '<span style="word-break:break-all;font-size:10.5px">' + esc(nativeDigest.sha256) +
             '</span> <span class="pill ok">native</span>', true]
          : null,
        ['Signed with', schemes.length ? schemes.join(', ') : '<span class="rd">nothing</span>', schemes.length === 0],
        apk.dexes.length ? ['Code', apk.dexes.length + ' dex · ' +
          apk.dexes.reduce(function (a, d) { return a + d.dex.counts.classes; }, 0) + ' classes · ' +
          apk.dexes.reduce(function (a, d) { return a + d.dex.counts.methods; }, 0) + ' method refs'] : null
      ]) +
      (apk.warnings.length ? '<div class="risk" style="--c:#FFC400"><b>Partly readable</b><span>' +
        apk.warnings.map(esc).join('<br>') + '</span></div>' : '') +
      '<div class="row" style="margin-top:12px">' +
        '<button class="btn ghost sm" id="ov-report">Export report</button>' +
        '<button class="btn ghost sm" id="ov-share">Share summary</button>' +
      '</div>' +
      '</div>' +

      vrPanel() +

      tamperPanel() +

      '<div class="panel"><h3>Risk scan</h3>' +
      '<p class="sub">What this build can do once it is installed.</p>' +
      risks().map(function (r) {
        return '<div class="risk" style="--c:' + r.c + '"><b>' + esc(r.t) + '</b><span>' + esc(r.d) + '</span></div>';
      }).join('') + '</div>' +

      '<div class="panel"><h3>Permissions</h3>' +
      '<p class="sub">' + permissions().length + ' requested</p>' +
      (permissions().length
        ? permissions().map(function (p) {
            var d = DANGEROUS[p];
            return '<div style="margin-bottom:7px"><span class="' + (d ? 'am' : 'muted') + '" style="font-size:11.5px;word-break:break-all">' +
              (d ? '⚠ ' : '· ') + esc(p) + '</span>' +
              (d ? '<div class="tiny" style="margin-left:14px">' + esc(d) + '</div>' : '') + '</div>';
          }).join('')
        : '<p class="muted">None. That is unusual and good.</p>') +
      '</div>';
  }

  /* Only appears for VR builds. Answers the one question people actually have
   * about a Quest APK on a phone: what exactly is stopping it. */
  /* Repack / injected-mod detection. Uses tamper.js. */
  function tamperPanel() {
    var r;
    try { r = J3Tamper.scan({ zip: apk.zip, manifest: apk.manifest, dexes: apk.dexes, certs: apk.certs }, J3Axml, J3Smali); }
    catch (e) { return ''; }
    var COLOR = { critical: '#FF3B3B', high: '#FF3B3B', med: '#FFC400', low: '#00E5FF', ok: '#7CFF00' };
    var SEV = { critical: 'bad', high: 'bad', med: 'warn', low: 'info', info: 'dim' };

    return '<div class="panel" style="--c:' + (COLOR[r.level] || '#8ea79a') + '">' +
      '<h3>Integrity</h3>' +
      '<p class="sub">Has this build been repacked or had a mod injected?</p>' +
      '<div style="margin:4px 0 10px"><span class="pill ' + (SEV[r.maxSev] || 'dim') + '" style="font-size:11px">' +
        esc(r.verdict) + '</span> <span class="tiny">score ' + r.score + '</span></div>' +
      (r.findings.length
        ? r.findings.map(function (f) {
            return '<div class="risk" style="--c:' + (COLOR[f.sev] || '#8ea79a') + '">' +
              '<b>[' + f.sev.toUpperCase() + '] ' + esc(f.title) + '</b>' +
              '<span>' + esc(f.detail) + (f.evidence ? '<br><span class="tiny">' + esc(f.evidence) + '</span>' : '') + '</span></div>';
          }).join('')
        : '<p class="muted">Signer, libraries, manifest and file layout all look original.</p>') +
      '<p class="tiny" style="margin-top:10px">Signals are cumulative, not proof. A debug key is also a dev build; a debug key plus an injected loadLibrary is a mod.</p>' +
      '</div>';
  }

  function vrPanel() {
    var r;
    try { r = J3Vr.scan(apk.zip, apk.manifest, J3Axml); }
    catch (e) { return ''; }
    if (!r.isVR) return '';

    var v = J3Vr.verdict(r);
    var COLOR = { ok: '#7CFF00', fixable: '#00E5FF', emulator: '#FFC400',
                  shim: '#FFC400', hard: '#FF3B3B' };
    var TAG = { hard: 'RUNTIME', shim: 'RUNTIME', emulator: 'ABI',
                fixable: 'INSTALL', design: 'INPUT' };

    return '<div class="panel" style="--c:' + COLOR[v.level] + '">' +
      '<h3>VR / XR</h3>' +
      '<p class="sub">' + esc(v.text) + '</p>' +
      kv([
        ['XR API', r.runtime ? esc(r.runtime.name) : 'none detected'],
        ['Engine', r.engine || 'unknown'],
        ['ABIs', r.abis.join(', ') || 'none'],
        r.features.length
          ? ['Demands', r.features.map(function (f) {
              return (f.required ? '<span class="rd">required</span> ' : '<span class="tiny">optional</span> ') + esc(f.label);
            }).join('<br>'), true]
          : null
      ]) +
      r.blockers.map(function (b) {
        return '<div class="risk" style="--c:' + (COLOR[b.level] || '#8ea79a') + '">' +
          '<b>[' + (TAG[b.level] || '?') + '] ' + esc(b.title) + '</b>' +
          '<span>' + esc(b.detail) + '</span></div>';
      }).join('') +
      r.notes.map(function (n) {
        return '<div class="risk" style="--c:#7CFF00"><b>' + esc(n) + '</b></div>';
      }).join('') +
      (r.blockers.some(function (b) { return b.kind === 'install'; })
        ? '<p class="tiny" style="margin-top:10px">Relax the install gates on a desktop: <code class="acid">apklab devr app.apk</code></p>'
        : '') +
      '</div>';
  }

  function paneManifest() {
    if (!apk.manifest) return '<div class="panel"><h3>No manifest</h3><p class="sub">This archive has no AndroidManifest.xml.</p></div>';
    var id = identity();
    var xml = J3Axml.toXml(apk.manifest, { resolve: apk.arsc ? apk.arsc.resolve : null });

    return '<div class="panel"><h3>Edit the manifest</h3>' +
      '<p class="sub">Changes are re-encoded to binary XML when you rebuild. The package name is read-only — renaming it also means rewriting resources.arsc and every dex reference.</p>' +
      '<div class="row grow">' +
        '<div class="field"><label>App label</label><input id="m-label" type="text" value="' + esc(id.label || '') + '"></div>' +
      '</div>' +
      '<div class="row grow">' +
        '<div class="field"><label>Version name</label><input id="m-vname" type="text" value="' + esc(id.versionName || '') + '"></div>' +
        '<div class="field"><label>Version code</label><input id="m-vcode" type="number" value="' + esc(id.versionCode || '1') + '"></div>' +
      '</div>' +
      '<div class="chips" id="m-flags">' +
        '<button class="chip' + (id.debuggable === 'true' ? ' on' : '') + '" data-k="debuggable">debuggable</button>' +
        '<button class="chip' + (id.allowBackup === 'true' ? ' on' : '') + '" data-k="allowBackup">allowBackup</button>' +
        '<button class="chip' + (id.cleartext === 'true' ? ' on' : '') + '" data-k="usesCleartextTraffic">cleartext</button>' +
      '</div>' +
      '<div class="field"><label>Add a permission</label>' +
        '<input id="m-perm" type="text" placeholder="android.permission.INTERNET"></div>' +
      '<div class="row"><button class="btn" id="m-apply">Apply to manifest</button>' +
      '<button class="btn ghost" id="m-addperm">Add permission</button></div>' +
      '</div>' +

      '<div class="panel"><h3>AndroidManifest.xml</h3>' +
      '<p class="sub">Decoded from binary XML · ' + apk.manifest.strings.length + ' pooled strings</p>' +
      '<div class="row"><button class="btn ghost sm" id="m-copy">Copy XML</button>' +
      '<button class="btn ghost sm" id="m-save">Save as .xml</button></div>' +
      '<div class="out pre" id="m-xml">' + esc(xml) + '</div></div>' +
      paneDeepLinks();
  }

  /* Every URL this app claims it can open. Worth reading carefully: an app
   * registering someone else's domain is how link-hijacking works. */
  function paneDeepLinks() {
    if (!apk.manifest) return '';
    var filters = J3Axml.find(apk.manifest.root, 'intent-filter');
    var links = [], actions = {};

    filters.forEach(function (f) {
      J3Axml.children(f, 'action').forEach(function (a) {
        var n = J3Axml.attrValue(apk.manifest, a, 'name');
        if (n) actions[n] = (actions[n] || 0) + 1;
      });
      var datas = J3Axml.children(f, 'data');
      if (!datas.length) return;
      var autoVerify = J3Axml.attrValue(apk.manifest, f, 'autoVerify') === 'true';
      datas.forEach(function (d) {
        var scheme = J3Axml.attrValue(apk.manifest, d, 'scheme');
        var host   = J3Axml.attrValue(apk.manifest, d, 'host');
        var path   = J3Axml.attrValue(apk.manifest, d, 'path')
                  || J3Axml.attrValue(apk.manifest, d, 'pathPrefix')
                  || J3Axml.attrValue(apk.manifest, d, 'pathPattern');
        var mime   = J3Axml.attrValue(apk.manifest, d, 'mimeType');
        if (!scheme && !host && !mime) return;
        links.push({
          scheme: scheme, host: host, path: path, mime: mime, verified: autoVerify
        });
      });
    });

    var topActions = Object.keys(actions).sort(function (a, b) { return actions[b] - actions[a]; }).slice(0, 14);

    return '<div class="panel"><h3>Entry points</h3>' +
      '<p class="sub">How other apps and links can reach into this one</p>' +
      (links.length
        ? '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th>Scheme</th><th>Host</th><th>Path</th><th>Type</th></tr></thead><tbody>' +
          links.slice(0, 80).map(function (l) {
            return '<tr><td>' + esc(l.scheme || '—') + '</td>' +
              '<td class="nm">' + esc(l.host || '—') + (l.verified ? ' <span class="pill ok">verified</span>' : '') + '</td>' +
              '<td class="nm">' + esc(l.path || '—') + '</td>' +
              '<td class="nm">' + esc(l.mime || '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<p class="muted">No URL or mime handlers.</p>') +
      (topActions.length
        ? '<div class="tiny" style="margin:14px 0 6px">INTENT ACTIONS</div>' +
          topActions.map(function (a) {
            return '<div style="font-size:11px;color:var(--dim);word-break:break-all">' + esc(a) + '</div>';
          }).join('')
        : '') +
      '</div>';
  }

  function paneFiles() {
    var list = apk.zip.entries.slice().sort(function (a, b) { return b.usize - a.usize; });
    return '<div class="panel"><h3>' + apk.zip.entries.length + ' entries</h3>' +
      '<p class="sub">Biggest first. Tap to preview, extract or replace.</p>' +
      '<div class="search" style="margin-top:10px">' +
        '<input id="al-fq" type="text" placeholder="Filter files…" autocomplete="off">' +
        '<button class="clr" id="al-fqc">×</button></div>' +
      '<div class="filelist" id="al-files">' + fileRows(list) + '</div></div>';
  }

  function fileRows(list) {
    return list.slice(0, 600).map(function (e) {
      var st = edits[e.name];
      var cls = st ? (st.deleted ? 'gone' : 'edited') : '';
      return '<div class="fitem ' + cls + '" data-n="' + esc(e.name) + '">' +
        '<span class="nm">' + esc(e.name) + '</span>' +
        '<span class="sz">' + J3Bin.human(e.usize) + (e.method === 8 ? ' ⇩' : '') + '</span></div>';
    }).join('') + (list.length > 600 ? '<div class="tiny" style="padding:8px">…and ' + (list.length - 600) + ' more (use the filter)</div>' : '');
  }

  /** Everything resources.arsc knows, grouped by type, plus the drawables. */
  function paneResources() {
    if (!apk.arsc) {
      return '<div class="panel"><h3>No resource table</h3>' +
        '<p class="sub">This archive has no resources.arsc.</p></div>';
    }
    var pkg = apk.arsc.packages[0];
    var byType = {};
    Object.keys(apk.arsc.byId).forEach(function (id) {
      var e = apk.arsc.byId[id];
      (byType[e.type] || (byType[e.type] = [])).push(e);
    });

    var images = apk.zip.entries.filter(function (e) {
      return /^res\/.*\.(png|jpg|jpeg|webp|gif)$/i.test(e.name);
    });

    return '<div class="panel"><h3>Resource table</h3>' +
      '<p class="sub">' + esc(apk.arsc.packageName || '?') + ' · ' + apk.arsc.count + ' resources</p>' +
      kv([
        ['Package id', '0x' + (pkg ? pkg.id.toString(16) : '?')],
        ['Types', Object.keys(byType).sort().join(', ')],
        ['Configs', Object.keys(pkg ? pkg.configs : {}).sort().join(', ')]
      ]) + '</div>' +

      '<div class="panel"><h3>Values</h3>' +
      '<div class="search" style="margin-top:6px">' +
      '<input id="rs-q" type="text" placeholder="Search resources…" autocomplete="off">' +
      '<button class="clr" id="rs-qc">×</button></div>' +
      '<div class="filelist" id="rs-list"></div></div>' +

      (images.length
        ? '<div class="panel"><h3>Drawables</h3>' +
          '<p class="sub">' + images.length + ' image' + (images.length === 1 ? '' : 's') + ' in res/</p>' +
          '<div id="rs-imgs" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:8px;margin-top:10px"></div>' +
          '<button class="btn ghost sm" id="rs-load" style="margin-top:10px">Load previews</button></div>'
        : '');
  }

  function wireResources() {
    if (!apk.arsc) return;
    var all = Object.keys(apk.arsc.byId).map(function (id) {
      var e = apk.arsc.byId[id];
      return { id: +id, type: e.type, key: e.key, val: apk.arsc.stringOf(+id) };
    }).sort(function (a, b) { return a.type.localeCompare(b.type) || a.key.localeCompare(b.key); });

    var input = $('#rs-q');
    function list() {
      var q = (input.value || '').trim().toLowerCase();
      var hits = q ? all.filter(function (r) {
        return (r.type + '/' + r.key + ' ' + (r.val || '')).toLowerCase().indexOf(q) >= 0;
      }) : all;
      $('#rs-list').innerHTML = hits.length
        ? hits.slice(0, 400).map(function (r) {
            return '<div class="fitem"><span class="nm">' +
              '<span class="acid">@' + esc(r.type) + '/</span>' + esc(r.key) +
              (r.val ? '<br><span class="tiny">' + esc(r.val.length > 90 ? r.val.slice(0, 90) + '…' : r.val) + '</span>' : '') +
              '</span><span class="sz">0x' + r.id.toString(16) + '</span></div>';
          }).join('') + (hits.length > 400 ? '<div class="tiny" style="padding:8px">…and ' + (hits.length - 400) + ' more</div>' : '')
        : '<div class="tiny" style="padding:10px">nothing matches</div>';
    }
    input.oninput = list;
    $('#rs-qc').onclick = function () { input.value = ''; list(); };
    list();

    var load = $('#rs-load');
    if (load) load.onclick = function () {
      load.disabled = true;
      load.textContent = 'loading…';
      var imgs = apk.zip.entries.filter(function (e) {
        return /^res\/.*\.(png|jpg|jpeg|webp|gif)$/i.test(e.name);
      }).slice(0, 60);
      var host = $('#rs-imgs');
      var i = 0;
      (function next() {
        if (i >= imgs.length) { load.textContent = 'Loaded ' + imgs.length; return; }
        var e = imgs[i++];
        apk.zip.read(e).then(function (bytes) {
          var mime = /\.png$/i.test(e.name) ? 'image/png'
                   : /\.webp$/i.test(e.name) ? 'image/webp'
                   : /\.gif$/i.test(e.name) ? 'image/gif' : 'image/jpeg';
          var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
          var cell = document.createElement('div');
          cell.innerHTML = '<img src="' + url + '" alt="" title="' + esc(e.name) +
            '" style="width:100%;aspect-ratio:1;object-fit:contain;background:#000;border-radius:8px;border:1px solid var(--line2)">' +
            '<div class="tiny" style="font-size:8px;text-align:center;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            esc(e.name.split('/').pop()) + '</div>';
          host.appendChild(cell);
          return J3.yieldFrame().then(next);
        }).catch(next);
      }());
    };
  }

  function paneDex() {
    if (!apk.dexes.length) return '<div class="panel"><h3>No code</h3><p class="sub">No classes.dex in this archive.</p></div>';

    var totalMethods = apk.dexes.reduce(function (a, d) { return a + d.dex.counts.methods; }, 0);
    var html = '<div class="panel"><h3>Code</h3><p class="sub">' + apk.dexes.length +
      ' dex file' + (apk.dexes.length === 1 ? '' : 's') + '</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>File</th><th class="num">Classes</th>' +
      '<th class="num">Methods</th><th class="num">Strings</th><th class="num">Size</th></tr></thead><tbody>' +
      apk.dexes.map(function (d) {
        return '<tr><td class="nm">' + esc(d.name) + '</td>' +
          '<td class="num">' + d.dex.counts.classes + '</td>' +
          '<td class="num">' + d.dex.counts.methods + '</td>' +
          '<td class="num">' + d.dex.counts.strings + '</td>' +
          '<td class="num">' + J3Bin.human(d.size) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (totalMethods > 60000 ? '<div class="risk" style="--c:#FFC400;margin-top:10px"><b>Near the dex method limit</b>' +
        '<span>' + totalMethods + ' method references. A single dex tops out at 65,536.</span></div>' : '') +
      '</div>';

    // Referenced packages: the quickest read on what an app is built out of.
    var packs = {};
    apk.dexes.forEach(function (d) {
      d.dex.packages(60).forEach(function (p) { packs[p.name] = (packs[p.name] || 0) + p.count; });
    });
    var top = Object.keys(packs).map(function (k) { return { name: k, n: packs[k] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 24);

    html += '<div class="panel"><h3>Libraries in play</h3>' +
      '<p class="sub">Packages this code references, by how much</p>' +
      top.map(function (p) {
        return '<div style="display:flex;gap:8px;font-size:11.5px;margin-bottom:4px">' +
          '<span style="flex:1;word-break:break-all">' + esc(p.name) + '</span>' +
          '<span class="tiny">' + p.n + '</span></div>';
      }).join('') + '</div>';

    // Strings
    var buckets = {};
    apk.dexes.forEach(function (d) {
      var r = d.dex.scanStrings({ cap: 150 });
      Object.keys(r.buckets).forEach(function (k) {
        buckets[k] = (buckets[k] || []).concat(r.buckets[k]);
      });
    });
    var LABEL = { url: 'URLs', host: 'Hostnames', ip: 'IP addresses', intent: 'Android actions',
                  path: 'File paths', sql: 'SQL', secret: 'Possible secrets', b64: 'Base64 blobs' };
    var order = ['url', 'host', 'ip', 'secret', 'path', 'sql', 'intent', 'b64'];

    html += '<div class="panel"><h3>Search every string</h3>' +
      '<p class="sub">Across all ' +
      apk.dexes.reduce(function (a, d) { return a + d.dex.counts.strings; }, 0) +
      ' constants in every dex.</p>' +
      '<div class="search" style="margin-top:6px">' +
      '<input id="al-sq" type="text" placeholder="e.g. http, token, api…" autocomplete="off">' +
      '<button class="clr" id="al-sqc">×</button></div>' +
      '<div class="filelist" id="al-strings"><div class="tiny" style="padding:10px">type at least 3 characters</div></div></div>';

    html += '<div class="panel"><h3>String constants</h3>' +
      '<p class="sub">Pulled straight out of the dex string pools — this is the app\'s real network surface, whatever the manifest says.</p>';
    var any = false;
    order.forEach(function (k) {
      var v = buckets[k];
      if (!v || !v.length) return;
      any = true;
      var uniq = v.filter(function (x, i, a) { return a.indexOf(x) === i; });
      html += '<div style="margin-bottom:12px"><div class="tiny acid" style="margin-bottom:5px">' +
        esc(LABEL[k] || k) + ' (' + uniq.length + ')</div>' +
        uniq.slice(0, 40).map(function (s) {
          return '<div style="font-size:11px;word-break:break-all;color:var(--dim);margin-bottom:2px">' + esc(s) + '</div>';
        }).join('') +
        (uniq.length > 40 ? '<div class="tiny">…and ' + (uniq.length - 40) + ' more</div>' : '') + '</div>';
    });
    if (!any) html += '<p class="muted">Nothing notable.</p>';
    html += '</div>';

    // Class browser
    html += '<div class="panel"><h3>Classes</h3>' +
      '<div class="search" style="margin-top:6px">' +
      '<input id="al-cq" type="text" placeholder="Search classes…" autocomplete="off">' +
      '<button class="clr" id="al-cqc">×</button></div>' +
      '<div class="filelist" id="al-classes"></div></div>';

    return html;
  }

  function classRows(query) {
    var out = [], q = (query || '').toLowerCase();
    for (var d = 0; d < apk.dexes.length; d++) {
      var dex = apk.dexes[d].dex;
      for (var i = 0; i < dex.classes.length; i++) {
        var n = dex.className(i);
        if (q && n.toLowerCase().indexOf(q) < 0) continue;
        out.push({ d: d, i: i, n: n });
        if (out.length >= 400) break;
      }
      if (out.length >= 400) break;
    }
    if (!out.length) return '<div class="tiny" style="padding:10px">no classes match</div>';
    return out.map(function (c) {
      return '<div class="fitem" data-d="' + c.d + '" data-i="' + c.i + '">' +
        '<span class="nm">' + esc(c.n) + '</span></div>';
    }).join('');
  }

  function paneCert() {
    if (!apk.certs.length) {
      return '<div class="panel"><h3 class="rd">No signature</h3>' +
        '<p class="sub">Nothing signed this file. Android will not install it.</p></div>';
    }
    return apk.certs.map(function (c) {
      return '<div class="panel"><h3>' + esc(c.cn || 'Certificate') + '</h3>' +
        '<p class="sub">' + esc(c.schemes.join(' · ')) + '</p>' +
        kv([
          ['Subject', c.subject],
          ['Issuer', c.issuer],
          ['Self-signed', c.selfSigned ? 'yes (normal for Android apps)' : 'no — issued by a CA'],
          ['Serial', c.serial],
          ['Valid from', c.notBefore ? c.notBefore.toISOString().slice(0, 10) : '—'],
          ['Valid until', (c.notAfter ? c.notAfter.toISOString().slice(0, 10) : '—') +
            (c.expired ? ' <span class="pill bad">expired</span>' : ' <span class="pill ok">current</span>'), true],
          ['Algorithm', c.sigAlg + ' · ' + c.keyAlg + ' ' + (c.keyBits ? c.keyBits + '-bit' : '')],
          ['SHA-256', c.fp ? '<span style="word-break:break-all;font-size:10.5px">' + c.fp.sha256 + '</span>' : '—', true],
          ['SHA-1', c.fp ? '<span style="word-break:break-all;font-size:10.5px">' + c.fp.sha1 + '</span>' : '—', true]
        ]) +
        '<p class="tiny" style="margin-top:10px">This reads the certificate. It does not verify the signature maths — use apksigner for that.</p>' +
        '</div>';
    }).join('');
  }

  function paneRebuild() {
    var changed = Object.keys(edits);
    var manifestDirty = !!apk._manifestDirty;

    return '<div class="panel"><h3>Rebuild</h3>' +
      '<p class="sub">Repacks every entry with correct zipalign padding: resources.arsc and any .so stay stored and aligned, everything else is recompressed.</p>' +
      (manifestDirty || changed.length
        ? '<div class="risk" style="--c:#FFC400"><b>' + ((manifestDirty ? 1 : 0) + changed.length) + ' pending change' +
          (((manifestDirty ? 1 : 0) + changed.length) === 1 ? '' : 's') + '</b><span>' +
          (manifestDirty ? 'AndroidManifest.xml (rewritten)<br>' : '') +
          changed.map(function (n) { return esc(n) + (edits[n].deleted ? ' (deleted)' : ' (replaced)'); }).join('<br>') +
          '</span></div>'
        : '<p class="muted">No changes queued yet. Rebuilding now just re-packs the original.</p>') +

      '<div class="chips" id="rb-opts">' +
        '<button class="chip on" data-k="strip">Strip old signature</button>' +
        '<button class="chip" data-k="nodebug">Force debuggable off</button>' +
      '</div>' +

      '<div class="row"><button class="btn" id="rb-go">Build APK</button>' +
      '<button class="btn ghost" id="rb-reset">Discard changes</button></div>' +
      '<div class="bar" id="rb-bar" hidden><i></i></div>' +
      '<div id="rb-out"></div>' +

      '<div class="risk" style="--c:#00E5FF;margin-top:14px"><b>The result is unsigned</b>' +
      '<span>Removing or changing anything voids the old signature, and signing needs a keystore this app does not have. ' +
      'Sign it with the desktop toolkit before installing:<br>' +
      '<code style="color:var(--acid)">apklab sign out.apk</code></span></div>' +
      '</div>';
  }

  /* ---------------------------------------------------------- rebuilding */

  function rebuild(opts) {
    var bar = $('#rb-bar'), fill = bar ? bar.querySelector('i') : null;
    if (bar) bar.hidden = false;
    var out = $('#rb-out');
    out.innerHTML = '<div class="tiny">collecting entries…</div>';

    var items = [], skipped = 0;
    var entries = apk.zip.entries.filter(function (e) { return !e.isDir; });
    var i = 0;

    function next() {
      if (i >= entries.length) return Promise.resolve();
      var e = entries[i++];

      if (fill) fill.style.width = Math.round(i / entries.length * 60) + '%';

      var st = edits[e.name];
      if (st && st.deleted) { skipped++; return next(); }
      if (opts.strip && /^META-INF\/.*\.(RSA|DSA|EC|SF|MF)$/i.test(e.name)) { skipped++; return next(); }

      if (st && st.data) { items.push({ name: e.name, data: st.data }); return next(); }

      if (e.name === 'AndroidManifest.xml' && apk._manifestDirty) {
        try { items.push({ name: e.name, data: J3Axml.encode(apk.manifest) }); }
        catch (err) { return Promise.reject(new Error('Manifest re-encode failed: ' + err.message)); }
        return next();
      }

      // Untouched and already deflated: hand the compressed bytes straight
      // through instead of paying to inflate and re-deflate them.
      if (e.method === 8 || e.method === 0) {
        items.push({ name: e.name, rawData: apk.zip.raw(e).slice(), method: e.method,
                     crc: e.crc, usize: e.usize, date: e.date });
        return (i % 40 === 0) ? J3.yieldFrame().then(next) : next();
      }
      return apk.zip.read(e).then(function (b) { items.push({ name: e.name, data: b }); return next(); });
    }

    return next().then(function () {
      out.innerHTML = '<div class="tiny">packing ' + items.length + ' entries…</div>';
      return J3Zip.build(items, {
        onProgress: function (d, t) { if (fill) fill.style.width = (60 + Math.round(d / t * 35)) + '%'; }
      });
    }).then(function (bytes) {
      if (fill) fill.style.width = '100%';
      var id = identity();
      var base = (id.pkg && id.pkg !== '?' ? id.pkg : apk.name.replace(/\.apk$/i, '')) + '-apklab.apk';
      out.innerHTML = '<div class="risk" style="--c:#7CFF00"><b>Built ' + J3Bin.human(bytes.length) + '</b>' +
        '<span>' + items.length + ' entries in, ' + skipped + ' dropped. Saving…</span></div>';

      return J3.save(base, 'application/vnd.android.package-archive', bytes, function (d, t) {
        if (fill) fill.style.width = Math.round(d / t * 100) + '%';
      }).then(function (where) {
        out.innerHTML = '<div class="risk" style="--c:#7CFF00"><b>Saved</b><span>' + esc(where) +
          '<br>' + J3Bin.human(bytes.length) + ' · ' + items.length + ' entries · unsigned</span></div>';
        J3.toast('Saved to ' + where);
        J3.buzz(60);
      });
    }).catch(function (e) {
      out.innerHTML = '<div class="risk" style="--c:#FF3B3B"><b>Build failed</b><span>' + esc(e.message) + '</span></div>';
      J3.toast(e.message, true);
    }).then(function () {
      if (bar) setTimeout(function () { bar.hidden = true; if (fill) fill.style.width = '0'; }, 900);
    });
  }

  function historyPanel() {
    var list = recall();
    if (!list.length) return '';
    return '<div class="panel"><h3>Recently opened</h3>' +
      '<p class="sub">Names only — no file contents are kept.</p>' +
      '<div class="filelist">' + list.map(function (h) {
        return '<div class="fitem"><span class="nm">' + esc(h.label) +
          '<br><span class="tiny">' + esc(h.pkg) + ' · ' + esc(h.version) + ' · ' +
          J3Bin.human(h.size) + ' · ' + new Date(h.at).toISOString().slice(0, 10) + '</span></span></div>';
      }).join('') + '</div>' +
      '<button class="btn ghost sm" id="al-clearhist" style="margin-top:10px">Clear list</button></div>';
  }

  /* ------------------------------------------------------------- drawing */

  var TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'manifest', label: 'Manifest' },
    { id: 'files', label: 'Files' },
    { id: 'resources', label: 'Resources' },
    { id: 'dex', label: 'Code' },
    { id: 'cert', label: 'Signature' },
    { id: 'rebuild', label: 'Rebuild' }
  ];

  function draw() {
    var host = $('#al-body');
    if (!host) return;

    if (!apk) {
      host.innerHTML =
        '<div class="drop" id="al-drop"><div class="big">⬢</div>' +
        '<h3>Open an APK</h3>' +
        '<p>Tap to pick a file, or share an APK to J3NSONTOP from any file manager.<br>' +
        'Also reads .aab, .jar and plain .zip.</p></div>' +
        '<input type="file" id="al-in" accept=".apk,.aab,.jar,.zip,application/vnd.android.package-archive" hidden>' +
        historyPanel() +
        '<div class="panel"><h3>What you get</h3>' +
        '<p class="sub">Everything below runs on the phone with no network at all.</p>' +
        '<dl class="kv">' +
          '<dt>Decompile</dt><dd>Binary AndroidManifest.xml back to readable XML, resources.arsc resolved</dd>' +
          '<dt>Inspect</dt><dd>Classes, methods, fields and every string constant in each dex</dd>' +
          '<dt>Verify</dt><dd>Signing certificate, fingerprints, scheme versions</dd>' +
          '<dt>Edit</dt><dd>Label, version, flags, permissions; swap or delete any file</dd>' +
          '<dt>Recompile</dt><dd>Repacked and zipalign-correct, ready to sign</dd>' +
        '</dl></div>';

      var clear = $('#al-clearhist');
      if (clear) clear.onclick = function () { J3.store.del('apkHistory'); draw(); };

      var drop = $('#al-drop');
      drop.onclick = function () { $('#al-in').click(); };
      $('#al-in').onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        f.arrayBuffer().then(function (ab) { load(new Uint8Array(ab), f.name); });
      };
      ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
      });
      drop.addEventListener('drop', function (e) {
        var f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) f.arrayBuffer().then(function (ab) { load(new Uint8Array(ab), f.name); });
      });
      return;
    }

    host.innerHTML =
      '<div class="tabs">' + TABS.map(function (t) {
        return '<button data-t="' + t.id + '"' + (t.id === tab ? ' class="on"' : '') + '>' + t.label + '</button>';
      }).join('') + '<button data-t="__close">✕ Close</button></div>' +
      '<div id="al-pane"></div>';

    $$('#al-body .tabs button').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.t === '__close') { reset(); draw(); return; }
        tab = b.dataset.t; draw(); window.scrollTo({ top: 0 });
      };
    });

    var pane = $('#al-pane');
    if (tab === 'overview') { pane.innerHTML = paneOverview(); wireOverview(); }
    else if (tab === 'manifest') { pane.innerHTML = paneManifest(); wireManifest(); }
    else if (tab === 'files') { pane.innerHTML = paneFiles(); wireFiles(); }
    else if (tab === 'resources') { pane.innerHTML = paneResources(); wireResources(); }
    else if (tab === 'dex') { pane.innerHTML = paneDex(); wireDex(); }
    else if (tab === 'cert') pane.innerHTML = paneCert();
    else { pane.innerHTML = paneRebuild(); wireRebuild(); }
  }

  /* --------------------------------------------------------------- wiring */

  function wireOverview() {
    var rep = $('#ov-report');
    if (rep) rep.onclick = function () {
      var text = buildReport();
      J3.save((identity().pkg || 'apk') + '-report.txt', 'text/plain', J3Bin.toUtf8(text))
        .then(function (w) { J3.toast('Saved to ' + w); })
        .catch(function (e) { J3.toast(e.message, true); });
    };
    var sh = $('#ov-share');
    if (sh) sh.onclick = function () {
      var id = identity();
      J3.share('J3NSONTOP — ' + (id.label || apk.name),
        (id.label || apk.name) + '\n' + id.pkg + ' ' + id.versionName + ' (' + id.versionCode + ')\n' +
        'SDK ' + id.minSdk + '-' + id.targetSdk + '\n' +
        permissions().length + ' permissions, ' + apk.zip.entries.length + ' files\n' +
        risks().map(function (r) { return '- ' + r.t; }).join('\n'));
    };
  }

  /** A plain-text audit of everything the lab worked out. */
  function buildReport() {
    var id = identity();
    var L = [];
    L.push('J3NSONTOP INDUSTRIES — APK report');
    L.push(new Date().toISOString().slice(0, 19).replace('T', ' '));
    L.push('');
    L.push('FILE     ' + apk.name + '  (' + J3Bin.human(apk.bytes.length) + ')');
    L.push('PACKAGE  ' + (id.pkg || '?'));
    L.push('LABEL    ' + (id.label || '?'));
    L.push('VERSION  ' + (id.versionName || '?') + ' (code ' + (id.versionCode || '?') + ')');
    L.push('SDK      min ' + (id.minSdk || '?') + ' target ' + (id.targetSdk || '?'));
    L.push('ENTRIES  ' + apk.zip.entries.length);
    L.push('');

    L.push('SIGNING');
    var schemes = apk.zip.signing.schemes.slice();
    if (apk.zip.entries.some(function (e) { return /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(e.name); })) schemes.unshift('v1 (JAR)');
    L.push('  ' + (schemes.length ? schemes.join(', ') : 'UNSIGNED'));
    apk.certs.forEach(function (c) {
      L.push('  subject  ' + c.subject);
      L.push('  valid    ' + (c.notBefore ? c.notBefore.toISOString().slice(0, 10) : '?') +
             ' -> ' + (c.notAfter ? c.notAfter.toISOString().slice(0, 10) : '?') + (c.expired ? '  EXPIRED' : ''));
      L.push('  algo     ' + c.sigAlg + ' / ' + c.keyAlg + ' ' + c.keyBits + '-bit');
      if (c.fp) L.push('  sha256   ' + c.fp.sha256.toLowerCase().replace(/:/g, ''));
    });
    L.push('');

    L.push('RISK');
    risks().forEach(function (r) { L.push('  [' + r.t + '] ' + r.d); });
    L.push('');

    L.push('PERMISSIONS (' + permissions().length + ')');
    permissions().forEach(function (p) { L.push('  ' + (DANGEROUS[p] ? '! ' : '  ') + p); });
    L.push('');

    var comps = components();
    L.push('COMPONENTS (' + comps.length + ')');
    comps.forEach(function (c) {
      L.push('  ' + c.kind + '  ' + c.name +
             (c.exported === 'true' ? '  EXPORTED' : '') +
             (c.permission ? '  perm=' + c.permission : ''));
    });
    L.push('');

    if (apk.dexes.length) {
      L.push('CODE');
      apk.dexes.forEach(function (d) {
        L.push('  ' + d.name + '  ' + d.dex.counts.classes + ' classes, ' +
               d.dex.counts.methods + ' methods, ' + d.dex.counts.strings + ' strings');
      });
      L.push('');
    }

    var natives = apk.zip.entries.filter(function (e) { return /\.so$/.test(e.name); });
    if (natives.length) {
      L.push('NATIVE LIBRARIES (' + natives.length + ')');
      natives.slice(0, 40).forEach(function (e) { L.push('  ' + e.name + '  ' + J3Bin.human(e.usize)); });
      L.push('');
    }

    L.push('Generated on-device by J3NSONTOP INDUSTRIES. Nothing was uploaded.');
    return L.join('\n');
  }

  function wireManifest() {
    if (!apk.manifest) return;
    var app = appEl(), root = apk.manifest.root;

    var flags = {};
    $$('#m-flags .chip').forEach(function (b) {
      flags[b.dataset.k] = b.classList.contains('on');
      b.onclick = function () {
        flags[b.dataset.k] = !flags[b.dataset.k];
        b.classList.toggle('on', flags[b.dataset.k]);
      };
    });

    var apply = $('#m-apply');
    if (apply) apply.onclick = function () {
      try {
        var label = $('#m-label').value.trim();
        if (app && label) J3Axml.setString(app, 'label', label);
        var vn = $('#m-vname').value.trim();
        if (vn) J3Axml.setString(root, 'versionName', vn);
        var vc = parseInt($('#m-vcode').value, 10);
        if (vc > 0) J3Axml.setInt(root, 'versionCode', vc);
        if (app) {
          Object.keys(flags).forEach(function (k) { J3Axml.setBool(app, k, flags[k]); });
        }
        apk._manifestDirty = true;
        J3.toast('Manifest updated — rebuild to write it');
        draw();
      } catch (e) { J3.toast(e.message, true); }
    };

    var addP = $('#m-addperm');
    if (addP) addP.onclick = function () {
      var name = $('#m-perm').value.trim();
      if (!name) { J3.toast('Type a permission name first', true); return; }
      if (permissions().indexOf(name) >= 0) { J3.toast('Already requested', true); return; }
      root.children.unshift({
        name: 'uses-permission', nsUri: null, line: 1, children: [],
        attrs: [{ name: 'name', nsUri: J3Axml.ANDROID_NS, resId: 0x01010003,
                  type: J3Axml.T.STRING, data: 0, raw: name }]
      });
      apk._manifestDirty = true;
      J3.toast('Added ' + name);
      draw();
    };

    var copyB = $('#m-copy');
    if (copyB) copyB.onclick = function () { J3.copy($('#m-xml').textContent, 'AndroidManifest.xml'); };
    var saveB = $('#m-save');
    if (saveB) saveB.onclick = function () {
      J3.save((identity().pkg || 'app') + '-AndroidManifest.xml', 'text/xml',
              J3Bin.toUtf8($('#m-xml').textContent))
        .then(function (w) { J3.toast('Saved to ' + w); })
        .catch(function (e) { J3.toast(e.message, true); });
    };
  }

  function wireFiles() {
    var all = apk.zip.entries.slice().sort(function (a, b) { return b.usize - a.usize; });
    var input = $('#al-fq');
    function refresh() {
      var q = input.value.trim().toLowerCase();
      var list = q ? all.filter(function (e) { return e.name.toLowerCase().indexOf(q) >= 0; }) : all;
      $('#al-files').innerHTML = fileRows(list);
      bindRows();
    }
    function bindRows() {
      $$('#al-files .fitem').forEach(function (row) {
        row.onclick = function () { openEntry(row.dataset.n); };
      });
    }
    input.oninput = refresh;
    $('#al-fqc').onclick = function () { input.value = ''; refresh(); };
    bindRows();
  }

  function openEntry(name) {
    var e = apk.zip.get(name);
    if (!e) return;
    var pane = $('#al-pane');
    var prev = pane.innerHTML;

    pane.innerHTML = '<div class="panel"><h3 style="word-break:break-all">' + esc(name) + '</h3>' +
      '<p class="sub">' + J3Bin.human(e.usize) + ' unpacked · ' +
      (e.method === 8 ? 'deflated to ' + J3Bin.human(e.csize) : 'stored') +
      ' · CRC ' + ('00000000' + e.crc.toString(16)).slice(-8) + '</p>' +
      '<div class="row">' +
        '<button class="btn sm" id="fe-save">Extract</button>' +
        '<button class="btn sm ghost" id="fe-replace">Replace</button>' +
        '<button class="btn sm dang" id="fe-del">Delete</button>' +
        '<input type="file" id="fe-in" hidden>' +
      '</div>' +
      '<div id="fe-prev"><div class="tiny" style="margin-top:12px">reading…</div></div>' +
      '</div><button class="btn ghost" id="fe-back">◂ Back to files</button>';

    function goBack() { pane.innerHTML = prev; wireFiles(); }
    $('#fe-back').onclick = goBack;
    J3.pushBack(goBack);

    var st = edits[name];
    var dataP = st && st.data ? Promise.resolve(st.data) : apk.zip.read(e);

    dataP.then(function (bytes) {
      var box = $('#fe-prev');
      if (!box) return;
      var kind = J3.util.sniff(bytes);
      var html = '<div class="tiny" style="margin:12px 0 6px">' + esc(kind) + '</div>';

      if (name === 'AndroidManifest.xml' || /\.xml$/i.test(name)) {
        try {
          var doc = J3Axml.parseXml(bytes);
          html += '<div class="out pre">' + esc(J3Axml.toXml(doc, { resolve: apk.arsc ? apk.arsc.resolve : null })) + '</div>';
        } catch (err) {
          html += '<div class="out pre">' + esc(J3Bin.utf8(bytes.subarray(0, 4000))) + '</div>';
        }
      } else if (kind === 'Plain text' || /\.(txt|json|properties|md|js|css|html|svg|pro|cfg|ini|version)$/i.test(name)) {
        html += '<div class="out pre">' + esc(J3Bin.utf8(bytes.subarray(0, 8000))) +
          (bytes.length > 8000 ? '\n\n… ' + J3Bin.human(bytes.length - 8000) + ' more' : '') + '</div>';
      } else if (/^(PNG|JPEG|GIF|WebP)/.test(kind)) {
        var mime = kind.indexOf('PNG') === 0 ? 'image/png' : kind.indexOf('JPEG') === 0 ? 'image/jpeg'
                 : kind.indexOf('GIF') === 0 ? 'image/gif' : 'image/webp';
        var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        html += '<img src="' + url + '" alt="" style="border-radius:10px;margin-top:8px;background:#000">';
      } else if (/\.so$/i.test(name)) {
        try {
          var elf = J3Elf.parse(bytes);
          html += '<dl class="kv">' +
            '<dt>Architecture</dt><dd class="acid">' + esc(elf.machine) + '</dd>' +
            '<dt>Class</dt><dd>' + elf.bits + '-bit ' + esc(elf.type) + '</dd>' +
            '<dt>SONAME</dt><dd>' + esc(elf.soname || '—') + '</dd>' +
            '<dt>Symbols</dt><dd>' + (elf.stripped ? 'stripped' : '<span class="am">not stripped</span>') + '</dd>' +
            (elf.runpath ? '<dt>RUNPATH</dt><dd class="am">' + esc(elf.runpath) + '</dd>' : '') +
            '<dt>Links against</dt><dd style="word-break:break-all">' +
              (elf.needed.length ? elf.needed.map(esc).join('<br>') : '—') + '</dd>' +
            '</dl>';
          var tells = J3Elf.notes(elf);
          if (tells.length) {
            html += '<div class="tiny" style="margin:12px 0 5px">WHAT THAT IMPLIES</div>' +
              tells.map(function (t) {
                return '<div class="risk" style="--c:#00E5FF"><b>' + esc(t.lib) + '</b><span>' + esc(t.why) + '</span></div>';
              }).join('');
          }
          if (elf.sections.length) {
            html += '<div class="tiny" style="margin:12px 0 5px">BIGGEST SECTIONS</div>' +
              elf.sections.slice(0, 8).map(function (sec) {
                return '<div style="display:flex;gap:8px;font-size:11px"><span style="flex:1">' +
                  esc(sec.name) + '</span><span class="tiny">' + J3Bin.human(sec.size) + '</span></div>';
              }).join('');
          }
        } catch (err) {
          html += '<p class="muted">' + esc(err.message) + '</p>';
        }
      } else if (/\.dex$/i.test(name)) {
        try {
          var d = J3Dex.parse(bytes);
          html += '<dl class="kv"><dt>Dex version</dt><dd>' + d.version + '</dd>' +
            '<dt>Classes</dt><dd>' + d.counts.classes + '</dd>' +
            '<dt>Methods</dt><dd>' + d.counts.methods + '</dd>' +
            '<dt>Strings</dt><dd>' + d.counts.strings + '</dd></dl>';
        } catch (err) { html += '<p class="muted">' + esc(err.message) + '</p>'; }
      } else {
        html += '<div class="out pre">' + esc(J3Bin.hex(bytes.subarray(0, 256), ' ')
          .replace(/((?:\S\S ){16})/g, '$1\n')) + '</div>';
      }
      box.innerHTML = html;
    }).catch(function (err) {
      var box = $('#fe-prev');
      if (box) box.innerHTML = '<p class="rd">' + esc(err.message) + '</p>';
    });

    $('#fe-save').onclick = function () {
      dataP.then(function (bytes) {
        return J3.save(name.split('/').pop(), 'application/octet-stream', bytes);
      }).then(function (w) { J3.toast('Saved to ' + w); })
        .catch(function (err) { J3.toast(err.message, true); });
    };
    $('#fe-replace').onclick = function () { $('#fe-in').click(); };
    $('#fe-in').onchange = function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      f.arrayBuffer().then(function (ab) {
        edits[name] = { data: new Uint8Array(ab) };
        J3.toast('Queued replacement for ' + name.split('/').pop());
        goBack();
      });
    };
    $('#fe-del').onclick = function () {
      edits[name] = { deleted: true };
      J3.toast('Queued delete for ' + name.split('/').pop());
      goBack();
    };
  }

  function wireDex() {
    var sq = $('#al-sq');
    if (sq) {
      var t = null;
      var runSearch = function () {
        var q = sq.value.trim().toLowerCase();
        var host = $('#al-strings');
        if (q.length < 3) { host.innerHTML = '<div class="tiny" style="padding:10px">type at least 3 characters</div>'; return; }
        var hits = [];
        for (var d = 0; d < apk.dexes.length && hits.length < 300; d++) {
          var dex = apk.dexes[d].dex;
          for (var i = 0; i < dex.counts.strings && hits.length < 300; i++) {
            var s = dex.string(i);
            if (s.length > 1 && s.toLowerCase().indexOf(q) >= 0) hits.push({ s: s, d: apk.dexes[d].name });
          }
        }
        host.innerHTML = hits.length
          ? hits.map(function (h) {
              return '<div class="fitem"><span class="nm" style="font-size:11px">' +
                esc(h.s.length > 200 ? h.s.slice(0, 200) + '…' : h.s) + '</span>' +
                '<span class="sz">' + esc(h.d) + '</span></div>';
            }).join('')
          : '<div class="tiny" style="padding:10px">no match</div>';
      };
      sq.oninput = function () { clearTimeout(t); t = setTimeout(runSearch, 220); };
      $('#al-sqc').onclick = function () { sq.value = ''; runSearch(); };
    }

    var input = $('#al-cq');
    if (!input) return;
    function refresh() { $('#al-classes').innerHTML = classRows(input.value.trim()); bindRows(); }
    function bindRows() {
      $$('#al-classes .fitem').forEach(function (row) {
        row.onclick = function () { openClass(+row.dataset.d, +row.dataset.i); };
      });
    }
    input.oninput = refresh;
    $('#al-cqc').onclick = function () { input.value = ''; refresh(); };
    refresh();
  }

  function openClass(di, ci) {
    var info;
    try { info = apk.dexes[di].dex.classInfo(ci); }
    catch (e) { J3.toast(e.message, true); return; }

    var pane = $('#al-pane');
    var prev = pane.innerHTML;

    var sig = (info.modifiers ? info.modifiers + ' ' : '') +
      (info.isInterface ? 'interface' : info.isEnum ? 'enum' : 'class') + ' ' + info.name +
      (info.superName && info.superName !== 'java.lang.Object' ? '\n        extends ' + info.superName : '') +
      (info.interfaces.length ? '\n        implements ' + info.interfaces.join(', ') : '');

    var body = sig + ' {\n' +
      (info.fields.length
        ? '\n    // ' + info.fields.length + ' fields\n' +
          info.fields.map(function (f) {
            return '    ' + (f.modifiers ? f.modifiers + ' ' : '') + f.type + ' ' + f.name + ';';
          }).join('\n') + '\n'
        : '') +
      (info.methods.length
        ? '\n    // ' + info.methods.length + ' methods\n' +
          info.methods.map(function (m) {
            return '    ' + (m.modifiers ? m.modifiers + ' ' : '') + m.ret + ' ' + m.name +
              '(' + m.args.join(', ') + ')' + (m.hasCode ? '   // ' + m.insns + ' instructions' : ';');
          }).join('\n') + '\n'
        : '') +
      '}';

    var withCode = info.methods.filter(function (m) { return m.hasCode; });

    pane.innerHTML = '<div class="panel"><h3 style="word-break:break-all;font-size:14px">' + esc(info.name) + '</h3>' +
      '<p class="sub">' + esc(apk.dexes[di].name) + (info.source ? ' · from ' + esc(info.source) : '') +
      ' · ' + info.methods.length + ' methods, ' + info.fields.length + ' fields</p>' +
      '<div class="row"><button class="btn sm ghost" id="cl-copy">Copy signature</button></div>' +
      '<div class="out pre">' + esc(body) + '</div></div>' +

      (withCode.length
        ? '<div class="panel"><h3>Disassemble</h3>' +
          '<p class="sub">Tap a method to see its Dalvik bytecode.</p>' +
          '<div class="filelist">' + withCode.map(function (m) {
            return '<div class="fitem" data-m="' + info.methods.indexOf(m) + '">' +
              '<span class="nm">' + esc(m.name) + '<span class="tiny"> (' + esc(m.args.join(', ')) + ') → ' + esc(m.ret) + '</span></span>' +
              '<span class="sz">' + m.insns + ' units</span></div>';
          }).join('') + '</div></div>'
        : '') +

      '<button class="btn ghost" id="cl-back">◂ Back to code</button>';

    function goBack() { pane.innerHTML = prev; wireDex(); }
    $('#cl-back').onclick = goBack;
    J3.pushBack(goBack);
    $('#cl-copy').onclick = function () { J3.copy(body, info.name); };

    $$('#al-pane .fitem[data-m]').forEach(function (row) {
      row.onclick = function () { openMethod(di, ci, +row.dataset.m); };
    });
  }

  /** Dalvik bytecode for one method, via smali.js. */
  function openMethod(di, ci, mi) {
    var dex = apk.dexes[di].dex;
    var info = dex.classInfo(ci);
    var m = info.methods[mi];
    if (!m || !m.hasCode) return;

    var pane = $('#al-pane');
    var prev = pane.innerHTML;
    var text;
    try {
      text = J3Smali.render(J3Smali.disassemble(dex, dex.bytes, m.codeOff));
    } catch (e) {
      text = 'Could not disassemble: ' + e.message;
    }

    var header = (m.modifiers ? m.modifiers + ' ' : '') + m.ret + ' ' + m.name +
                 '(' + m.args.join(', ') + ')';

    pane.innerHTML = '<div class="panel"><h3 style="font-size:14px;word-break:break-all">' + esc(m.name) + '</h3>' +
      '<p class="sub" style="word-break:break-all">' + esc(info.name) + '</p>' +
      '<div class="out pre" style="font-size:11px">' + esc(header + '\n' + text) + '</div>' +
      '<div class="row" style="margin-top:10px">' +
        '<button class="btn sm ghost" id="mt-copy">Copy</button>' +
        '<button class="btn sm ghost" id="mt-save">Save .smali</button>' +
      '</div>' +
      '<p class="tiny" style="margin-top:10px">Real Dalvik instructions, not a guess. Turning these back into Java is jadx\u2019s job — ' +
      '<code class="acid">apklab jadx</code> on a desktop.</p>' +
      '</div><button class="btn ghost" id="mt-back">◂ Back to class</button>';

    function goBack() {
      pane.innerHTML = prev;
      $('#cl-back').onclick = function () { draw(); };
      $$('#al-pane .fitem[data-m]').forEach(function (row) {
        row.onclick = function () { openMethod(di, ci, +row.dataset.m); };
      });
    }
    $('#mt-back').onclick = goBack;
    J3.pushBack(goBack);
    $('#mt-copy').onclick = function () { J3.copy(header + '\n' + text, m.name); };
    $('#mt-save').onclick = function () {
      J3.save(info.name + '.' + m.name + '.smali', 'text/plain', J3Bin.toUtf8(header + '\n' + text))
        .then(function (w) { J3.toast('Saved to ' + w); })
        .catch(function (e) { J3.toast(e.message, true); });
    };
  }

  function wireRebuild() {
    var opts = { strip: true, nodebug: false };
    $$('#rb-opts .chip').forEach(function (b) {
      b.onclick = function () {
        opts[b.dataset.k] = !opts[b.dataset.k];
        b.classList.toggle('on', opts[b.dataset.k]);
      };
    });
    $('#rb-go').onclick = function () {
      if (opts.nodebug && appEl()) { J3Axml.setBool(appEl(), 'debuggable', false); apk._manifestDirty = true; }
      $('#rb-go').disabled = true;
      rebuild(opts).then(function () { $('#rb-go').disabled = false; });
    };
    $('#rb-reset').onclick = function () {
      edits = {};
      apk._manifestDirty = false;
      // The tree was mutated in place, so a clean slate means re-reading it.
      apk.zip.read('AndroidManifest.xml').then(function (b) {
        try { apk.manifest = J3Axml.parseXml(b); } catch (e) { }
        J3.toast('Changes discarded');
        draw();
      }).catch(function () { draw(); });
    };
  }

  /* ---------------------------------------------------------------- view */

  J3.view('apklab', {
    render: function () {
      return '<div class="hero"><h1>APK<br>LAB</h1>' +
        '<p>Decompile · inspect · edit · repack</p></div><div id="al-body"></div>';
    },
    mount: function () { draw(); },
    takeIncoming: function (infoObj) {
      J3.toast('Loading ' + infoObj.name + '…');

      // Hash it natively first: the bytes never enter JS, so a huge APK costs
      // nothing here, and the digest is ready before the parse finishes.
      if (J3.native && Native.hashHanded) {
        try {
          var raw = Native.hashHanded(infoObj.id);
          if (raw) nativeDigest = JSON.parse(raw);
        } catch (e) { nativeDigest = null; }
      }

      J3.fetchHanded(infoObj.id).then(function (bytes) {
        load(bytes, infoObj.name);
      }).catch(function (e) { J3.toast(e.message, true); });
    }
  });
}());
