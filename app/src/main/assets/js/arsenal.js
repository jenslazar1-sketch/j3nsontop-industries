/* J3NSONTOP INDUSTRIES - arsenal.js
 *
 * The catalogue: live sites, hosted tools, builds, crew.
 * One flat index behind the scenes so a single search box covers all of it.
 */
(function () {
  'use strict';

  var SITES = [
    { n: 'SERVERSIDE', k: 'Roblox', c: '#7CFF00',
      d: 'The J3NSONTOP serverside command deck for Roblox. Run the server, not the other way round.',
      l: 'roblox-admin-31i.pages.dev', u: 'https://roblox-admin-31i.pages.dev',
      tags: 'roblox admin serverside script executor command' },
    { n: 'HISTORIE SPAMMER', k: 'Universal', c: '#00E5FF',
      d: 'Historie spammer universal — the original J3NSONTOP utility build.',
      l: 'index-cwc.pages.dev', u: 'https://index-cwc.pages.dev',
      tags: 'spammer history universal utility' },
    { n: 'J3NSONTOP BROWSER', k: 'Landing page', c: '#FF00A8',
      d: 'Landing page for the J3NSONTOP Browser — our own browser, our own rules.',
      l: 'j3nsontop-browser-9f21mpzry-j3nsontop.vercel.app',
      u: 'https://j3nsontop-browser-9f21mpzry-j3nsontop.vercel.app',
      tags: 'browser landing web app' }
  ];

  var TOOLS = [
    { n: 'DESTRUCTION CONSOLE', k: 'Text weapon', c: '#7CFF00',
      d: 'Glitch-corrupt any text, forge block-letter banners and run a live ops terminal for your thumbnails.',
      l: 'j3nsontop-console.vercel.app', u: 'https://j3nsontop-console.vercel.app',
      tags: 'text glitch banner ascii thumbnail corrupt' },
    { n: 'J3NSONTOP GUARD', k: 'Defense', c: '#00E5FF',
      d: 'Counter-hacker deck: password cracking-time, sketchy-link inspector, scam-message detector. All offline in your browser.',
      l: 'j3nsontop-guard.vercel.app', u: 'https://j3nsontop-guard.vercel.app',
      tags: 'security password phishing scam defense hacker' },
    { n: 'LUA LAB', k: 'Dev tool', c: '#FF00A8',
      d: 'Format, minify and analyse Roblox Lua. Block-balance checker, deprecation warnings and a snippet vault.',
      l: 'j3nsontop-lualab.vercel.app', u: 'https://j3nsontop-lualab.vercel.app',
      tags: 'lua roblox code format minify script' }
  ];

  var DL = [
    { n: 'INDUSTRIES APK', k: 'Android build', c: '#7CFF00',
      d: 'This app. Signed release and debug builds of J3NSONTOP INDUSTRIES, with checksums and install notes.',
      l: 'drive.google.com › industries apk builds',
      u: 'https://drive.google.com/drive/folders/1DjJN0nYo9hbRurZj5KdKgrygFIy2A9Db',
      tags: 'apk android download build industries toolbox apklab drive' },
    { n: 'BROWSER APK', k: 'Android build', c: '#FFC400',
      d: 'Signed and debug APK builds of the J3NSONTOP Browser, dropped as they are made.',
      l: 'drive.google.com › browser apk builds',
      u: 'https://drive.google.com/drive/folders/1PfRlwoyBbFiLYSxjma4p6lmMgBy_ENhv',
      tags: 'apk android download build browser drive' }
  ];

  var CREW = [
    { n: 'J3NSONTOP', r: 'Owner', c: '#7CFF00', d: 'Builds the sites, the browser and the tools. Runs the destruction.' },
    { n: 'ER1K', r: 'Best friend', c: '#00E5FF', d: 'Core crew. Field testing and target confirmation.' },
    { n: 'DAM1AN', r: 'Best friend', c: '#FF00A8', d: 'Core crew. Backup, ideas and chaos supply.' }
  ];

  var GROUPS = [
    { id: 'sites', label: 'Live sites', num: '01', items: SITES },
    { id: 'tools', label: 'Hosted tools', num: '02', items: TOOLS },
    { id: 'dl', label: 'Builds & downloads', num: '03', items: DL }
  ];

  var q = '', filter = 'all';

  function matches(o) {
    if (!q) return true;
    var hay = (o.n + ' ' + o.k + ' ' + o.d + ' ' + o.l + ' ' + (o.tags || '')).toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  function card(o, i) {
    return '<a class="card" href="' + J3.esc(o.u) + '" target="_blank" rel="noopener" style="--c:' + J3.esc(o.c) + '">' +
      '<span class="n">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="kind">' + J3.esc(o.k) + '</span>' +
      '<h3>' + J3.esc(o.n) + '</h3><p>' + J3.esc(o.d) + '</p>' +
      '<span class="go">OPEN ▸ <span>' + J3.esc(o.l) + '</span></span></a>';
  }

  function render() {
    var total = SITES.length + TOOLS.length + DL.length;
    return '' +
      '<div class="hero"><h1>THE<br>ARSENAL</h1>' +
      '<p>Everything J3NSONTOP Industries has shipped</p></div>' +

      '<div class="stats">' +
        '<div class="stat"><b>' + SITES.length + '</b><span>Live sites</span></div>' +
        '<div class="stat"><b>' + (TOOLS.length + 20) + '</b><span>Tools</span></div>' +
        '<div class="stat"><b>' + CREW.length + '</b><span>Crew</span></div>' +
        '<div class="stat"><b>∞</b><span>Destruction</span></div>' +
      '</div>' +

      '<div class="search">' +
        '<input id="ar-q" type="text" inputmode="search" autocomplete="off" ' +
          'placeholder="Search ' + total + ' entries…" aria-label="Search the arsenal">' +
        '<button class="clr" id="ar-clr" aria-label="Clear search">×</button>' +
      '</div>' +
      '<div class="chips" id="ar-chips">' +
        '<button class="chip on" data-f="all">All</button>' +
        GROUPS.map(function (g) { return '<button class="chip" data-f="' + g.id + '">' + g.label + '</button>'; }).join('') +
      '</div>' +

      '<div id="ar-results"></div>' +

      '<h2 class="sec"><i>04</i> The crew</h2>' +
      '<div class="crew">' + CREW.map(function (m) {
        return '<div class="mem" style="--c:' + J3.esc(m.c) + '">' +
          '<div class="av">' + J3.esc(m.n.slice(0, 2)) + '</div>' +
          '<h4>' + J3.esc(m.n) + '</h4><span>' + J3.esc(m.r) + '</span>' +
          '<p>' + J3.esc(m.d) + '</p></div>';
      }).join('') + '</div>';
  }

  function draw() {
    var host = J3.$('#ar-results');
    if (!host) return;
    var html = '', shown = 0, n = 0;

    GROUPS.forEach(function (g) {
      if (filter !== 'all' && filter !== g.id) { n += g.items.length; return; }
      var hits = g.items.filter(matches);
      if (!hits.length) { n += g.items.length; return; }
      html += '<h2 class="sec"><i>' + g.num + '</i> ' + g.label + '</h2><div class="cards">' +
        hits.map(function (o) { return card(o, g.items.indexOf(o) + n); }).join('') + '</div>';
      shown += hits.length;
      n += g.items.length;
    });

    host.innerHTML = shown ? html
      : '<div class="empty">Nothing matches “' + J3.esc(q) + '”.<br>Try the Toolbox — 20 more tools live inside the app.</div>';
  }

  J3.view('arsenal', {
    render: render,
    mount: function (host) {
      var input = J3.$('#ar-q', host);
      input.oninput = function () { q = input.value.trim(); draw(); };
      J3.$('#ar-clr', host).onclick = function () { input.value = ''; q = ''; draw(); input.focus(); };
      J3.$$('#ar-chips .chip', host).forEach(function (b) {
        b.onclick = function () {
          filter = b.dataset.f;
          J3.$$('#ar-chips .chip', host).forEach(function (x) { x.classList.toggle('on', x === b); });
          J3.buzz(10);
          draw();
        };
      });
      draw();
    }
  });
}());
