/* J3NSONTOP INDUSTRIES - scanner.js
 *
 * Sweeps every installed app and ranks it by how much damage it could do.
 *
 * Read-only, always. It reports what PackageManager already exposes to the
 * Settings app — the value is in lining it up and scoring it, not in any
 * privileged access. Nothing here touches, modifies or launches another app.
 *
 * The three things that actually separate a dodgy sideload from a normal app:
 *   1. permissions far beyond what the app plausibly needs
 *   2. no install source (nothing recorded installing it = sideloaded or adb)
 *   3. a signer fingerprint that does not match the real publisher's
 */
(function () {
  'use strict';

  var $ = J3.$, $$ = J3.$$, esc = J3.esc;

  var result = null;      // last scan
  var q = '', filter = 'all', includeSystem = false;

  var LEVEL_COLOR = { high: '#FF3B3B', medium: '#FFC400', low: '#00E5FF', clean: '#7CFF00' };

  function render() {
    return '<div class="hero"><h1>APP<br>SCANNER</h1>' +
      '<p>What is already on this phone</p></div>' +
      '<div id="sc-body"></div>';
  }

  function idle() {
    if (!J3.native) {
      return '<div class="panel"><h3>Phone only</h3>' +
        '<p class="sub">The scanner reads the installed package list, which only exists inside the Android app. Open J3NSONTOP on a phone to use it.</p></div>';
    }
    return '<div class="drop" id="sc-go"><div class="big">◈</div>' +
      '<h3>Scan this device</h3>' +
      '<p>Ranks every installed app by what it is allowed to do.<br>Nothing is uploaded, nothing is changed.</p></div>' +
      '<div class="chips" style="margin-top:12px">' +
        '<button class="chip' + (includeSystem ? ' on' : '') + '" id="sc-sys">Include system apps</button>' +
      '</div>' +
      '<div class="panel"><h3>What gets flagged</h3>' +
      '<dl class="kv">' +
        '<dt>Accessibility</dt><dd>Can read and tap your whole screen — the single most abused permission on Android</dd>' +
        '<dt>Install packages</dt><dd>Can push other apps onto the device</dd>' +
        '<dt>Overlay</dt><dd>Can draw on top of other apps, which is how tap-jacking works</dd>' +
        '<dt>SMS &amp; calls</dt><dd>Can read codes sent to you, or spend money</dd>' +
        '<dt>Sideloaded</dt><dd>Nothing recorded installing it</dd>' +
        '<dt>Old target SDK</dt><dd>Predates runtime permissions, so it got them all at install</dd>' +
      '</dl></div>';
  }

  function scan() {
    var host = $('#sc-body');
    host.innerHTML = '<div class="panel"><h3>⧗ Scanning…</h3>' +
      '<div class="bar"><i style="width:40%"></i></div>' +
      '<p class="sub">Reading the package list and hashing signers.</p></div>';

    // The bridge call is synchronous and can take a second on a full device;
    // yielding first lets the "scanning" state actually paint.
    J3.yieldFrame().then(function () {
      var raw;
      try { raw = Native.scanApps(includeSystem); }
      catch (e) { raw = '{"error":"' + e.message + '"}'; }

      try { result = JSON.parse(raw); }
      catch (e) { result = { error: 'could not read the scan result' }; }

      if (result.error) {
        host.innerHTML = '<div class="panel"><h3 class="rd">Scan failed</h3>' +
          '<p class="sub">' + esc(result.error) + '</p></div>';
        return;
      }
      result.apps.sort(function (a, b) { return b.score - a.score || a.label.localeCompare(b.label); });
      J3.buzz(35);
      draw();
    });
  }

  function draw() {
    var host = $('#sc-body');
    if (!result) { host.innerHTML = idle(); wireIdle(); return; }

    var counts = { high: 0, medium: 0, low: 0, clean: 0 };
    result.apps.forEach(function (a) { counts[a.level]++; });

    host.innerHTML =
      '<div class="stats">' +
        '<div class="stat"><b>' + result.scanned + '</b><span>Scanned</span></div>' +
        '<div class="stat"><b class="rd">' + counts.high + '</b><span>High</span></div>' +
        '<div class="stat"><b class="am">' + counts.medium + '</b><span>Medium</span></div>' +
        '<div class="stat"><b class="acid">' + counts.clean + '</b><span>Clean</span></div>' +
      '</div>' +
      (result.canSeeAll === false
        ? '<div class="risk" style="--c:#FFC400"><b>Limited view</b><span>Android only handed over a few packages. The QUERY_ALL_PACKAGES permission may have been denied.</span></div>'
        : '') +
      '<div class="search"><input id="sc-q" type="text" placeholder="Search apps…" autocomplete="off">' +
      '<button class="clr" id="sc-qc">×</button></div>' +
      '<div class="chips" id="sc-filters">' +
        '<button class="chip' + (filter === 'all' ? ' on' : '') + '" data-f="all">All</button>' +
        '<button class="chip' + (filter === 'high' ? ' on' : '') + '" data-f="high">High</button>' +
        '<button class="chip' + (filter === 'medium' ? ' on' : '') + '" data-f="medium">Medium</button>' +
        '<button class="chip' + (filter === 'sideloaded' ? ' on' : '') + '" data-f="sideloaded">Sideloaded</button>' +
        '<button class="chip' + (filter === 'debuggable' ? ' on' : '') + '" data-f="debuggable">Debuggable</button>' +
      '</div>' +
      '<div id="sc-list"></div>' +
      '<div class="row" style="margin-top:14px">' +
        '<button class="btn ghost sm" id="sc-again">Rescan</button>' +
        '<button class="btn ghost sm" id="sc-report">Export report</button>' +
      '</div>';

    var input = $('#sc-q');
    input.oninput = function () { q = input.value.trim().toLowerCase(); list(); };
    $('#sc-qc').onclick = function () { input.value = ''; q = ''; list(); };
    $$('#sc-filters .chip').forEach(function (b) {
      b.onclick = function () {
        filter = b.dataset.f;
        $$('#sc-filters .chip').forEach(function (x) { x.classList.toggle('on', x === b); });
        J3.buzz(10);
        list();
      };
    });
    $('#sc-again').onclick = scan;
    $('#sc-report').onclick = exportReport;
    list();
  }

  function matches(a) {
    if (filter === 'sideloaded' && !a.sideloaded) return false;
    if (filter === 'debuggable' && !a.debuggable) return false;
    if ((filter === 'high' || filter === 'medium') && a.level !== filter) return false;
    if (!q) return true;
    return (a.label + ' ' + a.pkg).toLowerCase().indexOf(q) >= 0;
  }

  function list() {
    var hits = result.apps.filter(matches);
    if (!hits.length) { $('#sc-list').innerHTML = '<div class="empty">Nothing matches.</div>'; return; }

    $('#sc-list').innerHTML = hits.slice(0, 300).map(function (a, i) {
      var c = LEVEL_COLOR[a.level];
      return '<div class="card" data-i="' + result.apps.indexOf(a) + '" style="--c:' + c + ';cursor:pointer">' +
        '<span class="kind">' + esc(a.level) + (a.system ? ' · system' : '') + '</span>' +
        '<h3 style="font-size:16px">' + esc(a.label) + '</h3>' +
        '<p style="padding-right:0">' + esc(a.pkg) + '<br>' +
        '<span class="tiny">v' + esc(a.version) + ' · target SDK ' + a.targetSdk +
        ' · ' + a.permissionCount + ' permissions</span></p>' +
        '<span class="go">' + (a.risky.length ? a.risky.length + ' flagged' : 'nothing flagged') +
        ' <span>' + (a.sideloaded ? 'sideloaded' : esc(a.installer || '')) + '</span></span></div>';
    }).join('') + (hits.length > 300 ? '<div class="tiny" style="padding:10px">…and ' + (hits.length - 300) + ' more</div>' : '');

    $$('#sc-list .card').forEach(function (card) {
      card.onclick = function () { detail(+card.dataset.i); };
    });
  }

  function detail(i) {
    var a = result.apps[i];
    if (!a) return;
    var host = $('#sc-body');
    var prev = host.innerHTML;
    var c = LEVEL_COLOR[a.level];

    host.innerHTML = '<div class="panel" style="--c:' + c + '">' +
      '<h3>' + esc(a.label) + '</h3>' +
      '<p class="sub">' + esc(a.pkg) + '</p>' +
      '<dl class="kv">' +
        '<dt>Risk</dt><dd><span class="pill ' +
          (a.level === 'high' ? 'bad' : a.level === 'medium' ? 'warn' : 'ok') + '">' +
          esc(a.level) + '</span> <span class="tiny">score ' + a.score + '</span></dd>' +
        '<dt>Version</dt><dd>' + esc(a.version) + ' (' + a.versionCode + ')</dd>' +
        '<dt>Target SDK</dt><dd>' + a.targetSdk + (a.targetSdk < 26 ? ' <span class="pill warn">old</span>' : '') + '</dd>' +
        '<dt>Installed by</dt><dd>' + (a.sideloaded
            ? '<span class="am">nothing recorded — sideloaded or adb</span>'
            : esc(a.installer)) + '</dd>' +
        '<dt>Installed</dt><dd>' + new Date(a.installed).toISOString().slice(0, 10) + '</dd>' +
        '<dt>Updated</dt><dd>' + new Date(a.updated).toISOString().slice(0, 10) + '</dd>' +
        '<dt>Type</dt><dd>' + (a.system ? 'system app' : 'user app') +
          (a.debuggable ? ' <span class="pill bad">debuggable</span>' : '') +
          (a.enabled ? '' : ' <span class="pill dim">disabled</span>') + '</dd>' +
        '<dt>Permissions</dt><dd>' + a.permissionCount + ' requested</dd>' +
        '<dt>Signer</dt><dd style="word-break:break-all;font-size:10.5px">' +
          (a.signer ? esc(a.signer) : '—') + '</dd>' +
      '</dl>' +
      (a.risky.length
        ? '<h3 style="font-size:14px;margin-top:14px">What it can do</h3>' +
          a.risky.map(function (r) {
            return '<div class="risk" style="--c:' + c + '"><b>' + esc(r.why) + '</b>' +
              '<span>' + esc(r.perm) + '</span></div>';
          }).join('')
        : '<p class="muted" style="margin-top:12px">Nothing on the watch list.</p>') +
      '<div class="row" style="margin-top:12px">' +
        '<button class="btn ghost sm" id="sc-copy">Copy signer</button>' +
        '<button class="btn ghost sm" id="sc-share">Share findings</button>' +
      '</div>' +
      '<p class="tiny" style="margin-top:10px">A signer fingerprint is how you tell a fake from the real app: compare it against the publisher\'s official one.</p>' +
      '</div><button class="btn ghost" id="sc-back">◂ Back to results</button>';

    function goBack() { host.innerHTML = prev; rewire(); }
    $('#sc-back').onclick = goBack;
    J3.pushBack(goBack);
    $('#sc-copy').onclick = function () { J3.copy(a.signer || '', a.pkg); };
    $('#sc-share').onclick = function () {
      J3.share('J3NSONTOP scan — ' + a.label,
        a.label + ' (' + a.pkg + ')\nRisk: ' + a.level + ' (score ' + a.score + ')\n' +
        'Target SDK ' + a.targetSdk + (a.sideloaded ? '\nSideloaded' : '\nInstalled by ' + a.installer) +
        '\n' + a.risky.map(function (r) { return '- ' + r.why; }).join('\n') +
        '\nSigner ' + a.signer);
    };
  }

  /** After returning from a detail view the list handlers need rebinding. */
  function rewire() {
    var input = $('#sc-q');
    if (input) {
      input.oninput = function () { q = input.value.trim().toLowerCase(); list(); };
      $('#sc-qc').onclick = function () { input.value = ''; q = ''; list(); };
    }
    $$('#sc-filters .chip').forEach(function (b) {
      b.onclick = function () {
        filter = b.dataset.f;
        $$('#sc-filters .chip').forEach(function (x) { x.classList.toggle('on', x === b); });
        list();
      };
    });
    var again = $('#sc-again'); if (again) again.onclick = scan;
    var rep = $('#sc-report'); if (rep) rep.onclick = exportReport;
    list();
  }

  function exportReport() {
    if (!result) return;
    var when = new Date().toISOString().slice(0, 19).replace('T', ' ');
    var lines = ['J3NSONTOP INDUSTRIES — device scan', when, '',
      'Scanned: ' + result.scanned + '   Flagged: ' + result.flagged, ''];

    result.apps.forEach(function (a) {
      if (a.level === 'clean') return;
      lines.push('[' + a.level.toUpperCase() + '] ' + a.label + '  (' + a.pkg + ')');
      lines.push('   v' + a.version + ' · target SDK ' + a.targetSdk +
                 (a.sideloaded ? ' · SIDELOADED' : ' · via ' + a.installer) +
                 (a.debuggable ? ' · DEBUGGABLE' : ''));
      a.risky.forEach(function (r) { lines.push('   - ' + r.why + ' (' + r.perm + ')'); });
      lines.push('   signer ' + a.signer);
      lines.push('');
    });

    J3.save('j3nsontop-device-scan.txt', 'text/plain', J3Bin.toUtf8(lines.join('\n')))
      .then(function (w) { J3.toast('Saved to ' + w); })
      .catch(function (e) { J3.toast(e.message, true); });
  }

  function wireIdle() {
    var go = $('#sc-go');
    if (go) go.onclick = scan;
    var sys = $('#sc-sys');
    if (sys) sys.onclick = function () {
      includeSystem = !includeSystem;
      sys.classList.toggle('on', includeSystem);
      J3.buzz(10);
    };
  }

  J3.view('scanner', {
    render: render,
    mount: function () { draw(); }
  });
}());
