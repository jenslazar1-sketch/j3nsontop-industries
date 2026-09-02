/* J3NSONTOP INDUSTRIES - integrity.js
 *
 * The Integrity tab: a dedicated home for the tamper / injected-mod detector.
 *
 * Same engine as the small panel inside APK LAB (tamper.js), but given room to
 * breathe — a big verdict, every signal spelled out, the full signer and the
 * complete native-library inventory with each lib judged, a saveable report,
 * and a queue so you can throw a pile of APKs at it at once.
 *
 * This is the defensive half of the lab: "the bad modders find out". It reads,
 * scores and reports. It changes nothing.
 */
(function () {
  'use strict';

  var $ = J3.$, $$ = J3.$$, esc = J3.esc;

  var queue = [];      // [{ name, size, bytes, result, id }]
  var current = -1;

  var COLOR = { critical: '#FF3B3B', high: '#FF3B3B', med: '#FFC400', low: '#00E5FF', ok: '#7CFF00', info: '#8ea79a' };
  var PILL = { critical: 'bad', high: 'bad', med: 'warn', low: 'info', ok: 'ok', info: 'dim' };

  /* -------------------------------------------------- minimal APK parse --- */

  function analyse(bytes) {
    var zip = J3Zip.open(bytes);
    var out = { zip: zip, manifest: null, arsc: null, dexes: [], certs: [] };
    var jobs = [];

    if (zip.has('AndroidManifest.xml')) {
      jobs.push(zip.read('AndroidManifest.xml')
        .then(function (b) { try { out.manifest = J3Axml.parseXml(b); } catch (e) { } })
        .catch(function () { }));
    }
    zip.entries.filter(function (e) { return /^classes\d*\.dex$/.test(e.name); })
      .forEach(function (e) {
        jobs.push(zip.read(e).then(function (b) {
          try { out.dexes.push({ name: e.name, size: b.length, dex: J3Dex.parse(b) }); } catch (x) { }
        }).catch(function () { }));
      });

    // certs: v2/v3 from the signing block, v1 from PKCS#7
    zip.signing.blocks.forEach(function (b) {
      if (b.id === 0x7109871a || b.id === 0xf05368c0) {
        try { J3Cert.certsFromSigBlock(b.data).forEach(function (c) { c.scheme = b.name; out.certs.push(c); }); } catch (e) { }
      }
    });
    zip.entries.filter(function (e) { return /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(e.name); })
      .forEach(function (e) {
        jobs.push(zip.read(e).then(function (b) {
          try { J3Cert.certsFromPkcs7(b).forEach(function (c) { c.scheme = 'v1 (JAR)'; out.certs.push(c); }); } catch (x) { }
        }).catch(function () { }));
      });

    return Promise.all(jobs).then(function () {
      var seen = {};
      out.certs = out.certs.filter(function (c) {
        var k = c.serial + '|' + c.subject;
        if (seen[k]) { seen[k].schemes.push(c.scheme); return false; }
        c.schemes = [c.scheme]; seen[k] = c; return true;
      });
      return Promise.all(out.certs.map(function (c) {
        return J3Cert.fingerprints(c.der).then(function (f) { c.fp = f; });
      }));
    }).then(function () { return out; });
  }

  /* ----------------------------------------------------------- loading --- */

  function seq() { return 'q' + (Date.now().toString(36)) + Math.random().toString(36).slice(2, 5); }

  function loadFile(bytes, name) {
    var item = { name: name, size: bytes.length, bytes: bytes, result: null, id: seq(), error: null };
    queue.push(item);
    current = queue.length - 1;
    draw();

    return J3.yieldFrame().then(function () {
      return analyse(bytes);
    }).then(function (a) {
      item.a = a;
      item.result = J3Tamper.scan({ zip: a.zip, manifest: a.manifest, dexes: a.dexes, certs: a.certs }, J3Axml, J3Smali);
      J3.buzz(item.result.level === 'critical' || item.result.level === 'high' ? 60 : 25);
      draw();
    }).catch(function (e) {
      item.error = e.message;
      draw();
    });
  }

  /* ---------------------------------------------------------- rendering --- */

  function render() {
    return '<div class="hero"><h1>INTEG<br>RITY</h1>' +
      '<p>Repack &amp; injected-mod detection</p></div>' +
      '<div id="ig-body"></div>';
  }

  function draw() {
    var host = $('#ig-body');
    if (!host) return;

    var head =
      '<div class="drop" id="ig-drop"><div class="big">⚭</div>' +
      '<h3>Scan an APK</h3>' +
      '<p>Tap to pick one or more, or share an APK to J3NSONTOP.<br>' +
      'Tells you if it has been repacked or had a mod injected.</p></div>' +
      '<input type="file" id="ig-in" accept=".apk,.aab,.jar,.zip" multiple hidden>';

    var list = '';
    if (queue.length) {
      list = '<div class="panel"><h3>Queue</h3>' +
        '<div class="filelist">' + queue.map(function (it, i) {
          var r = it.result;
          var lvl = it.error ? 'high' : (r ? r.level : 'info');
          var badge = it.error ? 'error' : (r ? r.verdict : 'scanning…');
          return '<div class="fitem' + (i === current ? ' edited' : '') + '" data-i="' + i + '">' +
            '<span class="nm">' + esc(it.name) +
            '<br><span class="tiny">' + J3Bin.human(it.size) + '</span></span>' +
            '<span class="sz" style="color:' + (COLOR[lvl] || '#8ea79a') + '">' + esc(badge) + '</span></div>';
        }).join('') + '</div>' +
        '<button class="btn ghost sm" id="ig-clear" style="margin-top:8px">Clear queue</button></div>';
    }

    host.innerHTML = head + list + '<div id="ig-detail"></div>';

    var drop = $('#ig-drop');
    drop.onclick = function () { $('#ig-in').click(); };
    $('#ig-in').onchange = function (e) {
      var files = e.target.files ? Array.prototype.slice.call(e.target.files) : [];
      files.forEach(function (f) {
        f.arrayBuffer().then(function (ab) { loadFile(new Uint8Array(ab), f.name); });
      });
    };
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      var files = e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
      files.forEach(function (f) { f.arrayBuffer().then(function (ab) { loadFile(new Uint8Array(ab), f.name); }); });
    });
    var clr = $('#ig-clear');
    if (clr) clr.onclick = function () { queue = []; current = -1; draw(); };

    $$('#ig-body .fitem').forEach(function (row) {
      row.onclick = function () { current = +row.dataset.i; draw(); };
    });

    drawDetail();
  }

  function drawDetail() {
    var host = $('#ig-detail');
    if (!host || current < 0 || current >= queue.length) { if (host) host.innerHTML = ''; return; }
    var it = queue[current];

    if (it.error) {
      host.innerHTML = '<div class="panel"><h3 class="rd">Could not read</h3><p class="sub">' + esc(it.error) + '</p></div>';
      return;
    }
    if (!it.result) {
      host.innerHTML = '<div class="panel"><h3>⧗ Scanning ' + esc(it.name) + '…</h3>' +
        '<div class="bar"><i style="width:55%"></i></div></div>';
      return;
    }

    var r = it.result;
    var id = identityOf(it.a);

    host.innerHTML =
      // verdict
      '<div class="panel" style="--c:' + (COLOR[r.level] || '#8ea79a') + '">' +
        '<h3>' + esc(it.name) + '</h3>' +
        '<p class="sub">' + esc(id.pkg || '?') + (id.versionName ? ' · ' + esc(id.versionName) : '') + '</p>' +
        '<div style="font-family:var(--disp);font-size:30px;color:' + (COLOR[r.level] || '#8ea79a') + ';line-height:1;margin:6px 0 8px">' +
          esc(r.verdict) + '</div>' +
        '<div class="tiny">tamper score ' + r.score + ' · signed with ' + esc(r.schemes.join(', ') || 'nothing') + '</div>' +
        '<div class="row" style="margin-top:12px">' +
          '<button class="btn ghost sm" id="ig-report">Export report</button>' +
          '<button class="btn ghost sm" id="ig-share">Share verdict</button>' +
        '</div>' +
      '</div>' +

      // findings
      '<div class="panel"><h3>Signals</h3>' +
      (r.findings.length
        ? r.findings.map(function (f) {
            return '<div class="risk" style="--c:' + (COLOR[f.sev] || '#8ea79a') + '">' +
              '<b>[' + f.sev.toUpperCase() + '] ' + esc(f.title) + '</b>' +
              '<span>' + esc(f.detail) + (f.evidence ? '<br><span class="tiny">' + esc(f.evidence) + '</span>' : '') + '</span></div>';
          }).join('')
        : '<p class="muted">Nothing suspicious. Signer, libraries, manifest and file layout all look original.</p>') +
      '<p class="tiny" style="margin-top:8px">Signals are cumulative, not proof. A debug key is also a dev build; a debug key plus an injected loadLibrary is a mod.</p>' +
      '</div>' +

      signerPanel(it.a) +
      libsPanel(it.a);

    var rep = $('#ig-report');
    if (rep) rep.onclick = function () {
      J3.save((id.pkg || 'apk') + '-integrity.txt', 'text/plain', J3Bin.toUtf8(buildReport(it, id)))
        .then(function (w) { J3.toast('Saved to ' + w); })
        .catch(function (e) { J3.toast(e.message, true); });
    };
    var sh = $('#ig-share');
    if (sh) sh.onclick = function () {
      J3.share('J3NSONTOP integrity — ' + it.name,
        it.name + '\n' + (id.pkg || '?') + '\nVerdict: ' + r.verdict + ' (score ' + r.score + ')\n' +
        r.findings.map(function (f) { return '- [' + f.sev + '] ' + f.title; }).join('\n'));
    };
  }

  function identityOf(a) {
    if (!a || !a.manifest) return {};
    var root = a.manifest.root;
    return {
      pkg: J3Axml.attrValue(a.manifest, root, 'package'),
      versionName: J3Axml.attrValue(a.manifest, root, 'versionName'),
      versionCode: J3Axml.attrValue(a.manifest, root, 'versionCode')
    };
  }

  function signerPanel(a) {
    if (!a.certs.length) {
      return '<div class="panel"><h3 class="rd">No signature</h3>' +
        '<p class="sub">Nothing signed this file — it has been through a repack tool that never re-signed it.</p></div>';
    }
    return a.certs.map(function (c) {
      return '<div class="panel"><h3>Signer</h3>' +
        '<p class="sub">' + esc(c.schemes.join(' · ')) + '</p>' +
        '<dl class="kv">' +
          '<dt>Subject</dt><dd>' + esc(c.subject) + '</dd>' +
          '<dt>Self-signed</dt><dd>' + (c.selfSigned ? 'yes' : 'no — issued by a CA') + '</dd>' +
          '<dt>Valid until</dt><dd>' + (c.notAfter ? c.notAfter.toISOString().slice(0, 10) : '—') +
            (c.expired ? ' <span class="pill bad">expired</span>' : '') + '</dd>' +
          '<dt>Key</dt><dd>' + esc(c.sigAlg + ' · ' + c.keyAlg + ' ' + (c.keyBits ? c.keyBits + '-bit' : '')) + '</dd>' +
          '<dt>SHA-256</dt><dd style="word-break:break-all;font-size:10.5px">' + (c.fp ? esc(c.fp.sha256) : '—') + '</dd>' +
        '</dl>' +
        '<p class="tiny" style="margin-top:8px">Compare the SHA-256 against the publisher’s known key: a mismatch is a re-sign.</p>' +
        '</div>';
    }).join('');
  }

  var MODRE = /(mod.?menu|modmenu|cheat|hack|aimbot|wallhack|trainer|inject|frida|gadget|substrate|riru|zygisk|xposed|dobby|imgui|j3prefab|j3lib|melon)/i;
  var LEGITRE = /^(unity|il2cpp|main|mono|unreal|ue4|godot|fmod|openal|oboe|c\+\+_shared|c\+\+_static|openxr_loader|ovr|oculus|vrapi|wave|pxr|pvr|gvr|cardboard|webrtc|opus|flutter|firebase|crashlytics|sqlite|png|jpeg|ffmpeg|av|interactionsdk|sdktelemetry|burst|audioplugin|double-conversion|xplat)/i;

  function libsPanel(a) {
    var libs = a.zip.entries.filter(function (e) { return /\.so$/.test(e.name); });
    if (!libs.length) return '';
    return '<div class="panel"><h3>Native libraries (' + libs.length + ')</h3>' +
      '<p class="sub">Every .so, judged. A mod or hook library here is the payload.</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Library</th><th>ABI</th><th class="num">Size</th><th>Verdict</th></tr></thead><tbody>' +
      libs.slice(0, 200).map(function (e) {
        var m = /^(?:lib\/|assets\/lib\/)?([^/]+)\/lib([^/]+)\.so$/.exec(e.name) || [];
        var abi = m[1] || '?', name = m[2] || e.name;
        var tag, cls;
        if (LEGITRE.test(name)) { tag = 'engine'; cls = 'dim'; }
        else if (MODRE.test(name)) { tag = 'MOD / HOOK'; cls = 'bad'; }
        else { tag = 'unknown'; cls = 'warn'; }
        return '<tr><td class="nm">' + esc(name) + '</td><td>' + esc(abi) + '</td>' +
          '<td class="num">' + J3Bin.human(e.usize) + '</td>' +
          '<td><span class="pill ' + cls + '">' + tag + '</span></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function buildReport(it, id) {
    var r = it.result;
    var L = [];
    L.push('J3NSONTOP INDUSTRIES — integrity report');
    L.push(new Date().toISOString().slice(0, 19).replace('T', ' '));
    L.push('');
    L.push('FILE      ' + it.name + '  (' + J3Bin.human(it.size) + ')');
    L.push('PACKAGE   ' + (id.pkg || '?'));
    L.push('VERSION   ' + (id.versionName || '?') + '  (' + (id.versionCode || '?') + ')');
    L.push('SIGNED    ' + (r.schemes.join(', ') || 'nothing'));
    L.push('');
    L.push('VERDICT   ' + r.verdict + '   (tamper score ' + r.score + ')');
    L.push('');
    L.push('SIGNALS (' + r.findings.length + ')');
    if (!r.findings.length) L.push('  none — looks original');
    r.findings.forEach(function (f) {
      L.push('  [' + f.sev.toUpperCase() + '] ' + f.title);
      L.push('        ' + f.detail);
      if (f.evidence) L.push('        -> ' + f.evidence);
    });
    L.push('');
    (it.a.certs || []).forEach(function (c) {
      L.push('SIGNER    ' + c.subject);
      if (c.fp) L.push('  sha256  ' + c.fp.sha256.toLowerCase().replace(/:/g, ''));
    });
    L.push('');
    L.push('Generated on-device by J3NSONTOP INDUSTRIES. Nothing was uploaded.');
    return L.join('\n');
  }

  J3.view('integrity', {
    render: render,
    mount: function () { draw(); },
    takeIncoming: function (info) {
      J3.toast('Scanning ' + info.name + '…');
      J3.fetchHanded(info.id).then(function (bytes) { loadFile(bytes, info.name); })
        .catch(function (e) { J3.toast(e.message, true); });
    }
  });
}());
