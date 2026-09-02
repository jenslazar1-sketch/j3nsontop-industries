/* J3NSONTOP INDUSTRIES - toolbox.js
 *
 * Twenty tools that run entirely on the device. No network, no upload, no
 * "paste your API key into this website" - which is the whole point, because
 * the things people reach for these tools with (tokens, dumps, passwords) are
 * exactly the things you should not be pasting into a stranger's box.
 *
 * Each tool is { id, icon, name, desc, c, open(host) } and gets a panel to
 * itself. Adding a seventeenth means appending one object.
 */
(function () {
  'use strict';

  var $ = J3.$, esc = J3.esc;

  /* ================================================================ utils */

  function field(label, inner) {
    return '<div class="field"><label>' + esc(label) + '</label>' + inner + '</div>';
  }
  function area(id, ph, rows) {
    return '<textarea id="' + id + '" spellcheck="false" autocapitalize="off" autocomplete="off" ' +
      'placeholder="' + esc(ph || '') + '"' + (rows ? ' rows="' + rows + '"' : '') + '></textarea>';
  }
  function text(id, ph, val) {
    return '<input id="' + id + '" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" ' +
      'placeholder="' + esc(ph || '') + '" value="' + esc(val || '') + '">';
  }
  function sel(id, opts, cur) {
    return '<select id="' + id + '">' + opts.map(function (o) {
      var v = o.v !== undefined ? o.v : o, l = o.l !== undefined ? o.l : o;
      return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('') + '</select>';
  }
  function outBox(id, pre) { return '<div class="out' + (pre ? ' pre' : '') + '" id="' + id + '"></div>'; }
  function actions(list) {
    return '<div class="row" style="margin-top:10px">' + list.map(function (a) {
      return '<button class="btn' + (a.cls ? ' ' + a.cls : '') + '" id="' + a.id + '">' + esc(a.label) + '</button>';
    }).join('') + '</div>';
  }
  function copyBtn(getText) {
    return function () { var t = getText(); if (t) J3.copy(t); else J3.toast('Nothing to copy', true); };
  }
  function bind(id, ev, fn) { var n = $('#' + id); if (n) n[ev] = fn; }

  /* ================================================================== md5 */

  /* WebCrypto deliberately does not do MD5, and it is still what half the
   * world's checksums are printed in, so it comes along by hand. */
  function md5(bytes) {
    var S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    var K = new Int32Array(64);
    for (var i = 0; i < 64; i++) K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;

    var len = bytes.length;
    var withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
    withPad.set(bytes);
    withPad[len] = 0x80;
    var bitLen = len * 8;
    var dv = new DataView(withPad.buffer);
    dv.setUint32(withPad.length - 8, bitLen >>> 0, true);
    dv.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296), true);

    var a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
    var M = new Int32Array(16);

    for (var off = 0; off < withPad.length; off += 64) {
      for (i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
      var A = a0, Bv = b0, C = c0, D = d0, F, g;
      for (i = 0; i < 64; i++) {
        if (i < 16)      { F = (Bv & C) | (~Bv & D);   g = i; }
        else if (i < 32) { F = (D & Bv) | (~D & C);    g = (5 * i + 1) & 15; }
        else if (i < 48) { F = Bv ^ C ^ D;             g = (3 * i + 5) & 15; }
        else             { F = C ^ (Bv | ~D);          g = (7 * i) & 15; }
        F = (F + A + K[i] + M[g]) | 0;
        A = D; D = C; C = Bv;
        Bv = (Bv + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + Bv) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }

    var out = new Uint8Array(16), o = new DataView(out.buffer);
    o.setInt32(0, a0, true); o.setInt32(4, b0, true); o.setInt32(8, c0, true); o.setInt32(12, d0, true);
    return J3Bin.hex(out).toLowerCase();
  }

  function sha(algo, bytes) {
    if (typeof crypto === 'undefined' || !crypto.subtle) return Promise.resolve('(needs a secure context)');
    var buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return crypto.subtle.digest(algo, buf)
      .then(function (d) { return J3Bin.hex(new Uint8Array(d)).toLowerCase(); })
      .catch(function () { return '(unavailable)'; });
  }

  /* ============================================================= 01 glitch */

  var ZALGO_UP = '̍̎̄̅̿̑̆̐͒͗͑̇̈̊͂̓̈́͊͋͌̃̂̌͐̀́̋̏̒̓̔̽̉ͣͤͥͦͧͨͩͪͫͬͭͮͯ';
  var ZALGO_DN = '̖̗̘̙̜̝̞̟̠̤̥̦̩̪̫̬̭̮̯̰̱̲̳̹̺̻̼͇͈͉͍͎͓͔͕͖͙͚';
  var LEET = { a: '4', b: '8', e: '3', g: '6', i: '1', l: '1', o: '0', s: '5', t: '7', z: '2' };
  var FLIP = { a:'ɐ',b:'q',c:'ɔ',d:'p',e:'ǝ',f:'ɟ',g:'ƃ',h:'ɥ',i:'ᴉ',j:'ɾ',k:'ʞ',l:'l',m:'ɯ',n:'u',
               o:'o',p:'d',q:'b',r:'ɹ',s:'s',t:'ʇ',u:'n',v:'ʌ',w:'ʍ',x:'x',y:'ʎ',z:'z',
               '.':'˙', ',':"'", '?':'¿', '!':'¡', "'":',', '(':')', ')':'(', '[':']', ']':'[' };

  function zalgo(s, n) {
    return s.split('').map(function (ch) {
      if (ch === ' ') return ch;
      var out = ch;
      for (var i = 0; i < n; i++) {
        var set = Math.random() < .5 ? ZALGO_UP : ZALGO_DN;
        out += set.charAt(Math.floor(Math.random() * set.length));
      }
      return out;
    }).join('');
  }

  var GLITCH_MODES = {
    zalgo:   function (s) { return zalgo(s, 4); },
    corrupt: function (s) {
      var G = '▓▒░#@$%&*+=|<>';
      return s.split('').map(function (c) { return Math.random() < .22 ? G[Math.floor(Math.random() * G.length)] : c; }).join('');
    },
    leet:    function (s) { return s.replace(/[a-z]/gi, function (c) {
                 var l = LEET[c.toLowerCase()]; return l ? l : c; }); },
    flip:    function (s) { return s.toLowerCase().split('').reverse()
                 .map(function (c) { return FLIP[c] || c; }).join(''); },
    spaced:  function (s) { return s.split('').join(' '); },
    upper:   function (s) { return s.toUpperCase(); },
    alt:     function (s) { return s.split('').map(function (c, i) { return i % 2 ? c.toLowerCase() : c.toUpperCase(); }).join(''); },
    reverse: function (s) { return s.split('').reverse().join(''); },
    wide:    function (s) { return s.replace(/[!-~]/g, function (c) {
                 return String.fromCharCode(c.charCodeAt(0) + 0xFEE0); }).replace(/ /g, '　'); }
  };

  /* ============================================================= 02 banner */

  var FONT5 = {
    A:['.###.','#...#','#####','#...#','#...#'], B:['####.','#...#','####.','#...#','####.'],
    C:['.####','#....','#....','#....','.####'], D:['####.','#...#','#...#','#...#','####.'],
    E:['#####','#....','####.','#....','#####'], F:['#####','#....','####.','#....','#....'],
    G:['.####','#....','#..##','#...#','.###.'], H:['#...#','#...#','#####','#...#','#...#'],
    I:['#####','..#..','..#..','..#..','#####'], J:['####.','...#.','...#.','#..#.','.##..'],
    K:['#...#','#..#.','###..','#..#.','#...#'], L:['#....','#....','#....','#....','#####'],
    M:['#...#','##.##','#.#.#','#...#','#...#'], N:['#...#','##..#','#.#.#','#..##','#...#'],
    O:['.###.','#...#','#...#','#...#','.###.'], P:['####.','#...#','####.','#....','#....'],
    Q:['.###.','#...#','#.#.#','#..#.','.##.#'], R:['####.','#...#','####.','#..#.','#...#'],
    S:['.####','#....','.###.','....#','####.'], T:['#####','..#..','..#..','..#..','..#..'],
    U:['#...#','#...#','#...#','#...#','.###.'], V:['#...#','#...#','#...#','.#.#.','..#..'],
    W:['#...#','#...#','#.#.#','##.##','#...#'], X:['#...#','.#.#.','..#..','.#.#.','#...#'],
    Y:['#...#','.#.#.','..#..','..#..','..#..'], Z:['#####','...#.','..#..','.#...','#####'],
    '0':['.###.','#..##','#.#.#','##..#','.###.'], '1':['..#..','.##..','..#..','..#..','.###.'],
    '2':['.###.','#...#','..##.','.#...','#####'], '3':['####.','....#','.###.','....#','####.'],
    '4':['#..#.','#..#.','#####','...#.','...#.'], '5':['#####','#....','####.','....#','####.'],
    '6':['.###.','#....','####.','#...#','.###.'], '7':['#####','....#','...#.','..#..','..#..'],
    '8':['.###.','#...#','.###.','#...#','.###.'], '9':['.###.','#...#','.####','....#','.###.'],
    ' ':['.....','.....','.....','.....','.....'], '!':['..#..','..#..','..#..','.....','..#..'],
    '?':['.###.','#...#','..##.','.....','..#..'], '.':['.....','.....','.....','.....','..#..'],
    '-':['.....','.....','#####','.....','.....'], '_':['.....','.....','.....','.....','#####'],
    ':':['.....','..#..','.....','..#..','.....'], '/':['....#','...#.','..#..','.#...','#....']
  };

  function banner(str, on, off) {
    var chars = str.toUpperCase().split('').filter(function (c) { return FONT5[c]; });
    if (!chars.length) return '';
    var rows = ['', '', '', '', ''];
    chars.forEach(function (c, i) {
      FONT5[c].forEach(function (line, r) {
        rows[r] += line.replace(/#/g, on).replace(/\./g, off) + (i < chars.length - 1 ? off : '');
      });
    });
    return rows.join('\n');
  }

  /* ========================================================== 06 passwords */

  var SETS = {
    lower: 'abcdefghijkmnopqrstuvwxyz',
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    digit: '23456789',
    sym:   '!@#$%^&*-_=+?'
  };
  var SETS_FULL = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digit: '0123456789',
    sym:   '!@#$%^&*()-_=+[]{};:,.<>/?~'
  };

  function randInt(max) {
    // Rejection sampling, so the modulo does not quietly bias the first few
    // characters of every password this thing ever makes.
    var limit = Math.floor(4294967296 / max) * max;
    var a = new Uint32Array(1);
    do { crypto.getRandomValues(a); } while (a[0] >= limit);
    return a[0] % max;
  }

  function makePassword(len, opts) {
    var pool = '', required = [];
    var src = opts.readable ? SETS : SETS_FULL;
    ['lower', 'upper', 'digit', 'sym'].forEach(function (k) {
      if (!opts[k]) return;
      pool += src[k];
      required.push(src[k][randInt(src[k].length)]);
    });
    if (!pool) return '';
    var out = required.slice();
    for (var i = out.length; i < len; i++) out.push(pool[randInt(pool.length)]);
    for (i = out.length - 1; i > 0; i--) { var j = randInt(i + 1); var t = out[i]; out[i] = out[j]; out[j] = t; }
    return out.slice(0, Math.max(len, required.length)).join('');
  }

  function poolOf(pw) {
    var n = 0;
    if (/[a-z]/.test(pw)) n += 26;
    if (/[A-Z]/.test(pw)) n += 26;
    if (/[0-9]/.test(pw)) n += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) n += 33;
    return n || 1;
  }

  function crackTime(pw) {
    if (!pw) return null;
    var bits = pw.length * Math.log2(poolOf(pw));
    // 1e11 guesses/sec is a single modern GPU rig on a fast hash; it is the
    // number that keeps the estimate honest rather than reassuring.
    var seconds = Math.pow(2, bits - 1) / 1e11;
    return { bits: bits, seconds: seconds };
  }

  function humanTime(s) {
    if (s < 1) return 'instantly';
    var units = [['second', 60], ['minute', 60], ['hour', 24], ['day', 365], ['year', 1e12]];
    var v = s;
    for (var i = 0; i < units.length; i++) {
      if (v < units[i][1]) return Math.round(v) + ' ' + units[i][0] + (Math.round(v) === 1 ? '' : 's');
      v /= units[i][1];
    }
    if (v > 1e9) return 'longer than the universe has existed';
    return Math.round(v) + ' billion years';
  }

  /* ============================================================ 16 ciphers */

  function caesar(s, n) {
    return s.replace(/[a-z]/gi, function (c) {
      var base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode((c.charCodeAt(0) - base + (n % 26) + 26) % 26 + base);
    });
  }
  function vigenere(s, key, dec) {
    if (!key) return s;
    var k = key.toLowerCase().replace(/[^a-z]/g, '');
    if (!k) return s;
    var i = 0;
    return s.replace(/[a-z]/gi, function (c) {
      var base = c <= 'Z' ? 65 : 97;
      var shift = k.charCodeAt(i++ % k.length) - 97;
      if (dec) shift = -shift;
      return String.fromCharCode((c.charCodeAt(0) - base + shift + 26) % 26 + base);
    });
  }
  function xorHex(s, key) {
    if (!key) return s;
    var b = J3Bin.toUtf8(s), k = J3Bin.toUtf8(key), out = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) out[i] = b[i] ^ k[i % k.length];
    return J3Bin.hex(out).toLowerCase();
  }
  function xorFromHex(hex, key) {
    var clean = hex.replace(/[^0-9a-f]/gi, '');
    if (clean.length % 2) return '(hex needs an even number of digits)';
    var b = new Uint8Array(clean.length / 2);
    for (var i = 0; i < b.length; i++) b[i] = parseInt(clean.substr(i * 2, 2), 16);
    var k = J3Bin.toUtf8(key);
    for (i = 0; i < b.length; i++) b[i] ^= k[i % k.length];
    return J3Bin.utf8(b);
  }

  /* =============================================================== 12 diff */

  /* Classic LCS table. Capped because it is O(n*m) and nobody wants the tab to
   * die because they pasted two 20k-line files in. */
  function lineDiff(a, b) {
    var A = a.split('\n'), Bl = b.split('\n');
    if (A.length * Bl.length > 4000000) return null;
    var m = A.length, n = Bl.length;
    var dp = [];
    for (var i = 0; i <= m; i++) dp.push(new Int32Array(n + 1));
    for (i = m - 1; i >= 0; i--) {
      for (var j = n - 1; j >= 0; j--) {
        dp[i][j] = A[i] === Bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var out = [];
    i = 0; j = 0;
    while (i < m && j < n) {
      if (A[i] === Bl[j]) { out.push([' ', A[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['-', A[i]]); i++; }
      else { out.push(['+', Bl[j]]); j++; }
    }
    while (i < m) out.push(['-', A[i++]]);
    while (j < n) out.push(['+', Bl[j++]]);
    return out;
  }

  /* ============================================================ 15 magic */

  var MAGIC = [
    { ext: 'PNG image',        sig: [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A] },
    { ext: 'JPEG image',       sig: [0xFF,0xD8,0xFF] },
    { ext: 'GIF image',        sig: [0x47,0x49,0x46,0x38] },
    { ext: 'PDF document',     sig: [0x25,0x50,0x44,0x46] },
    { ext: 'Dalvik dex',       sig: [0x64,0x65,0x78,0x0A] },
    { ext: 'ELF binary (.so)', sig: [0x7F,0x45,0x4C,0x46] },
    { ext: 'Java class',       sig: [0xCA,0xFE,0xBA,0xBE] },
    { ext: 'gzip',             sig: [0x1F,0x8B] },
    { ext: 'bzip2',            sig: [0x42,0x5A,0x68] },
    { ext: '7-Zip',            sig: [0x37,0x7A,0xBC,0xAF,0x27,0x1C] },
    { ext: 'RAR archive',      sig: [0x52,0x61,0x72,0x21] },
    { ext: 'ZIP / APK / JAR',  sig: [0x50,0x4B,0x03,0x04] },
    { ext: 'ZIP (empty)',      sig: [0x50,0x4B,0x05,0x06] },
    { ext: 'WebP image',       sig: [0x52,0x49,0x46,0x46] },
    { ext: 'MP3 audio',        sig: [0x49,0x44,0x33] },
    { ext: 'SQLite database',  sig: [0x53,0x51,0x4C,0x69,0x74,0x65] },
    { ext: 'Android resources',sig: [0x02,0x00,0x0C,0x00] },
    { ext: 'Android binary XML', sig: [0x03,0x00,0x08,0x00] }
  ];

  function sniff(bytes) {
    for (var i = 0; i < MAGIC.length; i++) {
      var m = MAGIC[i], ok = true;
      for (var j = 0; j < m.sig.length; j++) if (bytes[j] !== m.sig[j]) { ok = false; break; }
      if (ok) return m.ext;
    }
    // Everything printable in the first block is almost certainly text.
    var n = Math.min(bytes.length, 512), printable = 0;
    for (i = 0; i < n; i++) if (bytes[i] === 9 || bytes[i] === 10 || bytes[i] === 13 || (bytes[i] >= 32 && bytes[i] < 127)) printable++;
    return n && printable / n > .95 ? 'Plain text' : 'Unknown binary';
  }

  /* ================================================================ tools */

  var TOOLS = [
    /* ---------------------------------------------------------------- 01 */
    { id: 'glitch', icon: '☠', name: 'Text Destroyer', c: '#7CFF00',
      desc: 'Zalgo, corrupt, leet, flip, fullwidth.',
      open: function () {
        return {
          html: field('Input', area('g-in', 'Type something to ruin…', 4)) +
                field('Mode', sel('g-mode', [
                  { v: 'zalgo', l: 'Zalgo — cursed' }, { v: 'corrupt', l: 'Corrupt — block noise' },
                  { v: 'leet', l: 'Leet — 1337' }, { v: 'flip', l: 'Flip — ǝpᴉsdn' },
                  { v: 'spaced', l: 'S p a c e d' }, { v: 'alt', l: 'AlTeRnAtInG' },
                  { v: 'upper', l: 'UPPERCASE' }, { v: 'reverse', l: 'Reversed' },
                  { v: 'wide', l: 'Ｆｕｌｌｗｉｄｔｈ' }
                ], 'zalgo')) +
                actions([{ id: 'g-run', label: 'Destroy' }, { id: 'g-copy', label: 'Copy', cls: 'ghost' }]) +
                outBox('g-out'),
          wire: function () {
            function run() {
              var v = $('#g-in').value;
              $('#g-out').textContent = v ? GLITCH_MODES[$('#g-mode').value](v) : '';
            }
            bind('g-run', 'onclick', function () { run(); J3.buzz(14); });
            bind('g-in', 'oninput', run);
            bind('g-mode', 'onchange', run);
            bind('g-copy', 'onclick', copyBtn(function () { return $('#g-out').textContent; }));
          }
        };
      } },

    /* ---------------------------------------------------------------- 02 */
    { id: 'banner', icon: '▛', name: 'Banner Forge', c: '#00E5FF',
      desc: 'Block-letter ASCII banners.',
      open: function () {
        return {
          html: field('Text', text('b-in', 'J3NSONTOP', 'J3NSONTOP')) +
                '<div class="row grow">' +
                field('Ink', sel('b-on', ['█', '#', '▓', '■', '@', '*', '0'], '█')) +
                field('Space', sel('b-off', [{ v: ' ', l: '(blank)' }, { v: '.', l: '.' }, { v: '·', l: '·' }], ' ')) +
                '</div>' +
                actions([{ id: 'b-copy', label: 'Copy', cls: 'ghost' }]) +
                outBox('b-out', true),
          wire: function () {
            function run() {
              $('#b-out').textContent = banner($('#b-in').value, $('#b-on').value, $('#b-off').value);
            }
            bind('b-in', 'oninput', run); bind('b-on', 'onchange', run); bind('b-off', 'onchange', run);
            bind('b-copy', 'onclick', copyBtn(function () { return $('#b-out').textContent; }));
            run();
          }
        };
      } },

    /* ---------------------------------------------------------------- 03 */
    { id: 'hash', icon: '#', name: 'Hash Lab', c: '#FF00A8',
      desc: 'MD5, SHA-1/256/384/512, CRC32.',
      open: function () {
        return {
          html: field('Text', area('h-in', 'Text to hash…', 3)) +
                '<div class="row"><button class="btn sm ghost" id="h-file">Hash a file instead</button>' +
                '<input type="file" id="h-fin" hidden></div>' +
                outBox('h-out'),
          wire: function () {
            function show(bytes, label) {
              var out = $('#h-out');
              out.innerHTML = '<span class="tiny">hashing ' + esc(label) + '…</span>';
              Promise.all([
                sha('SHA-1', bytes), sha('SHA-256', bytes), sha('SHA-384', bytes), sha('SHA-512', bytes)
              ]).then(function (r) {
                var rows = [
                  ['CRC32', ('00000000' + J3Bin.crc32(bytes).toString(16)).slice(-8)],
                  ['MD5', md5(bytes)], ['SHA-1', r[0]], ['SHA-256', r[1]], ['SHA-384', r[2]], ['SHA-512', r[3]]
                ];
                out.innerHTML = '<div class="tiny" style="margin-bottom:8px">' + esc(label) +
                  ' · ' + J3Bin.human(bytes.length) + '</div>' +
                  rows.map(function (row) {
                    return '<div style="margin-bottom:7px"><span class="acid tiny">' + row[0] +
                      '</span><br><span style="word-break:break-all;font-size:11.5px">' + row[1] + '</span></div>';
                  }).join('');
              });
            }
            var t = null;
            bind('h-in', 'oninput', function () {
              clearTimeout(t);
              var v = $('#h-in').value;
              if (!v) { $('#h-out').innerHTML = ''; return; }
              t = setTimeout(function () { show(J3Bin.toUtf8(v), 'text'); }, 180);
            });
            bind('h-file', 'onclick', function () { $('#h-fin').click(); });
            bind('h-fin', 'onchange', function (e) {
              var f = e.target.files && e.target.files[0];
              if (!f) return;
              f.arrayBuffer().then(function (ab) { show(new Uint8Array(ab), f.name); });
            });
          }
        };
      } },

    /* ---------------------------------------------------------------- 04 */
    { id: 'encode', icon: '⇄', name: 'Encoder', c: '#FFC400',
      desc: 'Base64, hex, URL, HTML, binary, morse.',
      open: function () {
        var MORSE = { a:'.-',b:'-...',c:'-.-.',d:'-..',e:'.',f:'..-.',g:'--.',h:'....',i:'..',j:'.---',
          k:'-.-',l:'.-..',m:'--',n:'-.',o:'---',p:'.--.',q:'--.-',r:'.-.',s:'...',t:'-',u:'..-',v:'...-',
          w:'.--',x:'-..-',y:'-.--',z:'--..','0':'-----','1':'.----','2':'..---','3':'...--','4':'....-',
          '5':'.....','6':'-....','7':'--...','8':'---..','9':'----.','.':'.-.-.-',',':'--..--','?':'..--..','/':'-..-.' };
        var UNMORSE = {};
        Object.keys(MORSE).forEach(function (k) { UNMORSE[MORSE[k]] = k; });

        var CODECS = {
          base64: {
            enc: function (s) { return btoa(String.fromCharCode.apply(null, J3Bin.toUtf8(s))); },
            dec: function (s) { return J3Bin.utf8(Uint8Array.from(atob(s.replace(/\s/g, '')), function (c) { return c.charCodeAt(0); })); }
          },
          base64url: {
            enc: function (s) { return CODECS.base64.enc(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
            dec: function (s) {
              s = s.replace(/-/g, '+').replace(/_/g, '/');
              while (s.length % 4) s += '=';
              return CODECS.base64.dec(s);
            }
          },
          hex: {
            enc: function (s) { return J3Bin.hex(J3Bin.toUtf8(s), ' ').toLowerCase(); },
            dec: function (s) {
              var c = s.replace(/[^0-9a-f]/gi, '');
              var b = new Uint8Array(Math.floor(c.length / 2));
              for (var i = 0; i < b.length; i++) b[i] = parseInt(c.substr(i * 2, 2), 16);
              return J3Bin.utf8(b);
            }
          },
          url:  { enc: encodeURIComponent, dec: decodeURIComponent },
          html: {
            enc: function (s) { return s.replace(/[&<>"']/g, function (c) {
              return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); },
            dec: function (s) { var d = document.createElement('textarea'); d.innerHTML = s; return d.value; }
          },
          rot13: { enc: function (s) { return caesar(s, 13); }, dec: function (s) { return caesar(s, 13); } },
          binary: {
            enc: function (s) { return Array.from(J3Bin.toUtf8(s)).map(function (b) {
              return ('0000000' + b.toString(2)).slice(-8); }).join(' '); },
            dec: function (s) {
              var bits = s.replace(/[^01]/g, '');
              var b = new Uint8Array(Math.floor(bits.length / 8));
              for (var i = 0; i < b.length; i++) b[i] = parseInt(bits.substr(i * 8, 8), 2);
              return J3Bin.utf8(b);
            }
          },
          morse: {
            enc: function (s) { return s.toLowerCase().split('').map(function (c) {
              return c === ' ' ? '/' : (MORSE[c] || ''); }).filter(Boolean).join(' '); },
            dec: function (s) { return s.trim().split(/\s+/).map(function (t) {
              return t === '/' ? ' ' : (UNMORSE[t] || ''); }).join(''); }
          }
        };

        return {
          html: field('Input', area('e-in', 'Anything…', 3)) +
                '<div class="row grow">' +
                field('Codec', sel('e-mode', [
                  'base64', 'base64url', 'hex', 'url', 'html', 'rot13', 'binary', 'morse'], 'base64')) +
                field('Direction', sel('e-dir', [{ v: 'enc', l: 'Encode' }, { v: 'dec', l: 'Decode' }], 'enc')) +
                '</div>' +
                actions([{ id: 'e-copy', label: 'Copy', cls: 'ghost' },
                         { id: 'e-swap', label: 'Result → input', cls: 'ghost' }]) +
                outBox('e-out'),
          wire: function () {
            function run() {
              var v = $('#e-in').value, out = $('#e-out');
              if (!v) { out.textContent = ''; return; }
              try { out.textContent = CODECS[$('#e-mode').value][$('#e-dir').value](v); }
              catch (err) { out.textContent = '⚠ ' + err.message; }
            }
            bind('e-in', 'oninput', run); bind('e-mode', 'onchange', run); bind('e-dir', 'onchange', run);
            bind('e-copy', 'onclick', copyBtn(function () { return $('#e-out').textContent; }));
            bind('e-swap', 'onclick', function () { $('#e-in').value = $('#e-out').textContent; run(); });
          }
        };
      } },

    /* ---------------------------------------------------------------- 05 */
    { id: 'json', icon: '{}', name: 'JSON Lab', c: '#7CFF00',
      desc: 'Format, minify, validate, measure.',
      open: function () {
        return {
          html: field('JSON', area('j-in', '{"hello":"world"}', 6)) +
                actions([{ id: 'j-fmt', label: 'Format' }, { id: 'j-min', label: 'Minify', cls: 'ghost' },
                         { id: 'j-copy', label: 'Copy', cls: 'ghost' }]) +
                outBox('j-out', true),
          wire: function () {
            function parse() {
              var v = $('#j-in').value.trim();
              if (!v) { $('#j-out').textContent = ''; return null; }
              try { return JSON.parse(v); }
              catch (e) {
                var m = /position (\d+)/.exec(e.message);
                var where = '';
                if (m) {
                  var upto = v.slice(0, +m[1]);
                  where = ' (line ' + (upto.split('\n').length) + ', col ' + (upto.length - upto.lastIndexOf('\n')) + ')';
                }
                $('#j-out').innerHTML = '<span class="rd">⚠ ' + esc(e.message) + esc(where) + '</span>';
                return null;
              }
            }
            function stats(o, s) {
              var nodes = 0, depth = 0;
              (function walk(v, d) {
                nodes++; if (d > depth) depth = d;
                if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k], d + 1); });
              }(o, 1));
              return '\n\n— ' + nodes + ' nodes · depth ' + depth + ' · ' + J3Bin.human(J3Bin.toUtf8(s).length);
            }
            bind('j-fmt', 'onclick', function () {
              var o = parse(); if (o === null) return;
              var s = JSON.stringify(o, null, 2);
              $('#j-out').textContent = s + stats(o, s);
            });
            bind('j-min', 'onclick', function () {
              var o = parse(); if (o === null) return;
              var s = JSON.stringify(o);
              $('#j-out').textContent = s + stats(o, s);
            });
            bind('j-copy', 'onclick', copyBtn(function () {
              return $('#j-out').textContent.split('\n\n— ')[0];
            }));
          }
        };
      } },

    /* ---------------------------------------------------------------- 06 */
    { id: 'pass', icon: '⚿', name: 'Password Forge', c: '#00E5FF',
      desc: 'Generate, and see how long it survives.',
      open: function () {
        return {
          html: '<div class="row grow">' +
                  field('Length', '<input id="p-len" type="number" min="4" max="128" value="20">') +
                  field('Style', sel('p-read', [{ v: '1', l: 'No lookalikes' }, { v: '0', l: 'Full charset' }], '1')) +
                '</div>' +
                '<div class="chips" id="p-sets">' +
                  '<button class="chip on" data-k="lower">a-z</button>' +
                  '<button class="chip on" data-k="upper">A-Z</button>' +
                  '<button class="chip on" data-k="digit">0-9</button>' +
                  '<button class="chip on" data-k="sym">!@#</button>' +
                '</div>' +
                actions([{ id: 'p-gen', label: 'Forge' }, { id: 'p-copy', label: 'Copy', cls: 'ghost' }]) +
                outBox('p-out') +
                '<div class="field" style="margin-top:14px"><label>Or check one you already use</label>' +
                text('p-check', 'type a password to rate it') + '</div>' +
                outBox('p-rate'),
          wire: function () {
            var sets = { lower: true, upper: true, digit: true, sym: true };
            J3.$$('#p-sets .chip').forEach(function (b) {
              b.onclick = function () {
                var k = b.dataset.k;
                if (sets[k] && Object.keys(sets).filter(function (x) { return sets[x]; }).length === 1) return;
                sets[k] = !sets[k];
                b.classList.toggle('on', sets[k]);
                gen();
              };
            });
            function rate(pw, into) {
              var c = crackTime(pw);
              if (!c) { into.innerHTML = ''; return; }
              var tone = c.bits < 40 ? 'rd' : c.bits < 60 ? 'am' : c.bits < 80 ? 'cy' : 'acid';
              var word = c.bits < 40 ? 'WEAK' : c.bits < 60 ? 'OK' : c.bits < 80 ? 'STRONG' : 'SERIOUS';
              into.innerHTML = '<div style="word-break:break-all;font-size:15px;margin-bottom:8px">' + esc(pw) + '</div>' +
                '<span class="pill ' + (tone === 'rd' ? 'bad' : tone === 'am' ? 'warn' : 'ok') + '">' + word + '</span>' +
                '<div class="tiny" style="margin-top:6px">' + Math.round(c.bits) + ' bits of entropy</div>' +
                '<div class="' + tone + '" style="font-size:12px;margin-top:4px">Offline cracking: ' + humanTime(c.seconds) + '</div>' +
                '<div class="tiny" style="margin-top:6px;color:var(--dim2)">assumes 100 billion guesses/sec</div>';
            }
            function gen() {
              var len = Math.max(4, Math.min(128, +$('#p-len').value || 20));
              var pw = makePassword(len, {
                lower: sets.lower, upper: sets.upper, digit: sets.digit, sym: sets.sym,
                readable: $('#p-read').value === '1'
              });
              rate(pw, $('#p-out'));
            }
            bind('p-gen', 'onclick', function () { gen(); J3.buzz(14); });
            bind('p-len', 'oninput', gen); bind('p-read', 'onchange', gen);
            bind('p-copy', 'onclick', copyBtn(function () {
              var n = $('#p-out').querySelector('div'); return n ? n.textContent : '';
            }));
            bind('p-check', 'oninput', function () { rate($('#p-check').value, $('#p-rate')); });
            gen();
          }
        };
      } },

    /* ---------------------------------------------------------------- 07 */
    { id: 'ids', icon: '⌗', name: 'ID Forge', c: '#FF00A8',
      desc: 'UUIDv4, ULID, tokens, hex.',
      open: function () {
        return {
          html: '<div class="row grow">' +
                  field('Kind', sel('i-kind', [
                    { v: 'uuid', l: 'UUID v4' }, { v: 'ulid', l: 'ULID (sortable)' },
                    { v: 'token', l: 'URL-safe token' }, { v: 'hex', l: 'Hex string' },
                    { v: 'num', l: 'Random numbers' }], 'uuid')) +
                  field('How many', '<input id="i-n" type="number" min="1" max="200" value="8">') +
                '</div>' +
                actions([{ id: 'i-gen', label: 'Forge' }, { id: 'i-copy', label: 'Copy all', cls: 'ghost' }]) +
                outBox('i-out', true),
          wire: function () {
            var B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
            function one(kind) {
              var b;
              switch (kind) {
                case 'uuid':
                  b = crypto.getRandomValues(new Uint8Array(16));
                  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
                  var h = J3Bin.hex(b).toLowerCase();
                  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
                case 'ulid':
                  var t = Date.now(), ts = '';
                  for (var i = 9; i >= 0; i--) { ts = B32[t % 32] + ts; t = Math.floor(t / 32); }
                  var r = crypto.getRandomValues(new Uint8Array(16)), rand = '';
                  for (i = 0; i < 16; i++) rand += B32[r[i] % 32];
                  return ts + rand;
                case 'token':
                  b = crypto.getRandomValues(new Uint8Array(24));
                  return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
                case 'hex':
                  return J3Bin.hex(crypto.getRandomValues(new Uint8Array(16))).toLowerCase();
                default:
                  return String(crypto.getRandomValues(new Uint32Array(1))[0]);
              }
            }
            function gen() {
              var n = Math.max(1, Math.min(200, +$('#i-n').value || 8));
              var kind = $('#i-kind').value, out = [];
              for (var i = 0; i < n; i++) out.push(one(kind));
              $('#i-out').textContent = out.join('\n');
            }
            bind('i-gen', 'onclick', function () { gen(); J3.buzz(12); });
            bind('i-kind', 'onchange', gen); bind('i-n', 'oninput', gen);
            bind('i-copy', 'onclick', copyBtn(function () { return $('#i-out').textContent; }));
            gen();
          }
        };
      } },

    /* ---------------------------------------------------------------- 08 */
    { id: 'units', icon: '⚖', name: 'Unit Converter', c: '#FFC400',
      desc: 'Data, time, length, weight, temperature.',
      open: function () {
        var SETS_U = {
          data:   { base: 'byte', u: { B:1, KB:1e3, MB:1e6, GB:1e9, TB:1e12, KiB:1024, MiB:1048576, GiB:1073741824, TiB:1099511627776, bit:0.125 } },
          time:   { base: 'second', u: { ms:0.001, s:1, min:60, h:3600, day:86400, week:604800, year:31557600 } },
          length: { base: 'metre', u: { mm:0.001, cm:0.01, m:1, km:1000, in:0.0254, ft:0.3048, yd:0.9144, mile:1609.344 } },
          mass:   { base: 'kilogram', u: { mg:1e-6, g:0.001, kg:1, t:1000, oz:0.028349523125, lb:0.45359237, st:6.35029318 } },
          speed:  { base: 'm/s', u: { 'm/s':1, 'km/h':0.277777778, mph:0.44704, knot:0.514444444 } }
        };
        return {
          html: field('Category', sel('u-cat', Object.keys(SETS_U).concat(['temperature']), 'data')) +
                '<div class="row grow">' +
                  field('Value', '<input id="u-val" type="number" step="any" value="1">') +
                  field('From', '<select id="u-from"></select>') +
                  field('To', '<select id="u-to"></select>') +
                '</div>' +
                outBox('u-out'),
          wire: function () {
            function units() {
              var cat = $('#u-cat').value;
              return cat === 'temperature' ? ['C', 'F', 'K'] : Object.keys(SETS_U[cat].u);
            }
            function fill() {
              var list = units();
              var opts = list.map(function (u) { return '<option value="' + u + '">' + u + '</option>'; }).join('');
              $('#u-from').innerHTML = opts; $('#u-to').innerHTML = opts;
              $('#u-from').selectedIndex = 0;
              $('#u-to').selectedIndex = Math.min(1, list.length - 1);
              run();
            }
            function toBase(cat, v, u) {
              if (cat !== 'temperature') return v * SETS_U[cat].u[u];
              return u === 'C' ? v + 273.15 : u === 'F' ? (v - 32) * 5 / 9 + 273.15 : v;
            }
            function fromBase(cat, v, u) {
              if (cat !== 'temperature') return v / SETS_U[cat].u[u];
              return u === 'C' ? v - 273.15 : u === 'F' ? (v - 273.15) * 9 / 5 + 32 : v;
            }
            function run() {
              var cat = $('#u-cat').value, v = parseFloat($('#u-val').value);
              if (isNaN(v)) { $('#u-out').textContent = ''; return; }
              var from = $('#u-from').value, to = $('#u-to').value;
              var r = fromBase(cat, toBase(cat, v, from), to);
              var pretty = Math.abs(r) >= 1e-4 && Math.abs(r) < 1e12
                ? parseFloat(r.toPrecision(10)).toLocaleString('en-US', { maximumFractionDigits: 8 })
                : r.toExponential(6);
              $('#u-out').innerHTML = '<div style="font-size:22px" class="acid">' + esc(pretty) + ' <span class="tiny">' + esc(to) + '</span></div>' +
                '<div class="tiny" style="margin-top:6px">' + esc(v + ' ' + from) + ' = ' + esc(pretty + ' ' + to) + '</div>';
            }
            bind('u-cat', 'onchange', fill);
            bind('u-val', 'oninput', run); bind('u-from', 'onchange', run); bind('u-to', 'onchange', run);
            fill();
          }
        };
      } },

    /* ---------------------------------------------------------------- 09 */
    { id: 'epoch', icon: '◷', name: 'Epoch Lab', c: '#7CFF00',
      desc: 'Unix timestamps ⇄ real dates.',
      open: function () {
        return {
          html: field('Unix timestamp (s or ms)', text('t-in', String(Math.floor(Date.now() / 1000)))) +
                actions([{ id: 't-now', label: 'Now', cls: 'ghost' }, { id: 't-copy', label: 'Copy', cls: 'ghost' }]) +
                outBox('t-out') +
                field('…or a date', text('t-date', 'e.g. 2026-12-24 18:30')) +
                outBox('t-out2'),
          wire: function () {
            function run() {
              var raw = $('#t-in').value.trim();
              if (!/^\d+$/.test(raw)) { $('#t-out').textContent = raw ? '⚠ digits only' : ''; return; }
              var n = +raw;
              var ms = raw.length > 11 ? n : n * 1000;     // 11+ digits is already ms
              var d = new Date(ms);
              if (isNaN(d.getTime())) { $('#t-out').textContent = '⚠ out of range'; return; }
              var delta = (Date.now() - ms) / 1000;
              $('#t-out').innerHTML =
                '<div class="acid" style="font-size:14px">' + esc(d.toISOString().replace('T', ' ').slice(0, 19)) + ' UTC</div>' +
                '<div style="margin-top:5px;font-size:12.5px">' + esc(d.toString()) + '</div>' +
                '<div class="tiny" style="margin-top:6px">' +
                  (delta >= 0 ? humanTime(delta) + ' ago' : 'in ' + humanTime(-delta)) +
                '</div>';
            }
            function run2() {
              var v = $('#t-date').value.trim();
              if (!v) { $('#t-out2').textContent = ''; return; }
              var d = new Date(v.replace(' ', 'T'));
              if (isNaN(d.getTime())) d = new Date(v);
              if (isNaN(d.getTime())) { $('#t-out2').innerHTML = '<span class="rd">⚠ could not read that date</span>'; return; }
              $('#t-out2').innerHTML = '<span class="acid">' + Math.floor(d.getTime() / 1000) + '</span>' +
                ' <span class="tiny">seconds</span><br><span class="cy">' + d.getTime() + '</span> <span class="tiny">ms</span>';
            }
            bind('t-in', 'oninput', run); bind('t-date', 'oninput', run2);
            bind('t-now', 'onclick', function () { $('#t-in').value = Math.floor(Date.now() / 1000); run(); });
            bind('t-copy', 'onclick', copyBtn(function () { return $('#t-out').textContent; }));
            run();
          }
        };
      } },

    /* ---------------------------------------------------------------- 10 */
    { id: 'color', icon: '◐', name: 'Color Lab', c: '#00E5FF',
      desc: 'HEX ⇄ RGB ⇄ HSL, shades, contrast.',
      open: function () {
        return {
          html: field('Colour', text('c-in', '#7CFF00', '#7CFF00')) + outBox('c-out'),
          wire: function () {
            function parse(s) {
              s = s.trim();
              var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
              if (m) {
                var h = m[1];
                if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
                return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
              }
              m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
              if (m) return [+m[1], +m[2], +m[3]];
              return null;
            }
            function toHsl(r, g, b) {
              r /= 255; g /= 255; b /= 255;
              var mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx - mn;
              var h = 0, s = 0, l = (mx + mn) / 2;
              if (d) {
                s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
                h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
                h *= 60;
              }
              return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
            }
            function lum(r, g, b) {
              var a = [r, g, b].map(function (v) {
                v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
              });
              return .2126 * a[0] + .7152 * a[1] + .0722 * a[2];
            }
            function hx(n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); }
            function run() {
              var rgb = parse($('#c-in').value);
              if (!rgb) { $('#c-out').innerHTML = '<span class="rd">⚠ try #7CFF00 or rgb(124,255,0)</span>'; return; }
              var hex = '#' + hx(rgb[0]) + hx(rgb[1]) + hx(rgb[2]);
              var hsl = toHsl(rgb[0], rgb[1], rgb[2]);
              var L = lum(rgb[0], rgb[1], rgb[2]);
              var onWhite = (1.05) / (L + .05), onBlack = (L + .05) / .05;
              var shades = [];
              for (var i = -4; i <= 4; i++) {
                if (!i) { shades.push(hex); continue; }
                var f = i < 0 ? 1 + i * .18 : 1 - i * .16;
                shades.push(i < 0
                  ? '#' + hx(rgb[0]*f) + hx(rgb[1]*f) + hx(rgb[2]*f)
                  : '#' + hx(rgb[0]+(255-rgb[0])*(i*.18)) + hx(rgb[1]+(255-rgb[1])*(i*.18)) + hx(rgb[2]+(255-rgb[2])*(i*.18)));
              }
              $('#c-out').innerHTML =
                '<div style="height:52px;border-radius:10px;margin-bottom:11px;background:' + hex + '"></div>' +
                '<dl class="kv">' +
                  '<dt>HEX</dt><dd>' + hex.toUpperCase() + '</dd>' +
                  '<dt>RGB</dt><dd>rgb(' + rgb.join(', ') + ')</dd>' +
                  '<dt>HSL</dt><dd>hsl(' + hsl[0] + ', ' + hsl[1] + '%, ' + hsl[2] + '%)</dd>' +
                  '<dt>On white</dt><dd>' + onWhite.toFixed(2) + ':1 ' + (onWhite >= 4.5 ? '<span class="pill ok">AA</span>' : '<span class="pill bad">fails AA</span>') + '</dd>' +
                  '<dt>On black</dt><dd>' + onBlack.toFixed(2) + ':1 ' + (onBlack >= 4.5 ? '<span class="pill ok">AA</span>' : '<span class="pill bad">fails AA</span>') + '</dd>' +
                '</dl>' +
                '<div style="display:flex;gap:3px;margin-top:10px">' + shades.map(function (s) {
                  return '<div style="flex:1;height:30px;background:' + s + '" title="' + s + '"></div>';
                }).join('') + '</div>';
            }
            bind('c-in', 'oninput', run);
            run();
          }
        };
      } },

    /* ---------------------------------------------------------------- 11 */
    { id: 'regex', icon: '.*', name: 'Regex Lab', c: '#FF00A8',
      desc: 'Test patterns, see every match.',
      open: function () {
        return {
          html: '<div class="row grow">' +
                  field('Pattern', text('r-pat', 'https?://\\S+')) +
                  field('Flags', text('r-flags', 'gi', 'gi')) +
                '</div>' +
                field('Test against', area('r-in', 'Paste text here…', 5)) +
                outBox('r-out'),
          wire: function () {
            function run() {
              var pat = $('#r-pat').value, flags = $('#r-flags').value.replace(/[^gimsuy]/g, '');
              var subject = $('#r-in').value;
              if (!pat || !subject) { $('#r-out').textContent = ''; return; }
              var re;
              try { re = new RegExp(pat, flags.indexOf('g') < 0 ? flags + 'g' : flags); }
              catch (e) { $('#r-out').innerHTML = '<span class="rd">⚠ ' + esc(e.message) + '</span>'; return; }

              var out = [], m, guard = 0;
              while ((m = re.exec(subject)) !== null && guard++ < 500) {
                out.push(m);
                if (m.index === re.lastIndex) re.lastIndex++;   // zero-length match
              }
              if (!out.length) { $('#r-out').innerHTML = '<span class="tiny">no matches</span>'; return; }
              $('#r-out').innerHTML = '<div class="tiny" style="margin-bottom:8px">' + out.length +
                ' match' + (out.length === 1 ? '' : 'es') + '</div>' +
                out.slice(0, 200).map(function (mm, i) {
                  var groups = mm.length > 1
                    ? '<div class="tiny" style="margin-top:3px">' + mm.slice(1).map(function (g, gi) {
                        return '$' + (gi + 1) + '=' + esc(g === undefined ? '—' : g); }).join(' · ') + '</div>'
                    : '';
                  return '<div style="margin-bottom:7px"><span class="acid">' + (i + 1) + '.</span> ' +
                    '<span style="word-break:break-all">' + esc(mm[0]) + '</span>' +
                    '<span class="tiny"> @' + mm.index + '</span>' + groups + '</div>';
                }).join('');
            }
            ['r-pat', 'r-flags', 'r-in'].forEach(function (id) { bind(id, 'oninput', run); });
          }
        };
      } },

    /* ---------------------------------------------------------------- 12 */
    { id: 'diff', icon: '⇋', name: 'Diff Lab', c: '#FFC400',
      desc: 'Line-by-line comparison.',
      open: function () {
        return {
          html: field('A — original', area('d-a', '', 5)) +
                field('B — changed', area('d-b', '', 5)) +
                actions([{ id: 'd-run', label: 'Compare' }]) +
                outBox('d-out', true),
          wire: function () {
            bind('d-run', 'onclick', function () {
              var res = lineDiff($('#d-a').value, $('#d-b').value);
              if (!res) { $('#d-out').innerHTML = '<span class="rd">⚠ too big to diff — try smaller chunks</span>'; return; }
              var add = 0, del = 0;
              var html = res.map(function (r) {
                if (r[0] === '+') add++; else if (r[0] === '-') del++;
                var cls = r[0] === '+' ? 'acid' : r[0] === '-' ? 'rd' : '';
                return '<div class="' + cls + '">' + esc(r[0] + ' ' + r[1]) + '</div>';
              }).join('');
              $('#d-out').innerHTML = '<div class="tiny" style="margin-bottom:8px">' +
                '<span class="acid">+' + add + '</span> · <span class="rd">−' + del + '</span></div>' + html;
            });
          }
        };
      } },

    /* ---------------------------------------------------------------- 13 */
    { id: 'stats', icon: '≡', name: 'Text Stats', c: '#7CFF00',
      desc: 'Counts, entropy, reading time.',
      open: function () {
        return {
          html: field('Text', area('s-in', 'Paste anything…', 6)) + outBox('s-out'),
          wire: function () {
            function run() {
              var v = $('#s-in').value;
              if (!v) { $('#s-out').textContent = ''; return; }
              var words = v.trim() ? v.trim().split(/\s+/).length : 0;
              var bytes = J3Bin.toUtf8(v);
              var lines = v.split('\n').length;
              var sentences = (v.match(/[.!?]+(\s|$)/g) || []).length;
              var mins = words / 220;
              $('#s-out').innerHTML = '<dl class="kv">' +
                '<dt>Characters</dt><dd>' + v.length + ' <span class="tiny">(' + v.replace(/\s/g, '').length + ' without spaces)</span></dd>' +
                '<dt>Words</dt><dd>' + words + '</dd>' +
                '<dt>Lines</dt><dd>' + lines + '</dd>' +
                '<dt>Sentences</dt><dd>' + sentences + '</dd>' +
                '<dt>UTF-8 size</dt><dd>' + J3Bin.human(bytes.length) + ' <span class="tiny">(' + bytes.length + ' bytes)</span></dd>' +
                '<dt>Entropy</dt><dd>' + J3Bin.entropy(bytes).toFixed(2) + ' <span class="tiny">bits/byte</span></dd>' +
                '<dt>Read time</dt><dd>' + (mins < 1 ? '< 1 min' : Math.round(mins) + ' min') + '</dd>' +
                '</dl>';
            }
            bind('s-in', 'oninput', run);
          }
        };
      } },

    /* ---------------------------------------------------------------- 14 */
    { id: 'base', icon: '⑂', name: 'Base Converter', c: '#00E5FF',
      desc: 'Binary, octal, decimal, hex, base36.',
      open: function () {
        return {
          html: '<div class="row grow">' +
                  field('Value', text('n-in', '255', '255')) +
                  field('From base', sel('n-from', ['2','8','10','16','36'], '10')) +
                '</div>' + outBox('n-out'),
          wire: function () {
            function run() {
              var raw = $('#n-in').value.trim().replace(/^0[bxo]/i, '');
              var from = +$('#n-from').value;
              if (!raw) { $('#n-out').textContent = ''; return; }
              var n;
              try { n = BigInt(parseIn(raw, from)); } catch (e) { n = null; }
              if (n === null) { $('#n-out').innerHTML = '<span class="rd">⚠ not valid in base ' + from + '</span>'; return; }
              $('#n-out').innerHTML = '<dl class="kv">' +
                [['Binary', 2], ['Octal', 8], ['Decimal', 10], ['Hex', 16], ['Base36', 36]].map(function (r) {
                  var s = n.toString(r[1]);
                  return '<dt>' + r[0] + '</dt><dd style="word-break:break-all">' + esc(r[1] === 16 ? s.toUpperCase() : s) + '</dd>';
                }).join('') +
                '<dt>Bits</dt><dd>' + n.toString(2).length + '</dd>' +
                '<dt>As bytes</dt><dd>' + J3Bin.human(Number(n)) + '</dd>' +
                '</dl>';
            }
            /** BigInt has no radix parse, so fold the digits by hand. */
            function parseIn(s, base) {
              var digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
              var neg = s[0] === '-'; if (neg) s = s.slice(1);
              var acc = 0n, B = BigInt(base);
              for (var i = 0; i < s.length; i++) {
                var d = digits.indexOf(s[i].toLowerCase());
                if (d < 0) throw new Error('bad digit');
                acc = acc * B + BigInt(d);
              }
              return neg ? -acc : acc;
            }
            bind('n-in', 'oninput', run); bind('n-from', 'onchange', run);
            run();
          }
        };
      } },

    /* ---------------------------------------------------------------- 15 */
    { id: 'file', icon: '⛁', name: 'File Inspector', c: '#FF00A8',
      desc: 'Type, hashes, entropy, hex preview.',
      open: function () {
        return {
          html: '<div class="drop" id="f-drop"><div class="big">⛁</div>' +
                  '<h3>Drop a file</h3><p>Any file. Nothing leaves the device.</p></div>' +
                '<input type="file" id="f-in" hidden>' + outBox('f-out'),
          wire: function () {
            function look(f) {
              f.arrayBuffer().then(function (ab) {
                var b = new Uint8Array(ab);
                var out = $('#f-out');
                out.innerHTML = '<span class="tiny">reading…</span>';
                Promise.all([sha('SHA-1', b), sha('SHA-256', b)]).then(function (r) {
                  var head = b.subarray(0, 96);
                  out.innerHTML = '<dl class="kv">' +
                    '<dt>Name</dt><dd style="word-break:break-all">' + esc(f.name) + '</dd>' +
                    '<dt>Size</dt><dd>' + J3Bin.human(b.length) + ' <span class="tiny">(' + b.length + ' bytes)</span></dd>' +
                    '<dt>Looks like</dt><dd class="acid">' + esc(sniff(b)) + '</dd>' +
                    '<dt>Reported</dt><dd>' + esc(f.type || 'unknown') + '</dd>' +
                    '<dt>Entropy</dt><dd>' + J3Bin.entropy(b).toFixed(2) + ' bits/byte ' +
                      (J3Bin.entropy(b) > 7.5 ? '<span class="pill warn">compressed / encrypted</span>' : '') + '</dd>' +
                    '<dt>CRC32</dt><dd>' + ('00000000' + J3Bin.crc32(b).toString(16)).slice(-8) + '</dd>' +
                    '<dt>MD5</dt><dd style="word-break:break-all">' + md5(b) + '</dd>' +
                    '<dt>SHA-1</dt><dd style="word-break:break-all">' + r[0] + '</dd>' +
                    '<dt>SHA-256</dt><dd style="word-break:break-all">' + r[1] + '</dd>' +
                    '</dl><div class="tiny" style="margin:12px 0 5px">First 96 bytes</div>' +
                    '<div class="out pre" style="margin:0">' + esc(J3Bin.hex(head, ' ').replace(/((?:\S\S ){16})/g, '$1\n')) + '</div>';
                });
              });
            }
            var drop = $('#f-drop');
            drop.onclick = function () { $('#f-in').click(); };
            bind('f-in', 'onchange', function (e) { if (e.target.files[0]) look(e.target.files[0]); });
            ['dragenter', 'dragover'].forEach(function (ev) {
              drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
            });
            ['dragleave', 'drop'].forEach(function (ev) {
              drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
            });
            drop.addEventListener('drop', function (e) {
              if (e.dataTransfer.files && e.dataTransfer.files[0]) look(e.dataTransfer.files[0]);
            });
          }
        };
      } },

    /* ---------------------------------------------------------------- 16 */
    { id: 'cipher', icon: '⚙', name: 'Cipher Deck', c: '#FFC400',
      desc: 'Caesar, Vigenère, XOR.',
      open: function () {
        return {
          html: field('Text', area('x-in', '', 3)) +
                '<div class="row grow">' +
                  field('Cipher', sel('x-kind', [
                    { v: 'caesar', l: 'Caesar shift' }, { v: 'vigenere', l: 'Vigenère' }, { v: 'xor', l: 'XOR → hex' }], 'caesar')) +
                  field('Direction', sel('x-dir', [{ v: 'enc', l: 'Encrypt' }, { v: 'dec', l: 'Decrypt' }], 'enc')) +
                '</div>' +
                field('Key / shift', text('x-key', '13', '13')) +
                actions([{ id: 'x-copy', label: 'Copy', cls: 'ghost' }]) +
                outBox('x-out'),
          wire: function () {
            function run() {
              var v = $('#x-in').value, kind = $('#x-kind').value;
              var dec = $('#x-dir').value === 'dec', key = $('#x-key').value;
              if (!v) { $('#x-out').textContent = ''; return; }
              var r;
              if (kind === 'caesar') r = caesar(v, (dec ? -1 : 1) * (parseInt(key, 10) || 0));
              else if (kind === 'vigenere') r = vigenere(v, key, dec);
              else r = dec ? xorFromHex(v, key) : xorHex(v, key);
              $('#x-out').textContent = r;
            }
            ['x-in', 'x-key'].forEach(function (id) { bind(id, 'oninput', run); });
            ['x-kind', 'x-dir'].forEach(function (id) { bind(id, 'onchange', run); });
            bind('x-copy', 'onclick', copyBtn(function () { return $('#x-out').textContent; }));
            bind('x-kind', 'onchange', function () {
              $('#x-key').value = $('#x-kind').value === 'caesar' ? '13' : 'j3nsontop';
              run();
            });
          }
        };
      } },

    /* ---------------------------------------------------------------- 17 */
    { id: 'jwt', icon: '⛨', name: 'JWT Decoder', c: '#7CFF00',
      desc: 'Read a token without trusting a website.',
      open: function () {
        return {
          html: field('Token', area('w-in', 'eyJhbGciOi…', 4)) +
                '<p class="tiny">Decoded on this device. Never paste a live token into an online decoder — that is handing someone your session.</p>' +
                outBox('w-out'),
          wire: function () {
            function b64url(s) {
              s = s.replace(/-/g, '+').replace(/_/g, '/');
              while (s.length % 4) s += '=';
              return J3Bin.utf8(Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }));
            }
            function when(v) {
              if (typeof v !== 'number') return esc(String(v));
              var d = new Date(v * 1000);
              var delta = (Date.now() / 1000) - v;
              return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC <span class="tiny">(' +
                (delta > 0 ? humanTime(delta) + ' ago' : 'in ' + humanTime(-delta)) + ')</span>';
            }
            function run() {
              var t = $('#w-in').value.trim().replace(/^Bearer\s+/i, '');
              var out = $('#w-out');
              if (!t) { out.textContent = ''; return; }
              var parts = t.split('.');
              if (parts.length < 2) { out.innerHTML = '<span class="rd">⚠ not a JWT — expected header.payload.signature</span>'; return; }
              var head, body;
              try { head = JSON.parse(b64url(parts[0])); body = JSON.parse(b64url(parts[1])); }
              catch (e) { out.innerHTML = '<span class="rd">⚠ could not decode: ' + esc(e.message) + '</span>'; return; }

              var notes = [];
              if ((head.alg || '').toLowerCase() === 'none') {
                notes.push(['bad', 'alg is "none" — this token is unsigned and trivially forgeable']);
              }
              if (typeof body.exp === 'number') {
                notes.push(body.exp * 1000 < Date.now()
                  ? ['bad', 'Expired ' + humanTime(Date.now() / 1000 - body.exp) + ' ago']
                  : ['ok', 'Valid for another ' + humanTime(body.exp - Date.now() / 1000)]);
              } else {
                notes.push(['warn', 'No exp claim — this token never expires on its own']);
              }
              if (parts.length < 3 || !parts[2]) notes.push(['warn', 'No signature section']);

              var claims = Object.keys(body).map(function (k) {
                var v = body[k];
                var pretty = (k === 'exp' || k === 'iat' || k === 'nbf') ? when(v)
                  : esc(typeof v === 'object' ? JSON.stringify(v) : String(v));
                return '<dt>' + esc(k) + '</dt><dd>' + pretty + '</dd>';
              }).join('');

              out.innerHTML =
                notes.map(function (n) { return '<span class="pill ' + n[0] + '">' + esc(n[1]) + '</span>'; }).join(' ') +
                '<div class="tiny" style="margin:12px 0 4px">HEADER</div>' +
                '<div class="out pre" style="margin:0">' + esc(JSON.stringify(head, null, 2)) + '</div>' +
                '<div class="tiny" style="margin:12px 0 4px">CLAIMS</div>' +
                '<dl class="kv">' + claims + '</dl>' +
                '<p class="tiny" style="margin-top:10px">The signature is shown but not verified — that needs the issuer key.</p>';
            }
            bind('w-in', 'oninput', run);
          }
        };
      } },

    /* ---------------------------------------------------------------- 18 */
    { id: 'hex', icon: '⬓', name: 'Hex Viewer', c: '#00E5FF',
      desc: 'Classic hex + ASCII dump of any file.',
      open: function () {
        return {
          html: '<div class="row"><button class="btn sm" id="hx-file">Open a file</button>' +
                '<button class="btn sm ghost" id="hx-text">Use text instead</button>' +
                '<input type="file" id="hx-in" hidden></div>' +
                '<div id="hx-textwrap" hidden>' + field('Text', area('hx-t', 'Type anything…', 3)) + '</div>' +
                '<div class="row grow" id="hx-nav" hidden>' +
                  field('Offset', '<input id="hx-off" type="number" min="0" value="0" step="256">') +
                  field('Bytes', sel('hx-len', ['256', '512', '1024', '4096'], '512')) +
                '</div>' +
                outBox('hx-out', true),
          wire: function () {
            var data = null;
            function dump() {
              if (!data) { $('#hx-out').textContent = ''; return; }
              var off = Math.max(0, Math.min(data.length, +$('#hx-off').value || 0));
              var len = Math.min(+$('#hx-len').value || 512, data.length - off);
              var lines = [];
              for (var i = 0; i < len; i += 16) {
                var slice = data.subarray(off + i, off + i + Math.min(16, len - i));
                var hexs = [], asc = '';
                for (var j = 0; j < 16; j++) {
                  if (j < slice.length) {
                    hexs.push((slice[j] < 16 ? '0' : '') + slice[j].toString(16));
                    asc += (slice[j] >= 32 && slice[j] < 127) ? String.fromCharCode(slice[j]) : '.';
                  } else { hexs.push('  '); asc += ' '; }
                  if (j === 7) hexs.push('');
                }
                lines.push(('0000000' + (off + i).toString(16)).slice(-8) + '  ' +
                           hexs.join(' ') + ' |' + asc + '|');
              }
              $('#hx-out').textContent =
                J3Bin.human(data.length) + ' total · showing ' + len + ' bytes from 0x' + off.toString(16) +
                '\n\n' + lines.join('\n');
            }
            function load(bytes) {
              data = bytes;
              $('#hx-nav').hidden = false;
              $('#hx-off').value = 0;
              dump();
            }
            bind('hx-file', 'onclick', function () { $('#hx-in').click(); });
            bind('hx-in', 'onchange', function (e) {
              var f = e.target.files && e.target.files[0];
              if (f) f.arrayBuffer().then(function (ab) { load(new Uint8Array(ab)); });
            });
            bind('hx-text', 'onclick', function () {
              var w = $('#hx-textwrap');
              w.hidden = !w.hidden;
              if (!w.hidden) $('#hx-t').focus();
            });
            bind('hx-t', 'oninput', function () { load(J3Bin.toUtf8($('#hx-t').value)); });
            bind('hx-off', 'oninput', dump);
            bind('hx-len', 'onchange', dump);
          }
        };
      } },

    /* ---------------------------------------------------------------- 19 */
    { id: 'link', icon: '⚑', name: 'Link Inspector', c: '#FF00A8',
      desc: 'Pull a suspicious URL apart before you tap it.',
      open: function () {
        return {
          html: field('URL', area('k-in', 'https://…', 3)) +
                '<p class="tiny">Nothing is fetched. The link is only parsed, so inspecting it cannot tip anyone off or load anything.</p>' +
                outBox('k-out'),
          wire: function () {
            var SHORTENERS = ['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','is.gd','buff.ly','cutt.ly',
                              'rebrand.ly','shorturl.at','rb.gy','tiny.cc','shorte.st','adf.ly'];
            var ODD_TLD = ['zip','mov','xyz','top','tk','ml','ga','cf','gq','click','link','work','fit','rest','cam'];
            var BRANDS = ['paypal','google','apple','amazon','microsoft','roblox','discord','steam','netflix','facebook','instagram'];

            function run() {
              var raw = $('#k-in').value.trim();
              var out = $('#k-out');
              if (!raw) { out.textContent = ''; return; }
              var u;
              try { u = new URL(raw.indexOf('://') < 0 ? 'http://' + raw : raw); }
              catch (e) { out.innerHTML = '<span class="rd">⚠ not a URL I can parse</span>'; return; }

              var flags = [], score = 0;
              var host = u.hostname.toLowerCase();
              var labels = host.split('.');
              var tld = labels[labels.length - 1];
              var reg = labels.slice(-2).join('.');

              if (u.protocol === 'http:') { flags.push(['warn', 'Plain HTTP — anyone on the network can read or change this']); score += 2; }
              if (u.username || u.password) { flags.push(['bad', 'Credentials embedded in the URL — a classic disguise trick']); score += 4; }
              if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) { flags.push(['bad', 'Raw IP address instead of a domain name']); score += 3; }
              if (/xn--/.test(host)) { flags.push(['bad', 'Punycode domain — can be made to look like a real brand']); score += 4; }
              if (SHORTENERS.indexOf(host) >= 0) { flags.push(['warn', 'URL shortener — the real destination is hidden']); score += 2; }
              if (ODD_TLD.indexOf(tld) >= 0) { flags.push(['warn', 'Unusual top-level domain .' + tld]); score += 2; }
              if (labels.length > 4) { flags.push(['warn', labels.length + ' subdomain levels — often used to bury the real domain']); score += 2; }
              if (host.length > 40) { flags.push(['warn', 'Very long hostname']); score += 1; }

              // A brand name buried in a subdomain is not that brand's site.
              BRANDS.forEach(function (b) {
                if (host.indexOf(b) >= 0 && reg.indexOf(b) !== 0) {
                  flags.push(['bad', b + ' appears in the address but is not the real domain (' + reg + ')']);
                  score += 5;
                }
              });

              var params = [];
              u.searchParams.forEach(function (v, k) { params.push([k, v]); });
              if (params.some(function (p) { return /^(redirect|url|next|goto|return|continue|dest)$/i.test(p[0]); })) {
                flags.push(['warn', 'Has a redirect parameter — it may bounce you somewhere else']);
                score += 2;
              }

              if (!flags.length) flags.push(['ok', 'Nothing obviously wrong']);
              var verdict = score >= 7 ? ['bad', 'HIGH RISK'] : score >= 3 ? ['warn', 'BE CAREFUL'] : ['ok', 'LOOKS ORDINARY'];

              out.innerHTML =
                '<span class="pill ' + verdict[0] + '">' + verdict[1] + '</span>' +
                '<dl class="kv" style="margin-top:10px">' +
                  '<dt>Scheme</dt><dd>' + esc(u.protocol.replace(':', '')) + '</dd>' +
                  '<dt>Real domain</dt><dd class="acid">' + esc(reg) + '</dd>' +
                  '<dt>Full host</dt><dd style="word-break:break-all">' + esc(u.hostname) + '</dd>' +
                  (u.port ? '<dt>Port</dt><dd>' + esc(u.port) + '</dd>' : '') +
                  '<dt>Path</dt><dd style="word-break:break-all">' + esc(u.pathname || '/') + '</dd>' +
                  (params.length ? '<dt>Parameters</dt><dd>' + params.map(function (p) {
                      return esc(p[0]) + ' = ' + esc(p[1].length > 60 ? p[1].slice(0, 60) + '…' : p[1]);
                    }).join('<br>') + '</dd>' : '') +
                '</dl>' +
                flags.map(function (f) {
                  return '<div class="risk" style="--c:' +
                    (f[0] === 'bad' ? '#FF3B3B' : f[0] === 'warn' ? '#FFC400' : f[0] === 'ok' ? '#7CFF00' : '#00E5FF') +
                    '"><b>' + esc(f[1]) + '</b></div>';
                }).join('');
            }
            bind('k-in', 'oninput', run);
          }
        };
      } },

    /* ---------------------------------------------------------------- 20 */
    { id: 'lua', icon: '☾', name: 'Lua Minifier', c: '#FFC400',
      desc: 'Strip and check Roblox Lua.',
      open: function () {
        return {
          html: field('Lua', area('l-in', 'local x = 1 -- comment', 6)) +
                actions([{ id: 'l-min', label: 'Minify' }, { id: 'l-check', label: 'Check blocks', cls: 'ghost' },
                         { id: 'l-copy', label: 'Copy', cls: 'ghost' }]) +
                outBox('l-out', true),
          wire: function () {
            /* Walks the source once so comment markers inside strings are left
             * alone — a naive regex strip mangles any code containing a "--"
             * inside quotes, which Lua has plenty of. */
            function strip(src) {
              var out = '', i = 0, n = src.length;
              while (i < n) {
                var c = src[i];
                if (c === '"' || c === "'") {
                  var q = c; out += c; i++;
                  while (i < n) {
                    if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
                    out += src[i];
                    if (src[i] === q) { i++; break; }
                    i++;
                  }
                  continue;
                }
                if (c === '[' && (src[i + 1] === '[' || src[i + 1] === '=')) {
                  var m = /^\[(=*)\[/.exec(src.slice(i));
                  if (m) {
                    var close = ']' + m[1] + ']';
                    var end = src.indexOf(close, i + m[0].length);
                    if (end < 0) end = n; else end += close.length;
                    out += src.slice(i, end); i = end; continue;
                  }
                }
                if (c === '-' && src[i + 1] === '-') {
                  var lm = /^--\[(=*)\[/.exec(src.slice(i));
                  if (lm) {
                    var lc = ']' + lm[1] + ']';
                    var le = src.indexOf(lc, i + lm[0].length);
                    i = le < 0 ? n : le + lc.length;
                  } else {
                    while (i < n && src[i] !== '\n') i++;
                  }
                  continue;
                }
                out += c; i++;
              }
              return out;
            }
            function minify(src) {
              return strip(src).split('\n')
                .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
                .filter(Boolean).join('\n');
            }
            bind('l-min', 'onclick', function () {
              var src = $('#l-in').value;
              if (!src.trim()) return;
              var m = minify(src);
              $('#l-out').textContent = m + '\n\n— ' + src.length + ' to ' + m.length + ' chars (' +
                Math.round((1 - m.length / Math.max(1, src.length)) * 100) + '% smaller)';
            });
            bind('l-check', 'onclick', function () {
              var src = strip($('#l-in').value);
              var opens = (src.match(/\b(function|if|for|while|do|repeat)\b/g) || []).length;
              // "for/while ... do" opens one block, not two, so discount the do.
              var dos = (src.match(/\b(for|while)\b[^\n]*?\bdo\b/g) || []).length;
              var closes = (src.match(/\b(end|until)\b/g) || []).length;
              var net = opens - dos - closes;
              var paren = 0, brace = 0, bracket = 0;
              for (var i = 0; i < src.length; i++) {
                var ch = src[i];
                if (ch === '(') paren++; else if (ch === ')') paren--;
                else if (ch === '{') brace++; else if (ch === '}') brace--;
                else if (ch === '[') bracket++; else if (ch === ']') bracket--;
              }
              var rows = [
                ['Blocks', net === 0 ? 'balanced' : (net > 0 ? net + ' missing end' : (-net) + ' extra end'), net === 0],
                ['Parentheses', paren === 0 ? 'balanced' : paren + ' unclosed', paren === 0],
                ['Braces', brace === 0 ? 'balanced' : brace + ' unclosed', brace === 0],
                ['Brackets', bracket === 0 ? 'balanced' : bracket + ' unclosed', bracket === 0]
              ];
              $('#l-out').innerHTML = '<dl class="kv">' + rows.map(function (r) {
                return '<dt>' + r[0] + '</dt><dd class="' + (r[2] ? 'acid' : 'rd') + '">' + esc(r[1]) + '</dd>';
              }).join('') + '</dl>' +
              '<p class="tiny">Counting, not parsing — it catches the usual missing end, not every syntax error.</p>';
            });
            bind('l-copy', 'onclick', copyBtn(function () {
              return $('#l-out').textContent.split('\n\n— ')[0];
            }));
          }
        };
      } }
  ];

  /* ============================================================= the view */

  var q = '';

  function grid() {
    var hits = TOOLS.filter(function (t) {
      if (!q) return true;
      return (t.name + ' ' + t.desc + ' ' + t.id).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    });
    if (!hits.length) return '<div class="empty">No tool matches “' + esc(q) + '”.</div>';
    return '<div class="tools">' + hits.map(function (t) {
      return '<button class="tool" data-t="' + t.id + '" style="--c:' + t.c + '">' +
        '<span class="ti">' + t.icon + '</span>' +
        '<h4>' + esc(t.name) + '</h4><p>' + esc(t.desc) + '</p></button>';
    }).join('') + '</div>';
  }

  function render() {
    return '<div class="hero"><h1>THE<br>TOOLBOX</h1>' +
      '<p>' + TOOLS.length + ' units · everything runs offline</p></div>' +
      '<div class="search">' +
        '<input id="tb-q" type="text" inputmode="search" autocomplete="off" placeholder="Search tools…" aria-label="Search tools">' +
        '<button class="clr" id="tb-clr" aria-label="Clear">×</button>' +
      '</div>' +
      '<div id="tb-body"></div>';
  }

  function showGrid() {
    J3.$('#tb-body').innerHTML = grid();
    J3.$$('#tb-body .tool').forEach(function (b) {
      b.onclick = function () { openTool(b.dataset.t); };
    });
  }

  function openTool(id) {
    var t = TOOLS.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var built = t.open();
    J3.$('#tb-body').innerHTML =
      '<div class="panel" style="--c:' + t.c + '">' +
        '<h3><span style="color:' + t.c + '">' + t.icon + '</span> ' + esc(t.name) + '</h3>' +
        '<p class="sub">' + esc(t.desc) + '</p>' + built.html +
      '</div>' +
      '<button class="btn ghost" id="tb-back">◂ All tools</button>';
    built.wire();
    J3.$('#tb-back').onclick = showGrid;
    J3.pushBack(showGrid);
    J3.buzz(12);
    window.scrollTo({ top: 0 });
  }

  J3.view('toolbox', {
    render: render,
    mount: function (host) {
      var input = J3.$('#tb-q', host);
      input.oninput = function () { q = input.value.trim(); showGrid(); };
      J3.$('#tb-clr', host).onclick = function () { input.value = ''; q = ''; showGrid(); };
      showGrid();
    }
  });

  // APK LAB reuses these rather than carrying its own copies.
  J3.util = { md5: md5, sha: sha, sniff: sniff, humanTime: humanTime };
}());
