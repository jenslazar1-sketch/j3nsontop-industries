/* J3NSONTOP INDUSTRIES - cert.js
 *
 * Who signed this APK, and with what.
 *
 * Two completely different containers hold the same answer:
 *   v1 (JAR)  - META-INF/*.RSA, a PKCS#7 SignedData with the cert inside.
 *   v2/v3     - the APK Signing Block, a flat run of u32-length-prefixed
 *               chunks with the X.509 DER buried three levels down.
 * Both end at an X.509 certificate, so both funnel into the same DER reader.
 *
 * This reads the certificate; it does not verify the signature maths. On a
 * phone that distinction matters, so the UI says "signed by", never "valid".
 * apksigner in the desktop toolkit is what actually verifies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./binary.js'));
  else root.J3Cert = factory(root.J3Bin);
}(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';

  var OIDS = {
    '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST',
    '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.5': 'SERIALNUMBER',
    '2.5.4.4': 'SN', '2.5.4.42': 'GN', '0.9.2342.19200300.100.1.25': 'DC',
    '1.2.840.113549.1.9.1': 'E'
  };

  var SIG_ALGS = {
    '1.2.840.113549.1.1.5':  'SHA1withRSA',
    '1.2.840.113549.1.1.11': 'SHA256withRSA',
    '1.2.840.113549.1.1.12': 'SHA384withRSA',
    '1.2.840.113549.1.1.13': 'SHA512withRSA',
    '1.2.840.113549.1.1.14': 'SHA224withRSA',
    '1.2.840.113549.1.1.10': 'RSASSA-PSS',
    '1.2.840.113549.1.1.4':  'MD5withRSA',
    '1.2.840.10040.4.3':     'SHA1withDSA',
    '2.16.840.1.101.3.4.3.2': 'SHA256withDSA',
    '1.2.840.10045.4.1':     'SHA1withECDSA',
    '1.2.840.10045.4.3.2':   'SHA256withECDSA',
    '1.2.840.10045.4.3.3':   'SHA384withECDSA',
    '1.2.840.10045.4.3.4':   'SHA512withECDSA'
  };

  var KEY_ALGS = {
    '1.2.840.113549.1.1.1': 'RSA',
    '1.2.840.10045.2.1':    'EC',
    '1.2.840.10040.4.1':    'DSA'
  };

  /* ------------------------------------------------------------------- DER */

  function tlv(u8, p) {
    if (p + 2 > u8.length) return null;
    var hdr = p;                                  // where tag+length began
    var tag = u8[p++], len = u8[p++];
    if (len & 0x80) {
      var n = len & 0x7f;
      if (n === 0 || n > 4 || p + n > u8.length) return null;
      len = 0;
      for (var i = 0; i < n; i++) len = (len * 256) + u8[p++];
    }
    if (p + len > u8.length) return null;
    return { tag: tag, hdr: hdr, start: p, len: len, end: p + len };
  }

  function kids(u8, node) {
    var out = [], p = node.start;
    while (p < node.end) {
      var t = tlv(u8, p);
      if (!t) break;
      out.push(t);
      p = t.end;
    }
    return out;
  }

  function oid(u8, node) {
    var p = node.start, end = node.end;
    if (p >= end) return '';
    var first = u8[p++], parts = [Math.floor(first / 40), first % 40], v = 0;
    for (; p < end; p++) {
      v = (v * 128) + (u8[p] & 0x7f);
      if (!(u8[p] & 0x80)) { parts.push(v); v = 0; }
    }
    return parts.join('.');
  }

  function text(u8, node) {
    return B.utf8(u8.subarray(node.start, node.end));
  }

  function intHex(u8, node) {
    return B.hex(u8.subarray(node.start, node.end), ':');
  }

  /* UTCTime is 2-digit years with the classic 50-year pivot; GeneralizedTime
   * carries all four. Both may or may not include seconds. */
  function derTime(u8, node) {
    var s = text(u8, node).replace(/Z$/, '');
    var y, rest;
    if (node.tag === 0x17) {
      y = parseInt(s.slice(0, 2), 10);
      y += y >= 50 ? 1900 : 2000;
      rest = s.slice(2);
    } else {
      y = parseInt(s.slice(0, 4), 10);
      rest = s.slice(4);
    }
    var mo = +rest.slice(0, 2), d = +rest.slice(2, 4);
    var h = +(rest.slice(4, 6) || 0), mi = +(rest.slice(6, 8) || 0), se = +(rest.slice(8, 10) || 0);
    return new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  }

  /** RDNSequence -> "CN=Android Debug, O=Android, C=US" */
  function name(u8, node) {
    var parts = [];
    kids(u8, node).forEach(function (rdn) {
      kids(u8, rdn).forEach(function (atv) {
        var kv = kids(u8, atv);
        if (kv.length < 2) return;
        var key = OIDS[oid(u8, kv[0])] || oid(u8, kv[0]);
        parts.push(key + '=' + text(u8, kv[1]));
      });
    });
    return parts.join(', ');
  }

  /* --------------------------------------------------------------- X.509 */

  function parseCert(der) {
    if (!(der instanceof Uint8Array)) der = new Uint8Array(der);
    var root = tlv(der, 0);
    if (!root || root.tag !== 0x30) throw new Error('Not a DER certificate');

    var top = kids(der, root);
    if (top.length < 2) throw new Error('Truncated certificate');
    var tbs = top[0];
    var sigAlgNode = top[1];

    var f = kids(der, tbs), i = 0;
    var version = 1;
    if (f[0] && f[0].tag === 0xa0) {
      var vk = kids(der, f[0]);
      if (vk.length) version = der[vk[0].start] + 1;
      i = 1;
    }

    var serial   = f[i] ? intHex(der, f[i]) : '';           i++;
    var innerAlg = f[i];                                    i++;
    var issuer   = f[i] ? name(der, f[i]) : '';             i++;
    var validity = f[i];                                    i++;
    var subject  = f[i] ? name(der, f[i]) : '';             i++;
    var spki     = f[i];

    var notBefore = null, notAfter = null;
    if (validity) {
      var vv = kids(der, validity);
      if (vv[0]) notBefore = derTime(der, vv[0]);
      if (vv[1]) notAfter  = derTime(der, vv[1]);
    }

    var sigAlgOid = '';
    if (sigAlgNode) { var sa = kids(der, sigAlgNode); if (sa[0]) sigAlgOid = oid(der, sa[0]); }
    if (!sigAlgOid && innerAlg) { var ia = kids(der, innerAlg); if (ia[0]) sigAlgOid = oid(der, ia[0]); }

    var keyAlg = '?', keyBits = 0, keyCurve = null;
    if (spki) {
      var sp = kids(der, spki);
      if (sp[0]) {
        var ka = kids(der, sp[0]);
        if (ka[0]) {
          var kOid = oid(der, ka[0]);
          keyAlg = KEY_ALGS[kOid] || kOid;
          if (keyAlg === 'EC' && ka[1]) keyCurve = oid(der, ka[1]);
        }
      }
      if (sp[1] && sp[1].tag === 0x03) {
        // BIT STRING: skip the unused-bits byte, then read the RSA modulus.
        var inner = tlv(der, sp[1].start + 1);
        if (inner && inner.tag === 0x30) {
          var mk = kids(der, inner);
          if (mk[0]) {
            var mlen = mk[0].len;
            if (der[mk[0].start] === 0) mlen--;             // strip the sign byte
            keyBits = mlen * 8;
          }
        } else if (keyAlg === 'EC') {
          keyBits = (sp[1].len - 2) * 4;                    // uncompressed point
        }
      }
    }

    var now = Date.now();
    return {
      der: der,
      version: version,
      serial: serial,
      subject: subject,
      issuer: issuer,
      selfSigned: subject === issuer,
      notBefore: notBefore,
      notAfter: notAfter,
      expired: notAfter ? notAfter.getTime() < now : false,
      notYetValid: notBefore ? notBefore.getTime() > now : false,
      sigAlg: SIG_ALGS[sigAlgOid] || sigAlgOid || '?',
      keyAlg: keyAlg, keyBits: keyBits, keyCurve: keyCurve,
      cn: (/CN=([^,]+)/.exec(subject) || [, null])[1]
    };
  }

  /** SHA-256 / SHA-1 of the DER, which is what every store shows as "the key". */
  function fingerprints(der) {
    if (typeof crypto === 'undefined' || !crypto.subtle) return Promise.resolve(null);
    var buf = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength);
    return Promise.all([
      crypto.subtle.digest('SHA-256', buf),
      crypto.subtle.digest('SHA-1', buf)
    ]).then(function (r) {
      return { sha256: B.hex(new Uint8Array(r[0]), ':'), sha1: B.hex(new Uint8Array(r[1]), ':') };
    }).catch(function () { return null; });
  }

  /* ------------------------------------------------------------ PKCS#7 (v1) */

  function certsFromPkcs7(der) {
    if (!(der instanceof Uint8Array)) der = new Uint8Array(der);
    var out = [];
    var root = tlv(der, 0);
    if (!root || root.tag !== 0x30) return out;

    var ci = kids(der, root);
    var wrap = null;
    for (var i = 0; i < ci.length; i++) if (ci[i].tag === 0xa0) { wrap = ci[i]; break; }
    if (!wrap) return out;

    var sdNode = kids(der, wrap)[0];
    if (!sdNode) return out;

    // certificates is the first [0] IMPLICIT inside SignedData.
    var sd = kids(der, sdNode);
    for (i = 0; i < sd.length; i++) {
      if (sd[i].tag !== 0xa0) continue;
      kids(der, sd[i]).forEach(function (certNode) {
        if (certNode.tag !== 0x30) return;
        // parseCert wants the whole TLV, so hand it the bytes from the tag on.
        try { out.push(parseCert(der.subarray(certNode.hdr, certNode.end))); }
        catch (e) { /* skip anything that is not a certificate */ }
      });
      break;
    }
    return out;
  }

  /* ---------------------------------------------- APK Signing Block (v2/v3) */

  function lenPrefixed(u8, p, end) {
    var out = [];
    while (p + 4 <= end) {
      var n = u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] * 16777216);
      p += 4;
      if (n < 0 || p + n > end) break;
      out.push({ start: p, end: p + n });
      p += n;
    }
    return out;
  }

  /**
   * Both v2 and v3 signers open with signed-data, and signed-data opens with
   * digests then certificates, so one walk covers both. v3 adds min/max SDK
   * after the signed data, which we simply do not need to read.
   */
  function certsFromSigBlock(payload) {
    var out = [];
    if (!payload || payload.length < 8) return out;
    var signers = lenPrefixed(payload, 4, payload.length);   // outer sequence header
    signers.forEach(function (signer) {
      var parts = lenPrefixed(payload, signer.start, signer.end);
      if (!parts.length) return;
      var signed = parts[0];
      var inner = lenPrefixed(payload, signed.start, signed.end);
      if (inner.length < 2) return;
      var certsChunk = inner[1];
      lenPrefixed(payload, certsChunk.start, certsChunk.end).forEach(function (c) {
        try { out.push(parseCert(payload.subarray(c.start, c.end))); } catch (e) { }
      });
    });
    return out;
  }

  return {
    parseCert: parseCert,
    fingerprints: fingerprints,
    certsFromPkcs7: certsFromPkcs7,
    certsFromSigBlock: certsFromSigBlock
  };
}));
