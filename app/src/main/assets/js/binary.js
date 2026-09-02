/* J3NSONTOP INDUSTRIES - binary.js
 *
 * Byte plumbing for APK LAB: cursors, CRC32, and a raw-DEFLATE codec.
 *
 * DecompressionStream('deflate-raw') does the heavy lifting when the WebView is
 * new enough, but minSdk is 24 and a phone that never updated its WebView has
 * neither that nor CompressionStream. The pure-JS inflate below is the floor:
 * slower, but it means "open any APK" is never a maybe.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.J3Bin = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- cursor */

  function Cur(buf, pos) {
    this.u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    this.p = pos || 0;
  }
  Cur.prototype = {
    get left() { return this.u8.length - this.p; },
    seek: function (p) { this.p = p; return this; },
    skip: function (n) { this.p += n; return this; },
    u8v:  function ()  { return this.u8[this.p++]; },
    u16:  function ()  { var v = this.dv.getUint16(this.p, true); this.p += 2; return v; },
    u32:  function ()  { var v = this.dv.getUint32(this.p, true); this.p += 4; return v; },
    i32:  function ()  { var v = this.dv.getInt32(this.p, true);  this.p += 4; return v; },
    u64:  function ()  { var lo = this.u32(), hi = this.u32(); return hi * 4294967296 + lo; },
    bytes: function (n) { var v = this.u8.subarray(this.p, this.p + n); this.p += n; return v; },
    at32: function (p) { return this.dv.getUint32(p, true); },
    at16: function (p) { return this.dv.getUint16(p, true); }
  };

  /* ---------------------------------------------------------------- writer */

  function Out(cap) {
    this.u8 = new Uint8Array(cap || 1024);
    this.n = 0;
  }
  Out.prototype = {
    need: function (extra) {
      if (this.n + extra <= this.u8.length) return;
      var cap = this.u8.length;
      while (cap < this.n + extra) cap *= 2;
      var next = new Uint8Array(cap);
      next.set(this.u8.subarray(0, this.n));
      this.u8 = next;
    },
    byte: function (v) { this.need(1); this.u8[this.n++] = v & 0xff; return this; },
    u16:  function (v) { this.need(2); this.u8[this.n++] = v & 0xff; this.u8[this.n++] = (v >>> 8) & 0xff; return this; },
    u32:  function (v) {
      this.need(4);
      this.u8[this.n++] = v & 0xff;         this.u8[this.n++] = (v >>> 8) & 0xff;
      this.u8[this.n++] = (v >>> 16) & 0xff; this.u8[this.n++] = (v >>> 24) & 0xff;
      return this;
    },
    u64: function (v) { this.u32(v >>> 0); this.u32(Math.floor(v / 4294967296) >>> 0); return this; },
    raw: function (b) { this.need(b.length); this.u8.set(b, this.n); this.n += b.length; return this; },
    zeros: function (n) { this.need(n); this.n += n; return this; },
    patch32: function (at, v) {
      this.u8[at] = v & 0xff;          this.u8[at + 1] = (v >>> 8) & 0xff;
      this.u8[at + 2] = (v >>> 16) & 0xff; this.u8[at + 3] = (v >>> 24) & 0xff;
    },
    done: function () { return this.u8.slice(0, this.n); }
  };

  /* ----------------------------------------------------------------- crc32 */

  var CRCT = (function () {
    var t = new Int32Array(256), c, i, k;
    for (i = 0; i < 256; i++) {
      c = i;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  }());

  function crc32(buf, seed) {
    var c = (seed === undefined ? 0 : seed) ^ -1;
    for (var i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  /* --------------------------------------------------------------- inflate */

  var LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DEXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var CLORD = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  /* Canonical Huffman as counts+symbols (the zlib "puff" shape): tiny to build,
   * and building a fast lookup table per block costs more than it saves when
   * most APK entries are a few KB of XML. */
  function huff(lengths, n) {
    var count = new Int32Array(16), i;
    for (i = 0; i < n; i++) count[lengths[i]]++;
    count[0] = 0;
    var offs = new Int32Array(17);
    for (i = 1; i < 16; i++) offs[i + 1] = offs[i] + count[i];
    var symbols = new Int32Array(n);
    for (i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    return { count: count, symbols: symbols };
  }

  function inflateRaw(src, hintSize) {
    var p = 0, bitbuf = 0, bitcnt = 0;
    var out = new Uint8Array(Math.max(hintSize || 0, 1024)), on = 0;

    function grow(extra) {
      if (on + extra <= out.length) return;
      var cap = out.length;
      while (cap < on + extra) cap *= 2;
      var nx = new Uint8Array(cap);
      nx.set(out.subarray(0, on));
      out = nx;
    }
    function bits(need) {
      var val = bitbuf;
      while (bitcnt < need) {
        if (p >= src.length) throw new Error('deflate: out of input');
        val |= src[p++] << bitcnt;
        bitcnt += 8;
      }
      bitbuf = val >>> need;
      bitcnt -= need;
      return val & ((1 << need) - 1);
    }
    function decode(h) {
      var code = 0, first = 0, index = 0, len, count;
      for (len = 1; len <= 15; len++) {
        code |= bits(1);
        count = h.count[len];
        if (code - first < count) return h.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('deflate: bad code');
    }

    var fixedLit = null, fixedDist = null;
    function fixed() {
      if (fixedLit) return;
      var l = new Uint8Array(288), i;
      for (i = 0;   i < 144; i++) l[i] = 8;
      for (i = 144; i < 256; i++) l[i] = 9;
      for (i = 256; i < 280; i++) l[i] = 7;
      for (i = 280; i < 288; i++) l[i] = 8;
      fixedLit = huff(l, 288);
      var d = new Uint8Array(30);
      for (i = 0; i < 30; i++) d[i] = 5;
      fixedDist = huff(d, 30);
    }

    var last = 0;
    do {
      last = bits(1);
      var type = bits(2);

      if (type === 0) {                       // stored
        bitbuf = 0; bitcnt = 0;
        if (p + 4 > src.length) throw new Error('deflate: truncated stored block');
        var len = src[p] | (src[p + 1] << 8);
        p += 4;                               // len + ~len
        if (p + len > src.length) throw new Error('deflate: truncated stored data');
        grow(len);
        out.set(src.subarray(p, p + len), on);
        on += len; p += len;
        continue;
      }

      var lit, dist;
      if (type === 1) {
        fixed(); lit = fixedLit; dist = fixedDist;
      } else if (type === 2) {
        var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, i;
        var clen = new Uint8Array(19);
        for (i = 0; i < ncode; i++) clen[CLORD[i]] = bits(3);
        var ch = huff(clen, 19);
        var lengths = new Uint8Array(nlen + ndist);
        i = 0;
        while (i < nlen + ndist) {
          var sym = decode(ch), rep, val;
          if (sym < 16) { lengths[i++] = sym; continue; }
          if (sym === 16) {
            if (i === 0) throw new Error('deflate: no previous length');
            val = lengths[i - 1]; rep = 3 + bits(2);
          } else if (sym === 17) { val = 0; rep = 3 + bits(3); }
          else                   { val = 0; rep = 11 + bits(7); }
          if (i + rep > nlen + ndist) throw new Error('deflate: length overflow');
          while (rep--) lengths[i++] = val;
        }
        lit = huff(lengths.subarray(0, nlen), nlen);
        dist = huff(lengths.subarray(nlen), ndist);
      } else {
        throw new Error('deflate: reserved block type');
      }

      for (;;) {
        var s = decode(lit);
        if (s < 256) { grow(1); out[on++] = s; continue; }
        if (s === 256) break;
        s -= 257;
        if (s >= 29) throw new Error('deflate: bad length code');
        var mlen = LBASE[s] + bits(LEXT[s]);
        var ds = decode(dist);
        if (ds >= 30) throw new Error('deflate: bad distance code');
        var mdist = DBASE[ds] + bits(DEXT[ds]);
        if (mdist > on) throw new Error('deflate: distance before start');
        grow(mlen);
        var from = on - mdist;
        for (var k = 0; k < mlen; k++) out[on++] = out[from + k];
      }
    } while (!last);

    return out.slice(0, on);
  }

  /* Native path when the WebView has it; both return a Promise so callers do
   * not have to care which one ran. */
  var hasNativeInflate = typeof DecompressionStream !== 'undefined';
  var hasNativeDeflate = typeof CompressionStream !== 'undefined';

  function pipe(bytes, stream) {
    return new Response(new Blob([bytes]).stream().pipeThrough(stream))
      .arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function inflate(bytes, hintSize) {
    if (hasNativeInflate) {
      try {
        return pipe(bytes, new DecompressionStream('deflate-raw'))
          .catch(function () { return inflateRaw(bytes, hintSize); });
      } catch (e) { /* fall through */ }
    }
    try { return Promise.resolve(inflateRaw(bytes, hintSize)); }
    catch (e) { return Promise.reject(e); }
  }

  function deflate(bytes) {
    if (!hasNativeDeflate) return Promise.resolve(null);   // caller stores instead
    try {
      return pipe(bytes, new CompressionStream('deflate-raw')).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  /* ------------------------------------------------------------ text bytes */

  var TD = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null;
  var TE = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  function utf8(bytes) {
    if (TD) return TD.decode(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  function toUtf8(str) {
    if (TE) return TE.encode(str);
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  function utf16(bytes, off, units) {
    var s = '';
    for (var i = 0; i < units; i++) {
      s += String.fromCharCode(bytes[off + i * 2] | (bytes[off + i * 2 + 1] << 8));
    }
    return s;
  }

  function hex(bytes, sep, max) {
    var s = [], n = Math.min(bytes.length, max === undefined ? bytes.length : max);
    for (var i = 0; i < n; i++) s.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16));
    return s.join(sep === undefined ? '' : sep).toUpperCase();
  }

  function human(n) {
    if (n === null || n === undefined || n < 0) return '?';
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  }

  /* Shannon entropy in bits/byte. 8.0 means encrypted or already compressed,
   * which is how packed/protected APKs give themselves away. */
  function entropy(bytes, cap) {
    var n = Math.min(bytes.length, cap || 262144);
    if (!n) return 0;
    var f = new Int32Array(256), i;
    for (i = 0; i < n; i++) f[bytes[i]]++;
    var e = 0;
    for (i = 0; i < 256; i++) if (f[i]) { var pr = f[i] / n; e -= pr * Math.log2(pr); }
    return e;
  }

  return {
    Cur: Cur, Out: Out,
    crc32: crc32,
    inflate: inflate, inflateRaw: inflateRaw, deflate: deflate,
    nativeInflate: hasNativeInflate, nativeDeflate: hasNativeDeflate,
    utf8: utf8, toUtf8: toUtf8, utf16: utf16,
    hex: hex, human: human, entropy: entropy
  };
}));
