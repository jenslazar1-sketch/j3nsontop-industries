/* J3NSONTOP INDUSTRIES - core.js
 *
 * Shell: intro, router, back-stack, toasts and the native bridge.
 *
 * The bridge is optional everywhere. Everything here also runs in a plain
 * browser tab with no Android around it, which is what makes the whole app
 * testable on a desktop instead of only on a phone.
 */
var J3 = (function () {
  'use strict';

  var NATIVE = (function () { try { return typeof Native !== 'undefined' && Native.info; } catch (e) { return false; } }());

  /* iOS host bridge (WKScriptMessageHandler). Absent on Android and in a plain
   * browser, so every use is guarded and changes nothing on those platforms. */
  var IOS = (function () {
    try { return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.j3); }
    catch (e) { return false; }
  }());
  function iosPost(action, payload) {
    try {
      var msg = { action: action };
      if (payload) for (var k in payload) if (payload.hasOwnProperty(k)) msg[k] = payload[k];
      window.webkit.messageHandlers.j3.postMessage(msg);
      return true;
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------- helpers */

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /** Lets a long loop hand the frame back so the UI can actually paint. */
  function yieldFrame() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  var store = {
    get: function (k, dflt) {
      try { var v = localStorage.getItem('j3.' + k); return v === null ? dflt : JSON.parse(v); }
      catch (e) { return dflt; }
    },
    set: function (k, v) { try { localStorage.setItem('j3.' + k, JSON.stringify(v)); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem('j3.' + k); } catch (e) { } }
  };

  /* --------------------------------------------------------------- toast */

  var toastT = null;
  function toast(msg, bad) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.className = bad ? 'on bad' : 'on';
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.className = bad ? 'bad' : ''; }, bad ? 3800 : 2400);
    if (NATIVE && bad) buzz(40);
  }

  function buzz(ms) { try { if (NATIVE) Native.buzz(ms || 18); } catch (e) { } }

  function copy(text, label) {
    if (NATIVE) {
      try { Native.copy(label || 'J3NSONTOP', text); toast('Copied'); return; } catch (e) { }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied'); },
                                               function () { toast('Copy failed', true); });
      return;
    }
    toast('Copy not available', true);
  }

  function share(subject, text) {
    if (NATIVE) { try { Native.share(subject, text); return; } catch (e) { } }
    if (IOS && iosPost('share', { subject: subject || '', text: text || '' })) return;
    if (navigator.share) { navigator.share({ title: subject, text: text }).catch(function () { }); return; }
    copy(text);
  }

  /* ---------------------------------------------------------------- save */

  function b64(bytes) {
    var CH = 0x8000, parts = [];
    for (var i = 0; i < bytes.length; i += CH) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CH)));
    }
    return btoa(parts.join(''));
  }

  /**
   * Lands `bytes` as a real file. On Android that means /Downloads through the
   * chunked bridge; in a browser it is a normal object-URL download.
   * @returns Promise<string> where it landed, or '' if the user has no path.
   */
  function save(name, mime, bytes, onProgress) {
    // iOS: hand the bytes to the host, which writes a temp file and opens the
    // share sheet (save to Files, AirDrop, …). One message, not a chunked bridge.
    if (IOS) {
      if (onProgress) onProgress(bytes.length, bytes.length);
      return iosPost('save', { name: name, mime: mime || 'application/octet-stream', b64: b64(bytes) })
        ? Promise.resolve('the share sheet')
        : Promise.reject(new Error('Could not hand the file to iOS'));
    }
    if (!NATIVE) {
      try {
        var url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        return Promise.resolve(name);
      } catch (e) { return Promise.reject(e); }
    }

    var token;
    try { token = Native.beginSave(name); } catch (e) { return Promise.reject(e); }
    if (!token) return Promise.reject(new Error('Could not open a file to write'));

    // 1 MB of raw bytes per hop. Bigger just makes the base64 string and the
    // decode buffer bigger without going faster.
    var CHUNK = 1024 * 1024, at = 0;

    function step() {
      if (at >= bytes.length) {
        var where = Native.finishSave(token, name, mime || 'application/octet-stream');
        if (!where) return Promise.reject(new Error('Write failed'));
        return Promise.resolve(where);
      }
      var end = Math.min(at + CHUNK, bytes.length);
      if (!Native.writeChunk(token, b64(bytes.subarray(at, end)))) {
        return Promise.reject(new Error('Write failed at ' + at + ' bytes'));
      }
      at = end;
      if (onProgress) onProgress(at, bytes.length);
      return yieldFrame().then(step);
    }

    return step().catch(function (e) {
      try { Native.abortSave(token); } catch (x) { }
      throw e;
    });
  }

  function openUrl(url) {
    // The WebView hands http(s) straight to the system browser; in a tab this
    // is just a normal new window.
    if (IOS && iosPost('open', { url: url })) return;
    try { window.open(url, '_blank', 'noopener'); } catch (e) { location.href = url; }
  }

  /* -------------------------------------------------------------- router */

  var views = {}, current = null, backStack = [];

  function view(name, def) { views[name] = def; }

  function go(name, arg) {
    if (!views[name]) return;
    backStack.length = 0;
    $$('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === name); });
    $$('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'v-' + name); });
    current = name;
    var def = views[name];
    var host = $('#v-' + name);
    if (!def._built) { if (def.render) host.innerHTML = def.render(); def._built = true; if (def.mount) def.mount(host); }
    if (def.show) def.show(host, arg);
    window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
    store.set('lastView', name);
  }

  /** Views push a closer here so hardware Back unwinds panels before leaving. */
  function pushBack(fn) { backStack.push(fn); }

  function back() {
    if (backStack.length) { var fn = backStack.pop(); try { fn(); } catch (e) { } return true; }
    if (current && current !== 'arsenal') { go('arsenal'); return true; }
    return false;                                   // let Android close the app
  }

  /* --------------------------------------------------- files from Android */

  var incomingHandler = null, incomingQueued = null;

  /** Called by MainActivity when another app sends or opens a file with us. */
  function incoming(info) {
    if (incomingHandler) incomingHandler(info);
    else incomingQueued = info;
    return true;
  }

  function onIncoming(fn) {
    incomingHandler = fn;
    if (incomingQueued) { var q = incomingQueued; incomingQueued = null; fn(q); }
  }

  /** Pulls a handed-over file out of LocalServer as bytes. */
  function fetchHanded(id) {
    // iOS has no local server; the host injects shared-file bytes directly.
    if (IOS) {
      var m = window.__j3ios_files;
      if (m && m[id]) return Promise.resolve(m[id]);
    }
    return fetch('/__file/' + encodeURIComponent(id))
      .then(function (r) {
        if (!r.ok) throw new Error('Could not read that file (' + r.status + ')');
        return r.arrayBuffer();
      })
      .then(function (ab) { return new Uint8Array(ab); });
  }

  /* --------------------------------------------------------------- intro */

  var BOOT = [
    '> j3nsontop.industries — cold boot',
    '> mounting arsenal ........ OK',
    '> toolbox: 20 offline units',
    '> apk lab: decompiler + disassembler',
    '> destruction protocol .... ARMED'
  ];
  var T = [], done = false;
  function at(ms, fn) { T.push(setTimeout(fn, ms)); }
  function flick(a, t) {
    var f = $('#flick'); if (!f) return;
    f.style.opacity = a; setTimeout(function () { f.style.opacity = 0; }, t || 90);
  }

  var GL = '▓▒░#@$%&*АЖЩЯ+=|<>01';
  function scramble(node, final, dur) {
    var t0 = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      node.textContent = p < 1 && Math.random() < 1 - p ? GL[Math.floor(Math.random() * GL.length)] : final;
      if (p < 1) requestAnimationFrame(step); else node.textContent = final;
    })(t0);
  }

  function typeTag(txt, node, speed) {
    var i = 0;
    (function n() {
      if (done) return;
      node.innerHTML = txt.slice(0, ++i).replace(/DESTRUCTION/, '<b>DESTRUCTION</b>');
      if (i < txt.length) T.push(setTimeout(n, speed));
    }());
  }

  function runIntro(full) {
    done = false;
    T.forEach(clearTimeout); T = [];
    $('#intro').classList.remove('done');
    $('#app').classList.remove('on');
    document.body.classList.remove('appon');
    $('#bg').classList.remove('on');
    $('#skip').style.display = '';

    $('#boot').innerHTML = BOOT.map(function (l, i) {
      return '<span style="animation-delay:' + (i * .13) + 's">' + esc(l) + '</span>';
    }).join('');
    $('#boot').style.opacity = 1;
    $('#boot').style.transition = '';
    $('#word').innerHTML = 'J3NSONTOP'.split('').map(function (c) {
      return '<i data-c="' + c + '">' + c + '</i>';
    }).join('');
    $('#wipe').innerHTML = Array.from({ length: 14 }, function (_, i) {
      return '<b style="top:' + (i / 14 * 100) + '%;height:' + (100 / 14 + .4) +
             '%;animation-delay:' + ((i % 2 ? i : 13 - i) * .022) + 's"></b>';
    }).join('');

    $('#word').classList.remove('in', 'shake');
    $('#ind').classList.remove('in');
    $('#tag').classList.remove('in');
    $('#tag').innerHTML = '';

    // A 7-second logo is a treat once and a tax every launch after, so the
    // full reel only plays the first time; later boots get the 1.4s cut.
    var t = full ? 1 : 0.34;

    at(700 * t, function () { $('#bg').classList.add('on'); });
    at(950 * t, function () {
      flick(.75, 110);
      $('#boot').style.transition = 'opacity .3s'; $('#boot').style.opacity = 0;
    });
    at(1150 * t, function () {
      $('#word').classList.add('in');
      $$('#word i').forEach(function (node, i) {
        at(i * 62 * t, function () {
          node.classList.add('hit');
          scramble(node, node.dataset.c, 300 * t);
          if (i % 3 === 0) flick(.2, 50);
        });
      });
    });
    at(1850 * t, function () { $('#word').classList.add('shake'); flick(.5, 80); $('#ind').classList.add('in'); });
    if (full) {
      at(2400, function () {
        $('#tag').classList.add('in');
        typeTag('FUN DESTRUCTION DIVISION — WE TAKE CARE OF THE BAD GUYS', $('#tag'), 26);
      });
      at(4300, finish);
    } else {
      at(2100 * t, finish);
    }
  }

  function finish() {
    if (done) return;
    done = true;
    T.forEach(clearTimeout);
    var w = $('#wipe');
    w.classList.add('go'); flick(.8, 120);
    $('#bg').classList.add('on');
    setTimeout(function () {
      $('#intro').classList.add('done');
      $('#app').classList.add('on');
      document.body.classList.add('appon');
    }, 220);
    setTimeout(function () { w.classList.remove('go'); $('#skip').style.display = 'none'; }, 640);
  }

  /* ---------------------------------------------------------------- boot */

  function boot() {
    $('#skip').onclick = finish;
    $('#replay').onclick = function () { window.scrollTo({ top: 0 }); runIntro(true); };
    $('#brand').onclick = function (e) { e.preventDefault(); go('arsenal'); };

    $$('#nav button').forEach(function (b) {
      b.onclick = function () { buzz(12); go(b.dataset.view); };
    });

    Object.keys(views).forEach(function (k) { if (views[k].init) views[k].init(); });

    go('arsenal');

    var seen = store.get('introSeen', false);
    runIntro(!seen);
    store.set('introSeen', true);

    // An APK sent in from another app should land in the lab, not the menu.
    onIncoming(function (info) {
      go('apklab');
      finish();
      if (views.apklab && views.apklab.takeIncoming) views.apklab.takeIncoming(info);
    });
  }

  function info() {
    if (!NATIVE) {
      return { native: false, app: 'web', sdk: 0, model: navigator.userAgent.slice(0, 60), release: '-' };
    }
    try { return JSON.parse(Native.info()); } catch (e) { return { native: true }; }
  }

  return {
    boot: boot, go: go, back: back, view: view, pushBack: pushBack,
    incoming: incoming, onIncoming: onIncoming, fetchHanded: fetchHanded,
    $: $, $$: $$, esc: esc, el: el, yieldFrame: yieldFrame,
    toast: toast, copy: copy, share: share, save: save, buzz: buzz, openUrl: openUrl,
    store: store, info: info,
    get native() { return !!NATIVE; },
    get current() { return current; }
  };
}());
