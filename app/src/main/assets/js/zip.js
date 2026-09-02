/* J3NSONTOP INDUSTRIES - zip.js
 *
 * A ZIP reader and writer built for APKs specifically, which means three things
 * a generic zip library will not do for you:
 *
 *   1. It notices the APK Signing Block sitting between the last entry and the
 *      central directory, and reports which schemes are in it.
 *   2. It re-aligns on write. Since targetSdk 30 the platform mmaps
 *      resources.arsc straight out of the APK, so that entry has to be STORED
 *      and 4-byte aligned or the app will not install. Native .so want 4096.
 *      That is what zipalign does, and repacking without it produces an APK
 *      that looks fine and then fails on device.
 *   3. It keeps already-compressed entries as raw bytes, so a repack only pays
 *      to recompress what actually changed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./binary.js'));
  else root.J3Zip = factory(root.J3Bin);
}(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';

  var SIG_LOCAL = 0x04034b50,
      SIG_CD    = 0x02014b50,
      SIG_EOCD  = 0x06054b50,
      SIG_E64   = 0x06064b50,
      SIG_L64   = 0x07064b50;

  var ALIGN_EXTRA_ID = 0xd935;          // the id zipalign itself uses for padding
  var APK_SIG_MAGIC  = 'APK Sig Block 42';

  var SIG_SCHEMES = {
    0x7109871a: 'APK Signature Scheme v2',
    0xf05368c0: 'APK Signature Scheme v3',
    0x1b93ad61: 'APK Signature Scheme v3.1',
    0x42726577: 'verity padding',
    0x2146444e: 'Google Play metadata',
    0x6dff800d: 'source stamp'
  };

  /* ---------------------------------------------------------------- dates */

  function fromDos(time, date) {
    return new Date(
      1980 + ((date >> 9) & 0x7f), ((date >> 5) & 0x0f) - 1, date & 0x1f,
      (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2
    );
  }
  function toDos(d) {
    var y = d.getFullYear();
    if (y < 1980) return { time: 0, date: 33 };  // 1980-01-01
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  /* --------------------------------------------------------------- reading */

  function findEocd(u8) {
    var max = Math.min(u8.length, 65557), start = u8.length - max;
    for (var i = u8.length - 22; i >= start; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) return i;
    }
    return -1;
  }

  /** Parses the ZIP64 extra field, but only for the fields that overflowed. */
  function zip64Extra(extra, want) {
    var c = new B.Cur(extra), got = {};
    while (c.left >= 4) {
      var id = c.u16(), size = c.u16();
      if (c.left < size) break;
      if (id === 0x0001) {
        var end = c.p + size;
        if (want.usize  && c.p + 8 <= end) got.usize  = c.u64();
        if (want.csize  && c.p + 8 <= end) got.csize  = c.u64();
        if (want.offset && c.p + 8 <= end) got.offset = c.u64();
        return got;
      }
      c.skip(size);
    }
    return got;
  }

  function open(u8) {
    if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
    var eocdAt = findEocd(u8);
    if (eocdAt < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record)');

    var c = new B.Cur(u8, eocdAt + 8);
    var entriesOnDisk = c.u16(), total = c.u16(), cdSize = c.u32(), cdOffset = c.u32();
    var commentLen = c.u16();
    var comment = commentLen ? B.utf8(u8.subarray(c.p, c.p + commentLen)) : '';

    // ZIP64 - rare in APKs but a 4 GB+ split bundle will hit it.
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      var locAt = eocdAt - 20;
      if (locAt >= 0 && new B.Cur(u8, locAt).u32() === SIG_L64) {
        var loc = new B.Cur(u8, locAt + 8);
        var e64 = loc.u64();
        if (e64 >= 0 && e64 + 56 <= u8.length && new B.Cur(u8, e64).u32() === SIG_E64) {
          var z = new B.Cur(u8, e64 + 32);
          total = z.u64(); z.skip(0);
          z.seek(e64 + 40); cdSize = z.u64(); cdOffset = z.u64();
        }
      }
    }

    var entries = [], byName = {};
    var p = cdOffset;
    for (var i = 0; i < total; i++) {
      if (p + 46 > u8.length) break;
      var cd = new B.Cur(u8, p);
      if (cd.u32() !== SIG_CD) break;
      var versionMade = cd.u16(), versionNeed = cd.u16(), flags = cd.u16(), method = cd.u16();
      var dtime = cd.u16(), ddate = cd.u16();
      var crc = cd.u32(), csize = cd.u32(), usize = cd.u32();
      var nameLen = cd.u16(), extraLen = cd.u16(), cmtLen = cd.u16();
      cd.skip(2 + 2); var extAttr = cd.u32(), local = cd.u32();
      var nameBytes = cd.bytes(nameLen);
      var extra = cd.bytes(extraLen);
      var cmt = cmtLen ? B.utf8(cd.bytes(cmtLen)) : '';

      if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) {
        var big = zip64Extra(extra, {
          usize: usize === 0xffffffff, csize: csize === 0xffffffff, offset: local === 0xffffffff
        });
        if (big.usize  !== undefined) usize = big.usize;
        if (big.csize  !== undefined) csize = big.csize;
        if (big.offset !== undefined) local = big.offset;
      }

      // Names are UTF-8 when bit 11 is set; CP437 otherwise. Everything that
      // produces APKs writes UTF-8, so decode as UTF-8 either way.
      var name = B.utf8(nameBytes);

      var e = {
        name: name, method: method, flags: flags, crc: crc >>> 0,
        csize: csize, usize: usize, localOffset: local,
        extra: extra, comment: cmt, versionMade: versionMade, versionNeed: versionNeed,
        date: fromDos(dtime, ddate), dosTime: dtime, dosDate: ddate, extAttr: extAttr,
        isDir: name.charAt(name.length - 1) === '/' || ((extAttr & 0x10) !== 0 && usize === 0),
        encrypted: (flags & 1) !== 0,
        dataOffset: -1
      };
      entries.push(e);
      byName[name] = e;
      p = cd.p;
    }

    /* The local header can carry a different (usually longer, because aligned)
     * extra field than the central one, so the data offset has to come from
     * the local header - guessing from the central copy lands mid-file. */
    function locate(e) {
      if (e.dataOffset >= 0) return e.dataOffset;
      var l = new B.Cur(u8, e.localOffset);
      if (l.u32() !== SIG_LOCAL) throw new Error('Bad local header for ' + e.name);
      l.seek(e.localOffset + 26);
      var nl = l.u16(), xl = l.u16();
      e.dataOffset = e.localOffset + 30 + nl + xl;
      return e.dataOffset;
    }

    function raw(e) {
      var at = locate(e);
      if (at + e.csize > u8.length) throw new Error('Truncated entry ' + e.name);
      return u8.subarray(at, at + e.csize);
    }

    function read(e) {
      if (typeof e === 'string') e = byName[e];
      if (!e) return Promise.reject(new Error('No such entry'));
      if (e.encrypted) return Promise.reject(new Error('Entry is encrypted: ' + e.name));
      if (e.isDir) return Promise.resolve(new Uint8Array(0));
      var bytes;
      try { bytes = raw(e); } catch (err) { return Promise.reject(err); }
      if (e.method === 0) return Promise.resolve(bytes.slice());
      if (e.method !== 8) return Promise.reject(new Error('Unsupported compression method ' + e.method + ' in ' + e.name));
      return B.inflate(bytes, e.usize);
    }

    function readText(e) { return read(e).then(B.utf8); }

    /* --- APK Signing Block: sits between the last entry and the central dir --- */
    var signing = { present: false, size: 0, blocks: [], schemes: [] };
    (function () {
      if (cdOffset < 32) return;
      var magic = B.utf8(u8.subarray(cdOffset - 16, cdOffset));
      if (magic !== APK_SIG_MAGIC) return;
      var sizeAtEnd = new B.Cur(u8, cdOffset - 24).u64();
      var blockStart = cdOffset - sizeAtEnd - 8;
      if (blockStart < 0 || blockStart >= cdOffset) return;
      var sizeAtStart = new B.Cur(u8, blockStart).u64();
      if (sizeAtStart !== sizeAtEnd) return;

      signing.present = true;
      signing.size = sizeAtEnd + 8;
      signing.start = blockStart;
      signing.end = cdOffset;

      var q = new B.Cur(u8, blockStart + 8);
      var limit = cdOffset - 24;
      while (q.p + 12 <= limit) {
        var pairLen = q.u64();
        if (pairLen < 4 || q.p + pairLen > limit + 12) break;
        var id = q.u32();
        var payload = u8.subarray(q.p, q.p + pairLen - 4);
        signing.blocks.push({ id: id >>> 0, name: SIG_SCHEMES[id >>> 0] || null, size: payload.length, data: payload });
        if (SIG_SCHEMES[id >>> 0] && (id >>> 0) !== 0x42726577) signing.schemes.push(SIG_SCHEMES[id >>> 0]);
        q.seek(q.p + pairLen - 4);
      }
    }());

    return {
      bytes: u8, entries: entries, byName: byName, comment: comment,
      cdOffset: cdOffset, cdSize: cdSize, eocdAt: eocdAt,
      signing: signing,
      get: function (n) { return byName[n] || null; },
      has: function (n) { return !!byName[n]; },
      read: read, readText: readText, raw: raw, locate: locate
    };
  }

  /* --------------------------------------------------------------- writing */

  /* Anything already compressed pays nothing and grows a bit if you deflate it
   * again, and a few types MUST stay stored for the platform to mmap them. */
  var STORE_EXT = /\.(png|jpg|jpeg|gif|webp|mp3|mp4|m4a|ogg|wav|webm|zip|apk|jar|aar|so|arsc|opus|avif|heic|bz2|gz|xz|7z|rar)$/i;

  function shouldStore(name, size) {
    if (name === 'resources.arsc') return true;      // must be stored since API 30
    if (/\.so$/i.test(name)) return true;
    if (size < 64) return true;                       // deflate overhead beats the gain
    return STORE_EXT.test(name);
  }

  function alignFor(name, stored) {
    if (!stored) return 1;                            // only stored data gets mmapped
    if (/\.so$/i.test(name)) return 4096;
    return 4;
  }

  /**
   * items: [{ name, data:Uint8Array }]                        - recompressed as needed
   *        [{ name, rawData, method, crc, usize, csize }]      - copied through untouched
   * opts:  { align:true, comment:'', onProgress(done,total) }
   */
  function build(items, opts) {
    opts = opts || {};
    var align = opts.align !== false;

    // Compress (or pass through) everything first; the offsets depend on the
    // final sizes, so nothing can be laid out until this settles.
    var prepared = [];
    var idx = 0;

    function next() {
      if (idx >= items.length) return Promise.resolve();
      var it = items[idx++];
      if (opts.onProgress) opts.onProgress(idx, items.length);

      if (it.rawData) {
        prepared.push({
          name: it.name, method: it.method, crc: it.crc >>> 0,
          usize: it.usize, csize: it.rawData.length, payload: it.rawData,
          date: it.date || new Date(), extAttr: it.extAttr || 0, isDir: !!it.isDir
        });
        return next();
      }

      var data = it.data || new Uint8Array(0);
      var isDir = it.isDir || (it.name.charAt(it.name.length - 1) === '/');
      var crc = B.crc32(data);

      if (isDir || data.length === 0 || (it.store !== undefined ? it.store : shouldStore(it.name, data.length))) {
        prepared.push({
          name: it.name, method: 0, crc: crc, usize: data.length, csize: data.length,
          payload: data, date: it.date || new Date(), extAttr: it.extAttr || 0, isDir: isDir
        });
        return next();
      }

      return B.deflate(data).then(function (packed) {
        var useDeflate = packed && packed.length < data.length;
        prepared.push({
          name: it.name,
          method: useDeflate ? 8 : 0,
          crc: crc, usize: data.length,
          csize: useDeflate ? packed.length : data.length,
          payload: useDeflate ? packed : data,
          date: it.date || new Date(), extAttr: it.extAttr || 0, isDir: isDir
        });
        return next();
      });
    }

    return next().then(function () {
      var out = new B.Out(1024 * 64);
      var i, e;

      for (i = 0; i < prepared.length; i++) {
        e = prepared[i];
        var nameBytes = B.toUtf8(e.name);
        var stored = e.method === 0 && !e.isDir && e.usize > 0;
        var want = align ? alignFor(e.name, stored) : 1;

        var extraLen = 0;
        if (want > 1) {
          var dataAt = out.n + 30 + nameBytes.length;
          var pad = (want - (dataAt % want)) % want;
          // The padding lives in a real extra field, so it needs its own 4-byte
          // header. Anything under 4 has to borrow a whole extra alignment unit.
          if (pad > 0 && pad < 4) pad += want * Math.ceil((4 - pad) / want);
          extraLen = pad;
        }

        e.localOffset = out.n;
        out.u32(SIG_LOCAL);
        out.u16(e.method === 8 ? 20 : 10);            // version needed
        out.u16(0x0800);                              // UTF-8 names
        out.u16(e.method);
        var d = toDos(e.date);
        out.u16(d.time); out.u16(d.date);
        e.dosTime = d.time; e.dosDate = d.date;
        out.u32(e.crc); out.u32(e.csize); out.u32(e.usize);
        out.u16(nameBytes.length); out.u16(extraLen);
        out.raw(nameBytes);
        if (extraLen) {
          out.u16(ALIGN_EXTRA_ID);
          out.u16(extraLen - 4);
          out.zeros(extraLen - 4);
        }
        out.raw(e.payload);
      }

      var cdStart = out.n;
      for (i = 0; i < prepared.length; i++) {
        e = prepared[i];
        var nb = B.toUtf8(e.name);
        out.u32(SIG_CD);
        out.u16(0x0314);                              // made by 3.20 (unix)
        out.u16(e.method === 8 ? 20 : 10);
        out.u16(0x0800);
        out.u16(e.method);
        out.u16(e.dosTime); out.u16(e.dosDate);
        out.u32(e.crc); out.u32(e.csize); out.u32(e.usize);
        out.u16(nb.length); out.u16(0); out.u16(0);
        out.u16(0); out.u16(0);
        out.u32(e.isDir ? 0x41ed0010 : 0x81a40000);   // 0755 dir / 0644 file
        out.u32(e.localOffset);
        out.raw(nb);
      }
      var cdBytes = out.n - cdStart;

      var cmt = B.toUtf8(opts.comment || '');
      out.u32(SIG_EOCD);
      out.u16(0); out.u16(0);
      out.u16(prepared.length); out.u16(prepared.length);
      out.u32(cdBytes); out.u32(cdStart);
      out.u16(cmt.length);
      if (cmt.length) out.raw(cmt);

      return out.done();
    });
  }

  return {
    open: open, build: build,
    shouldStore: shouldStore, alignFor: alignFor,
    SIG_SCHEMES: SIG_SCHEMES
  };
}));
