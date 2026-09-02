/* J3NSONTOP INDUSTRIES - cryptoShim.js
 *
 * React Native has no WebCrypto. cert.js needs exactly one thing from it —
 * crypto.subtle.digest('SHA-256'|'SHA-1', buf) — to turn a certificate's DER
 * into the fingerprint every app store shows as "the signing key".
 *
 * cert.js already degrades politely when WebCrypto is missing (it returns null
 * and the app shows no fingerprint), so the app works without this file. But a
 * signer with no fingerprint is a signer you cannot actually check against a
 * known-good value, which is most of the point of the integrity screen — so we
 * supply the two digests in plain JS instead.
 *
 * Deliberately a global shim rather than an edit to cert.js: cert.js is shared
 * verbatim with the Android app, the iOS app and the CLI, and it stays that way.
 * One engine, four hosts, no forks.
 *
 * FIPS 180-4. Both digests are byte-for-byte the standard; verified against
 * known-answer test vectors (see selftest.js).
 */
'use strict';

function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

var K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/* Appends the 0x80 marker and the 64-bit big-endian bit length, which is the
 * only fiddly part both algorithms share. */
function pad(bytes) {
  var l = bytes.length;
  var total = (l + 9 + 63) & ~63;
  var m = new Uint8Array(total);
  m.set(bytes);
  m[l] = 0x80;
  var dv = new DataView(m.buffer);
  // bit length = l * 8, as a 64-bit big-endian value. The high word is
  // floor(l / 2^29); computed with division because l * 8 can exceed 2^31.
  dv.setUint32(total - 8, Math.floor(l / 536870912), false);
  dv.setUint32(total - 4, (l << 3) >>> 0, false);
  return { m: m, dv: dv, total: total };
}

function sha256(bytes) {
  var h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  var p = pad(bytes), w = new Uint32Array(64), i, off;

  for (off = 0; off < p.total; off += 64) {
    for (i = 0; i < 16; i++) w[i] = p.dv.getUint32(off + i * 4, false);
    for (i = 16; i < 64; i++) {
      var x = w[i - 15], y = w[i - 2];
      var s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      var s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (i = 0; i < 64; i++) {
      var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      var t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  var out = new Uint8Array(32), odv = new DataView(out.buffer);
  for (i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
  return out;
}

function sha1(bytes) {
  var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  var p = pad(bytes), w = new Uint32Array(80), i, off;

  for (off = 0; off < p.total; off += 64) {
    for (i = 0; i < 16; i++) w[i] = p.dv.getUint32(off + i * 4, false);
    for (i = 16; i < 80; i++) {
      var v = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]) >>> 0;
      w[i] = ((v << 1) | (v >>> 31)) >>> 0;
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4;
    for (i = 0; i < 80; i++) {
      var f, k;
      if (i < 20) { f = ((b & c) | (~b & d)) >>> 0; k = 0x5a827999; }
      else if (i < 40) { f = (b ^ c ^ d) >>> 0; k = 0x6ed9eba1; }
      else if (i < 60) { f = ((b & c) | (b & d) | (c & d)) >>> 0; k = 0x8f1bbcdc; }
      else { f = (b ^ c ^ d) >>> 0; k = 0xca62c1d6; }
      var t = ((((a << 5) | (a >>> 27)) >>> 0) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  var out = new Uint8Array(20), odv = new DataView(out.buffer);
  odv.setUint32(0, h0, false); odv.setUint32(4, h1, false);
  odv.setUint32(8, h2, false); odv.setUint32(12, h3, false);
  odv.setUint32(16, h4, false);
  return out;
}

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

function digest(algorithm, data) {
  var name = (typeof algorithm === 'string' ? algorithm : (algorithm && algorithm.name) || '')
    .toUpperCase().replace('-', '');
  var bytes = asBytes(data);
  if (name === 'SHA256') return Promise.resolve(sha256(bytes).buffer);
  if (name === 'SHA1') return Promise.resolve(sha1(bytes).buffer);
  return Promise.reject(new Error('cryptoShim: unsupported algorithm ' + name));
}

/* Install as global.crypto.subtle.digest, because cert.js reads the bare global
 * `crypto`. Everything is defensive: some RN/Expo setups predefine a partial
 * `crypto` object, and on some engines it is a non-writable accessor, so we fall
 * back to defineProperty and then give up quietly rather than crash the app at
 * import time. Nothing here overwrites a real WebCrypto implementation. */
(function install(g) {
  if (!g) return;
  try {
    if (!g.crypto) {
      try { g.crypto = {}; }
      catch (e) { Object.defineProperty(g, 'crypto', { value: {}, configurable: true, writable: true }); }
    }
    var c = g.crypto;
    if (!c) return;
    if (!c.subtle) {
      try { c.subtle = {}; }
      catch (e) { Object.defineProperty(c, 'subtle', { value: {}, configurable: true, writable: true }); }
    }
    if (c.subtle && typeof c.subtle.digest !== 'function') {
      try { c.subtle.digest = digest; }
      catch (e) { Object.defineProperty(c.subtle, 'digest', { value: digest, configurable: true, writable: true }); }
    }
  } catch (e) {
    // No WebCrypto and no way to install it: cert.js returns null fingerprints
    // and every other engine is unaffected.
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this));

module.exports = { sha256: sha256, sha1: sha1, digest: digest };
