/* J3NSONTOP INDUSTRIES - dex.js
 *
 * Dalvik executable reader: header, string/type/proto/field/method tables and
 * the class list, plus the string-constant sweep that is usually the fastest
 * way to find out what an APK actually talks to.
 *
 * Deliberately not a bytecode disassembler. Turning 220-odd opcodes back into
 * Java is jadx's job and it needs a desktop to do it well; what a phone can do
 * usefully is structure and constants, and that is what this gives you.
 *
 * Everything past the header is lazy. A real app ships 100k+ strings and 20k
 * classes across several dex files, and decoding all of that up front to draw
 * one summary card would stall the UI for seconds.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./binary.js'));
  else root.J3Dex = factory(root.J3Bin);
}(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';

  var ACC = [
    [0x0001, 'public'], [0x0002, 'private'], [0x0004, 'protected'], [0x0008, 'static'],
    [0x0010, 'final'], [0x0020, 'synchronized'], [0x0040, 'volatile'], [0x0080, 'transient'],
    [0x0100, 'native'], [0x0200, 'interface'], [0x0400, 'abstract'], [0x0800, 'strictfp'],
    [0x1000, 'synthetic'], [0x2000, 'annotation'], [0x4000, 'enum']
  ];

  var PRIMS = {
    V: 'void', Z: 'boolean', B: 'byte', S: 'short', C: 'char',
    I: 'int', J: 'long', F: 'float', D: 'double'
  };

  function flagsToText(f, isField) {
    var out = [];
    for (var i = 0; i < ACC.length; i++) {
      if (!(f & ACC[i][0])) continue;
      if (isField && (ACC[i][0] === 0x0020 || ACC[i][0] === 0x0100)) continue; // volatile/transient share bits
      out.push(ACC[i][1]);
    }
    return out.join(' ');
  }

  /** Ljava/lang/String; -> java.lang.String ; [I -> int[] */
  function typeName(desc) {
    if (!desc) return '?';
    var dims = 0, i = 0;
    while (desc.charAt(i) === '[') { dims++; i++; }
    var base = desc.charAt(i);
    var name;
    if (base === 'L') name = desc.slice(i + 1, desc.length - 1).replace(/\//g, '.');
    else name = PRIMS[base] || desc.slice(i);
    while (dims--) name += '[]';
    return name;
  }

  function uleb(u8, p) {
    var result = u8[p++], cur;
    if (result > 0x7f) {
      cur = u8[p++];
      result = (result & 0x7f) | ((cur & 0x7f) << 7);
      if (cur > 0x7f) {
        cur = u8[p++];
        result |= (cur & 0x7f) << 14;
        if (cur > 0x7f) {
          cur = u8[p++];
          result |= (cur & 0x7f) << 21;
          if (cur > 0x7f) { cur = u8[p++]; result += (cur & 0x7f) * 268435456; }
        }
      }
    }
    return [result >>> 0, p];
  }

  /* DEX strings are MUTF-8: NUL comes across as C0 80 and astral characters as
   * a pair of 3-byte surrogates, both of which a standard UTF-8 decoder gets
   * wrong. Decoding by hand is the only way to read them faithfully. */
  function mutf8(u8, p, units) {
    var s = '', n = 0;
    while (n < units) {
      var a = u8[p++];
      if (a === 0) break;
      if (a < 0x80) { s += String.fromCharCode(a); n++; }
      else if ((a & 0xe0) === 0xc0) { s += String.fromCharCode(((a & 0x1f) << 6) | (u8[p++] & 0x3f)); n++; }
      else if ((a & 0xf0) === 0xe0) {
        s += String.fromCharCode(((a & 0x0f) << 12) | ((u8[p++] & 0x3f) << 6) | (u8[p++] & 0x3f));
        n++;
      } else { s += '�'; n++; }
    }
    return s;
  }

  function parse(u8) {
    if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
    if (u8.length < 112) throw new Error('Too small to be a dex file');

    var magic = B.utf8(u8.subarray(0, 8));
    if (magic.slice(0, 4) !== 'dex\n') throw new Error('Not a dex file (bad magic)');
    var version = magic.slice(4, 7);

    var c = new B.Cur(u8, 8);
    var checksum = c.u32();
    var signature = B.hex(c.bytes(20));
    var fileSize = c.u32(), headerSize = c.u32(), endianTag = c.u32();
    var linkSize = c.u32(), linkOff = c.u32(), mapOff = c.u32();
    var stringIdsSize = c.u32(), stringIdsOff = c.u32();
    var typeIdsSize = c.u32(), typeIdsOff = c.u32();
    var protoIdsSize = c.u32(), protoIdsOff = c.u32();
    var fieldIdsSize = c.u32(), fieldIdsOff = c.u32();
    var methodIdsSize = c.u32(), methodIdsOff = c.u32();
    var classDefsSize = c.u32(), classDefsOff = c.u32();
    var dataSize = c.u32(), dataOff = c.u32();

    if (endianTag !== 0x12345678) throw new Error('Unsupported dex endianness');

    var strCache = {};
    function string(i) {
      if (i === undefined || i < 0 || i >= stringIdsSize) return '';
      if (strCache[i] !== undefined) return strCache[i];
      var off = c.at32(stringIdsOff + i * 4);
      var r = uleb(u8, off);
      var s = mutf8(u8, r[1], r[0]);
      strCache[i] = s;
      return s;
    }
    function typeDesc(i) {
      if (i === undefined || i < 0 || i >= typeIdsSize) return '?';
      return string(c.at32(typeIdsOff + i * 4));
    }
    function type(i) { return typeName(typeDesc(i)); }

    function proto(i) {
      if (i < 0 || i >= protoIdsSize) return { ret: '?', args: [] };
      var at = protoIdsOff + i * 12;
      var ret = type(c.at32(at + 4));
      var paramsOff = c.at32(at + 8);
      var args = [];
      if (paramsOff) {
        var n = c.at32(paramsOff);
        for (var k = 0; k < n; k++) args.push(type(c.at16(paramsOff + 4 + k * 2)));
      }
      return { ret: ret, args: args };
    }

    function method(i) {
      if (i < 0 || i >= methodIdsSize) return null;
      var at = methodIdsOff + i * 8;
      var cls = type(c.at16(at));
      var pr = proto(c.at16(at + 2));
      var nm = string(c.at32(at + 4));
      return { cls: cls, name: nm, ret: pr.ret, args: pr.args,
               sig: pr.ret + ' ' + nm + '(' + pr.args.join(', ') + ')' };
    }
    function field(i) {
      if (i < 0 || i >= fieldIdsSize) return null;
      var at = fieldIdsOff + i * 8;
      return { cls: type(c.at16(at)), type: type(c.at16(at + 2)), name: string(c.at32(at + 4)) };
    }

    /* class_defs are a fixed 32 bytes each, so the index is cheap. The members
     * live in a variable-length class_data_item and are only decoded when
     * somebody actually opens that class. */
    var classes = [];
    for (var i = 0; i < classDefsSize; i++) {
      var at = classDefsOff + i * 32;
      classes.push({
        _at: at,
        typeIdx: c.at32(at),
        access: c.at32(at + 4),
        superIdx: c.at32(at + 8),
        interfacesOff: c.at32(at + 12),
        sourceIdx: c.at32(at + 16),
        dataOff: c.at32(at + 24)
      });
    }

    function className(k) { return type(classes[k].typeIdx); }

    function classInfo(k) {
      var cd = classes[k];
      if (cd._info) return cd._info;

      var info = {
        name: type(cd.typeIdx),
        descriptor: typeDesc(cd.typeIdx),
        superName: cd.superIdx === 0xffffffff ? null : type(cd.superIdx),
        access: cd.access,
        modifiers: flagsToText(cd.access),
        isInterface: !!(cd.access & 0x0200),
        isEnum: !!(cd.access & 0x4000),
        isAnnotation: !!(cd.access & 0x2000),
        source: cd.sourceIdx === 0xffffffff ? null : string(cd.sourceIdx),
        interfaces: [],
        fields: [], methods: [],
        methodCount: 0, fieldCount: 0
      };

      if (cd.interfacesOff) {
        var n = c.at32(cd.interfacesOff);
        for (var q = 0; q < n; q++) info.interfaces.push(type(c.at16(cd.interfacesOff + 4 + q * 2)));
      }

      if (cd.dataOff) {
        var p = cd.dataOff, r;
        r = uleb(u8, p); var sf = r[0]; p = r[1];
        r = uleb(u8, p); var iff = r[0]; p = r[1];
        r = uleb(u8, p); var dm = r[0]; p = r[1];
        r = uleb(u8, p); var vm = r[0]; p = r[1];

        var idx, j;
        idx = 0;
        for (j = 0; j < sf + iff; j++) {
          if (j === sf) idx = 0;
          r = uleb(u8, p); idx += r[0]; p = r[1];
          r = uleb(u8, p); var fAcc = r[0]; p = r[1];
          var fd = field(idx);
          if (fd) info.fields.push({
            name: fd.name, type: fd.type, access: fAcc,
            modifiers: flagsToText(fAcc, true), isStatic: j < sf
          });
        }

        idx = 0;
        for (j = 0; j < dm + vm; j++) {
          if (j === dm) idx = 0;
          r = uleb(u8, p); idx += r[0]; p = r[1];
          r = uleb(u8, p); var mAcc = r[0]; p = r[1];
          r = uleb(u8, p); var codeOff = r[0]; p = r[1];
          var md = method(idx);
          if (md) info.methods.push({
            name: md.name, ret: md.ret, args: md.args, sig: md.sig, access: mAcc,
            modifiers: flagsToText(mAcc), direct: j < dm,
            hasCode: codeOff !== 0,
            codeOff: codeOff,                             // smali.js disassembles from here
            insns: codeOff ? c.at32(codeOff + 12) : 0     // code_item.insns_size
          });
        }
        info.fieldCount = info.fields.length;
        info.methodCount = info.methods.length;
      }

      cd._info = info;
      return info;
    }

    /* The sweep that earns its keep: every string constant in the file, tagged
     * by what it looks like. URLs and hosts here are the app's real network
     * surface, no matter what the manifest claims. */
    var PATTERNS = [
      ['url',    /^(https?|ftp|ws|wss):\/\/\S+$/i],
      // "Bridge.java" and "layout.xml" look exactly like hostnames, and a debug
      // build is full of them, so rule the known file suffixes out first.
      ['host',   /^(?!.*\.(java|kt|kts|xml|json|png|jpe?g|webp|gif|so|dex|txt|properties|html?|css|js|ts|class|smali|pro|md|ttf|otf|gz|zip|apk|jar|aar|bin|dat|cfg|ini|yml|yaml|proto|pb|db|sql|log)$)(?:[a-z0-9-]+\.)+[a-z]{2,}$/i],
      ['ip',     /^\d{1,3}(\.\d{1,3}){3}$/],
      ['intent', /^android\.(intent|permission|provider|settings)\./],
      ['path',   /^(\/(data|sdcard|storage|system)\/|content:\/\/)/i],
      ['sql',    /^\s*(select|insert|update|delete|create table|drop table)\s/i],
      ['secret', /(api[_-]?key|secret|passw(or)?d|token|bearer |authorization)/i],
      ['b64',    /^[A-Za-z0-9+/]{40,}={0,2}$/]
    ];

    function scanStrings(opts) {
      opts = opts || {};
      var minLen = opts.minLen || 4;
      var cap = opts.cap || 400;
      var buckets = {}, seen = {}, total = 0;

      for (var i = 0; i < stringIdsSize; i++) {
        var s = string(i);
        if (s.length < minLen || s.length > 2048) continue;
        total++;
        for (var k = 0; k < PATTERNS.length; k++) {
          if (!PATTERNS[k][1].test(s)) continue;
          var tag = PATTERNS[k][0];
          var key = tag + ' ' + s;
          if (seen[key]) break;
          seen[key] = 1;
          (buckets[tag] || (buckets[tag] = [])).push(s);
          break;                                  // first matching bucket wins
        }
      }
      Object.keys(buckets).forEach(function (k) {
        buckets[k].sort();
        if (buckets[k].length > cap) buckets[k] = buckets[k].slice(0, cap);
      });
      return { buckets: buckets, scanned: total };
    }

    /** Which framework/library packages this dex references at all. */
    function packages(limit) {
      var counts = {};
      for (var i = 0; i < typeIdsSize; i++) {
        var d = typeDesc(i);
        if (d.charAt(0) !== 'L') continue;
        var parts = d.slice(1, -1).split('/');
        if (parts.length < 2) continue;
        var key = parts.slice(0, Math.min(3, parts.length - 1)).join('.');
        counts[key] = (counts[key] || 0) + 1;
      }
      return Object.keys(counts)
        .map(function (k) { return { name: k, count: counts[k] }; })
        .sort(function (a, b) { return b.count - a.count; })
        .slice(0, limit || 40);
    }

    return {
      bytes: u8,                                          // smali.js reads code_items directly
      version: version, checksum: checksum >>> 0, signature: signature,
      fileSize: fileSize, actualSize: u8.length,
      counts: {
        strings: stringIdsSize, types: typeIdsSize, protos: protoIdsSize,
        fields: fieldIdsSize, methods: methodIdsSize, classes: classDefsSize
      },
      classes: classes,
      className: className, classInfo: classInfo,
      string: string, type: type, method: method, field: field,
      scanStrings: scanStrings, packages: packages,
      flagsToText: flagsToText, typeName: typeName
    };
  }

  return { parse: parse, typeName: typeName, flagsToText: flagsToText };
}));
