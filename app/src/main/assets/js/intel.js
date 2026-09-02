/* J3NSONTOP INDUSTRIES - intel.js
 *
 * The "what am I running on" panel. Doubles as a self-check: if the APK LAB
 * ever misbehaves on a device, the capability list here is the first thing to
 * look at, because an old WebView missing DecompressionStream or crypto.subtle
 * explains most of what can go wrong.
 */
(function () {
  'use strict';

  var esc = J3.esc;

  function yesno(v) {
    return v ? '<span class="pill ok">yes</span>' : '<span class="pill bad">no</span>';
  }

  function render() {
    return '<div class="hero"><h1>INTEL</h1><p>Build, device and engine status</p></div>' +
      '<div id="in-body"></div>';
  }

  /** libj3native: Dear ImGui console + the accelerated hashing/inflate paths. */
  function nativePanel() {
    var lib = null;
    try { lib = J3.native && Native.nativeInfo ? JSON.parse(Native.nativeInfo() || 'null') : null; }
    catch (e) { lib = null; }

    if (!lib) {
      return '<div class="panel"><h3>Native layer</h3>' +
        '<p class="sub">libj3native did not load on this device, so the app is running entirely on the JavaScript engines. Everything still works — just slower on very large APKs.</p></div>';
    }

    return '<div class="panel"><h3>Native layer</h3>' +
      '<p class="sub">libj3native.so — C++ compiled for this device</p>' +
      '<dl class="kv">' +
        '<dt>Dear ImGui</dt><dd>' + esc(lib.ui && lib.ui.imgui || '?') + '</dd>' +
        '<dt>zlib</dt><dd>' + esc(lib.core && lib.core.zlib || '?') + '</dd>' +
        '<dt>Built for</dt><dd>' + esc(lib.core && lib.core.abi || '?') + '</dd>' +
        '<dt>Accelerates</dt><dd>file hashing · raw inflate</dd>' +
      '</dl>' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="btn" id="in-console">⬢ Open native console</button>' +
      '</div>' +
      '<p class="tiny" style="margin-top:8px">GPU-rendered Dear ImGui on a GLSurfaceView. Back returns here.</p>' +
      '</div>';
  }

  function draw() {
    var i = J3.info();
    var secure = typeof isSecureContext !== 'undefined' ? isSecureContext : false;
    var subtle = typeof crypto !== 'undefined' && !!crypto.subtle;

    var host = J3.$('#in-body');
    host.innerHTML =
      '<div class="panel"><h3>This build</h3>' +
      '<dl class="kv">' +
        '<dt>App</dt><dd>J3NSONTOP INDUSTRIES ' + esc(i.app || '?') + (i.build ? ' (build ' + i.build + ')' : '') + '</dd>' +
        '<dt>Shell</dt><dd>' + (J3.native ? 'Android WebView' : 'Browser') + '</dd>' +
        '<dt>Origin</dt><dd>' + esc(location.origin) + '</dd>' +
        '<dt>Network</dt><dd><span class="pill ok">no INTERNET permission</span></dd>' +
      '</dl></div>' +

      '<div class="panel"><h3>Device</h3>' +
      '<dl class="kv">' +
        '<dt>Model</dt><dd>' + esc(i.model || '?') + '</dd>' +
        '<dt>Android</dt><dd>' + esc(i.release || '?') + (i.sdk ? ' · API ' + i.sdk : '') + '</dd>' +
        '<dt>ABI</dt><dd>' + esc(i.abi || '?') + '</dd>' +
        '<dt>Screen</dt><dd>' + screen.width + '×' + screen.height +
          ' @ ' + (window.devicePixelRatio || 1) + 'x</dd>' +
        '<dt>Cores</dt><dd>' + (navigator.hardwareConcurrency || '?') + '</dd>' +
      '</dl></div>' +

      '<div class="panel"><h3>Engine capabilities</h3>' +
      '<p class="sub">What APK LAB can lean on here. Everything still works without the fast paths — it just takes longer.</p>' +
      '<dl class="kv">' +
        '<dt>Secure context</dt><dd>' + yesno(secure) + '</dd>' +
        '<dt>WebCrypto</dt><dd>' + yesno(subtle) + ' <span class="tiny">SHA hashes, certificate fingerprints</span></dd>' +
        '<dt>Native inflate</dt><dd>' + yesno(J3Bin.nativeInflate) +
          ' <span class="tiny">' + (J3Bin.nativeInflate ? 'DecompressionStream' : 'falling back to the JS inflater') + '</span></dd>' +
        '<dt>Native deflate</dt><dd>' + yesno(J3Bin.nativeDeflate) +
          ' <span class="tiny">' + (J3Bin.nativeDeflate ? 'CompressionStream' : 'repacks will be stored, not compressed') + '</span></dd>' +
        '<dt>Save to Downloads</dt><dd>' + yesno(J3.native) + '</dd>' +
        '<dt>Attribute table</dt><dd>' + J3Attrs.count + ' <span class="tiny">android:* ids</span></dd>' +
      '</dl></div>' +

      nativePanel() +

      '<div class="panel"><h3>Desktop toolkit</h3>' +
      '<p class="sub">The phone cannot sign an APK — that needs a keystore. The repo ships a companion CLI that does the signing, plus jadx/apktool hand-off when they are installed.</p>' +
      '<div class="out pre">apklab info    app.apk\n' +
      'apklab decode  app.apk -o out/\n' +
      'apklab build   out/ -o new.apk\n' +
      'apklab sign    new.apk\n' +
      'apklab verify  new.apk</div>' +
      '<p class="tiny" style="margin-top:8px">tools/apklab in the project folder · needs Node and the Android SDK build-tools.</p>' +
      '</div>' +

      '<div class="panel"><h3>J3NSONTOP INDUSTRIES</h3>' +
      '<p class="sub">Fun destruction division. We build the tools, the bad modders find out.</p>' +
      '<p class="muted" style="font-size:12px">Crew: J3NSONTOP · ER1K · DAM1AN</p>' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="btn ghost sm" id="in-intro">Replay intro</button>' +
        '<button class="btn ghost sm" id="in-copy">Copy diagnostics</button>' +
        '<button class="btn dang sm" id="in-reset">Reset app data</button>' +
      '</div></div>';

    var con = J3.$('#in-console');
    if (con) con.onclick = function () {
      J3.buzz(20);
      if (!(J3.native && Native.openConsole && Native.openConsole())) {
        J3.toast('Native console unavailable', true);
      }
    };

    J3.$('#in-intro').onclick = function () { J3.$('#replay').click(); };
    J3.$('#in-copy').onclick = function () {
      J3.copy(host.innerText.replace(/\n{3,}/g, '\n\n'), 'J3NSONTOP diagnostics');
    };
    J3.$('#in-reset').onclick = function () {
      J3.store.del('introSeen'); J3.store.del('lastView');
      J3.toast('Cleared. Restart the app for a fresh boot.');
    };
  }

  J3.view('intel', { render: render, mount: draw, show: draw });
}());
