/* J3NSONTOP INDUSTRIES - axml.js
 *
 * Android binary resources: AXML in, XML out, AXML back in again.
 *
 * The decoder is the easy half. The encoder is what makes this a recompiler
 * rather than a viewer, and it has one invariant that everything hangs off:
 *
 *   A compiled manifest carries a resource-map chunk which is a parallel array
 *   to the *first N* entries of the string pool. Attribute name string i means
 *   resource id resourceMap[i]. So the pool cannot just be "every string we
 *   saw" - every attribute name that has a resource id has to land in the low
 *   block, in the same order as the map, or the platform reads android:name
 *   as android:theme and the package refuses to parse.
 *
 * Both halves are exercised by tools/apklab/selftest.js against aapt2's own
 * output, which is the only reason to believe any of it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./binary.js'), require('./attrs.js'));
  } else {
    root.J3Axml = factory(root.J3Bin, root.J3Attrs);
  }
}(typeof self !== 'undefined' ? self : this, function (B, ATTRS) {
  'use strict';

  var RES_STRING_POOL = 0x0001,
      RES_TABLE       = 0x0002,
      RES_XML         = 0x0003,
      XML_NS_START    = 0x0100,
      XML_NS_END      = 0x0101,
      XML_EL_START    = 0x0102,
      XML_EL_END      = 0x0103,
      XML_CDATA       = 0x0104,
      XML_RES_MAP     = 0x0180,
      TABLE_PACKAGE   = 0x0200,
      TABLE_TYPE      = 0x0201,
      TABLE_TYPESPEC  = 0x0202;

  var UTF8_FLAG = 0x0100;

  var TYPE_NULL = 0x00, TYPE_REFERENCE = 0x01, TYPE_ATTRIBUTE = 0x02, TYPE_STRING = 0x03,
      TYPE_FLOAT = 0x04, TYPE_DIMENSION = 0x05, TYPE_FRACTION = 0x06,
      TYPE_DYN_REFERENCE = 0x07, TYPE_DYN_ATTRIBUTE = 0x08,
      TYPE_INT_DEC = 0x10, TYPE_INT_HEX = 0x11, TYPE_INT_BOOLEAN = 0x12,
      TYPE_ARGB8 = 0x1c, TYPE_RGB8 = 0x1d, TYPE_ARGB4 = 0x1e, TYPE_RGB4 = 0x1f;

  var DIM_UNITS  = ['px', 'dip', 'sp', 'pt', 'in', 'mm'];
  var FRAC_UNITS = ['%', '%p'];
  var RADIX_MULT = [1 / 0x00000100, 1 / 0x00008000, 1 / 0x00800000, 1 / 0x80000000];

  var ANDROID_NS = 'http://schemas.android.com/apk/res/android';

  var f32 = new DataView(new ArrayBuffer(4));

  /* ------------------------------------------------------------ string pool */

  function len8(u8, p) {
    var b = u8[p++];
    if (b & 0x80) b = ((b & 0x7f) << 8) | u8[p++];
    return [b, p];
  }
  function len16(u8, p) {
    var w = u8[p] | (u8[p + 1] << 8); p += 2;
    if (w & 0x8000) { w = ((w & 0x7fff) << 16) | (u8[p] | (u8[p + 1] << 8)); p += 2; }
    return [w, p];
  }

  function readPool(u8, start) {
    var c = new B.Cur(u8, start);
    var type = c.u16(), headerSize = c.u16(), size = c.u32();
    if (type !== RES_STRING_POOL) throw new Error('Expected a string pool at ' + start);
    var count = c.u32(), styleCount = c.u32(), flags = c.u32();
    var stringsStart = c.u32(), stylesStart = c.u32();
    var utf8 = (flags & UTF8_FLAG) !== 0;
    var offAt = start + headerSize, dataAt = start + stringsStart;
    var strings = new Array(count);

    for (var i = 0; i < count; i++) {
      var off = dataAt + c.at32(offAt + i * 4);
      if (off >= u8.length) { strings[i] = ''; continue; }
      try {
        if (utf8) {
          var a = len8(u8, off);              // length in characters
          var b2 = len8(u8, a[1]);            // length in bytes
          strings[i] = B.utf8(u8.subarray(b2[1], b2[1] + b2[0]));
        } else {
          var w = len16(u8, off);
          strings[i] = B.utf16(u8, w[1], w[0]);
        }
      } catch (e) { strings[i] = ''; }
    }
    return { strings: strings, flags: flags, utf8: utf8, size: size, styleCount: styleCount };
  }

  /** Writes a UTF-8 string pool chunk. Order in `list` is the index order. */
  function writePool(list) {
    var out = new B.Out(1024);
    var encoded = list.map(B.toUtf8);
    var charLens = list.map(function (s) {
      // The first length is in UTF-16 code units, not code points: surrogate
      // pairs count as 2. Getting this wrong makes aapt2 read past the string.
      return s.length;
    });

    var dataOut = new B.Out(1024), offsets = [];
    for (var i = 0; i < list.length; i++) {
      offsets.push(dataOut.n);
      putLen8(dataOut, charLens[i]);
      putLen8(dataOut, encoded[i].length);
      dataOut.raw(encoded[i]);
      dataOut.byte(0);
    }
    var data = dataOut.done();
    var pad = (4 - (data.length % 4)) % 4;

    var headerSize = 28;
    var stringsStart = headerSize + list.length * 4;
    var total = stringsStart + data.length + pad;

    out.u16(RES_STRING_POOL); out.u16(headerSize); out.u32(total);
    out.u32(list.length); out.u32(0); out.u32(UTF8_FLAG);
    out.u32(stringsStart); out.u32(0);
    for (i = 0; i < offsets.length; i++) out.u32(offsets[i]);
    out.raw(data);
    out.zeros(pad);
    return out.done();
  }

  function putLen8(out, n) {
    if (n > 0x7f) out.byte(0x80 | ((n >> 8) & 0x7f));
    out.byte(n & 0xff);
  }

  /* ------------------------------------------------------------- res values */

  function complexToFloat(data) {
    var mant = (data & 0xffffff00) | 0;                 // keep the sign
    return mant * RADIX_MULT[(data >> 4) & 3];
  }
  function trimNum(n) {
    var s = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }
  function hex8(n) { return '0x' + ('00000000' + (n >>> 0).toString(16)).slice(-8); }

  /**
   * @param resolve optional (id) -> "@string/name", from a parsed resources.arsc
   */
  function fmtValue(type, data, strings, resolve) {
    switch (type) {
      case TYPE_NULL:        return data === 1 ? '@empty' : '@null';
      case TYPE_REFERENCE:
      case TYPE_DYN_REFERENCE: {
        if (data === 0) return '@null';
        var named = resolve && resolve(data >>> 0);
        if (named) return named;
        if (((data >>> 24) & 0xff) === 0x01) {
          var an = ATTRS && ATTRS.name(data >>> 0);
          if (an) return '@android:attr/' + an;
          return '@android:' + hex8(data);
        }
        return '@' + hex8(data);
      }
      case TYPE_ATTRIBUTE:
      case TYPE_DYN_ATTRIBUTE: {
        var n2 = ATTRS && ATTRS.name(data >>> 0);
        return n2 ? '?android:attr/' + n2 : '?' + hex8(data);
      }
      case TYPE_STRING:      return strings[data] !== undefined ? strings[data] : '';
      case TYPE_FLOAT:       f32.setUint32(0, data >>> 0, true); return trimNum(f32.getFloat32(0, true));
      case TYPE_DIMENSION:   return trimNum(complexToFloat(data)) + (DIM_UNITS[data & 0x0f] || '');
      case TYPE_FRACTION:    return trimNum(complexToFloat(data) * 100) + (FRAC_UNITS[data & 0x0f] || '');
      case TYPE_INT_DEC:     return String(data | 0);
      case TYPE_INT_HEX:     return hex8(data);
      case TYPE_INT_BOOLEAN: return data === 0 ? 'false' : 'true';
      case TYPE_ARGB8:       return '#' + ('00000000' + (data >>> 0).toString(16)).slice(-8);
      case TYPE_RGB8:        return '#' + ('000000' + ((data >>> 0) & 0xffffff).toString(16)).slice(-6);
      case TYPE_ARGB4:       return '#' + ('0000' + ((data >>> 0) & 0xffff).toString(16)).slice(-4);
      case TYPE_RGB4:        return '#' + ('000' + ((data >>> 0) & 0xfff).toString(16)).slice(-3);
      default:               return hex8(data);
    }
  }

  /* ----------------------------------------------------------- XML decoding */

  function parseXml(u8) {
    if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
    var c = new B.Cur(u8, 0);
    var type = c.u16(), headerSize = c.u16(), fileSize = c.u32();
    if (type !== RES_XML) throw new Error('Not an Android binary XML file (type 0x' + type.toString(16) + ')');

    var pool = null, resMap = [];
    var root = null, stack = [], nsDecls = [], nsOpen = [];
    var p = headerSize;
    var limit = Math.min(fileSize || u8.length, u8.length);

    while (p + 8 <= limit) {
      var ct = c.at16(p), chs = c.at16(p + 2), csz = c.at32(p + 4);
      if (csz < 8 || p + csz > limit) break;
      var body = p + (chs >= 8 ? chs : 8);

      if (ct === RES_STRING_POOL) {
        pool = readPool(u8, p);
      } else if (ct === XML_RES_MAP) {
        var n = Math.floor((csz - (chs >= 8 ? chs : 8)) / 4);
        for (var i = 0; i < n; i++) resMap.push(c.at32(p + (chs >= 8 ? chs : 8) + i * 4) >>> 0);
      } else if (pool) {
        var q = new B.Cur(u8, body);
        var line = c.at32(p + 8);

        if (ct === XML_NS_START) {
          var prefix = q.i32(), uri = q.i32();
          var d = { prefix: str(pool, prefix), uri: str(pool, uri) };
          nsOpen.push(d);
          nsDecls.push(d);
        } else if (ct === XML_NS_END) {
          nsOpen.pop();
        } else if (ct === XML_EL_START) {
          var ens = q.i32(), ename = q.i32();
          var attrStart = q.u16(), attrSize = q.u16(), attrCount = q.u16();
          var idIndex = q.u16(), classIndex = q.u16(), styleIndex = q.u16();

          var el = {
            name: str(pool, ename),
            nsUri: ens >= 0 ? str(pool, ens) : null,
            line: line, attrs: [], children: [], parent: null
          };

          var ap = body + attrStart;
          for (var a = 0; a < attrCount; a++, ap += (attrSize || 20)) {
            if (ap + 20 > limit) break;
            var av = new B.Cur(u8, ap);
            var ans = av.i32(), anameIdx = av.i32(), araw = av.i32();
            av.skip(2); av.skip(1);                       // size, res0
            var vtype = av.u8v(), vdata = av.u32();

            var resId = anameIdx >= 0 && anameIdx < resMap.length ? resMap[anameIdx] : 0;
            var aname = str(pool, anameIdx);
            // Hardened builds blank the name strings and leave only the ids.
            if (!aname && resId && ATTRS) aname = ATTRS.name(resId) || '';
            if (!aname) aname = resId ? 'attr_' + hex8(resId) : 'attr' + a;

            el.attrs.push({
              name: aname, nsUri: ans >= 0 ? str(pool, ans) : null, resId: resId >>> 0,
              type: vtype, data: vdata >>> 0,
              raw: araw >= 0 ? str(pool, araw) : null
            });
          }
          el.idIndex = idIndex; el.classIndex = classIndex; el.styleIndex = styleIndex;

          if (stack.length) { el.parent = stack[stack.length - 1]; el.parent.children.push(el); }
          else if (!root) root = el;
          stack.push(el);
        } else if (ct === XML_EL_END) {
          stack.pop();
        } else if (ct === XML_CDATA) {
          var txt = str(pool, q.i32());
          if (stack.length && txt) stack[stack.length - 1].children.push({ text: txt });
        }
      }
      p += csz;
    }

    if (!root) throw new Error('Binary XML had no root element');
    return { root: root, pool: pool, strings: pool ? pool.strings : [], resourceMap: resMap, nsDecls: nsDecls };
  }

  function str(pool, i) {
    if (i === undefined || i === null || i < 0) return '';
    var s = pool.strings[i];
    return s === undefined ? '' : s;
  }

  /* ---------------------------------------------------------- XML rendering */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function prefixFor(uri, nsDecls) {
    if (!uri) return '';
    for (var i = 0; i < nsDecls.length; i++) if (nsDecls[i].uri === uri) return nsDecls[i].prefix + ':';
    return uri === ANDROID_NS ? 'android:' : 'ns:';
  }

  function toXml(doc, opts) {
    opts = opts || {};
    var resolve = opts.resolve;
    var lines = ['<?xml version="1.0" encoding="utf-8"?>'];

    function walk(el, depth) {
      var pad = new Array(depth + 1).join('    ');
      if (el.text !== undefined) { lines.push(pad + esc(el.text)); return; }

      var open = pad + '<' + prefixFor(el.nsUri, doc.nsDecls) + el.name;
      var parts = [];

      if (depth === 0) {
        for (var d = 0; d < doc.nsDecls.length; d++) {
          parts.push('xmlns:' + doc.nsDecls[d].prefix + '="' + esc(doc.nsDecls[d].uri) + '"');
        }
      }
      for (var i = 0; i < el.attrs.length; i++) {
        var a = el.attrs[i];
        var v = a.type === TYPE_STRING && a.raw !== null
          ? a.raw
          : fmtValue(a.type, a.data, doc.strings, resolve);
        parts.push(prefixFor(a.nsUri, doc.nsDecls) + a.name + '="' + esc(v) + '"');
      }

      if (!parts.length) {
        lines.push(open + (el.children.length ? '>' : ' />'));
      } else if (parts.length === 1 && !el.children.length) {
        lines.push(open + ' ' + parts[0] + ' />');
      } else {
        lines.push(open);
        for (var k = 0; k < parts.length; k++) {
          lines.push(pad + '    ' + parts[k] + (k === parts.length - 1 && !el.children.length ? ' />' : ''));
        }
        if (el.children.length) lines.push(pad + '    >');
      }

      if (el.children.length) {
        for (var ch = 0; ch < el.children.length; ch++) walk(el.children[ch], depth + 1);
        lines.push(pad + '</' + prefixFor(el.nsUri, doc.nsDecls) + el.name + '>');
      }
    }

    walk(doc.root, 0);
    return lines.join('\n');
  }

  /* ----------------------------------------------------------- XML encoding */

  /** Collects the pool in the order the format demands, not the order we saw. */
  function buildPool(doc) {
    var withRes = [], seenRes = {};
    var plain = [], seenPlain = {};

    function addPlain(s) {
      if (s === null || s === undefined || s === '') return;
      if (seenPlain[s] === undefined && seenRes[s] === undefined) {
        seenPlain[s] = true; plain.push(s);
      }
    }
    function addAttrName(name, resId) {
      if (!resId) return false;
      if (seenRes[name] !== undefined) return true;
      seenRes[name] = resId >>> 0;
      withRes.push({ name: name, resId: resId >>> 0 });
      return true;
    }

    // Pass 1: every attribute name that carries a resource id.
    (function scanRes(el) {
      if (el.text !== undefined) return;
      for (var i = 0; i < el.attrs.length; i++) addAttrName(el.attrs[i].name, el.attrs[i].resId);
      for (var c = 0; c < el.children.length; c++) scanRes(el.children[c]);
    }(doc.root));

    withRes.sort(function (a, b) { return a.resId - b.resId; });

    // Pass 2: everything else. Anything already claimed above keeps its index.
    for (var d = 0; d < doc.nsDecls.length; d++) {
      addPlain(doc.nsDecls[d].prefix);
      addPlain(doc.nsDecls[d].uri);
    }
    (function scanPlain(el) {
      if (el.text !== undefined) { addPlain(el.text); return; }
      addPlain(el.name);
      if (el.nsUri) addPlain(el.nsUri);
      for (var i = 0; i < el.attrs.length; i++) {
        var a = el.attrs[i];
        if (!a.resId) addPlain(a.name);
        if (a.nsUri) addPlain(a.nsUri);
        if (a.type === TYPE_STRING) addPlain(a.raw !== null && a.raw !== undefined ? a.raw : '');
        else if (a.raw) addPlain(a.raw);
      }
      for (var c = 0; c < el.children.length; c++) scanPlain(el.children[c]);
    }(doc.root));

    var strings = withRes.map(function (r) { return r.name; }).concat(plain);
    var index = {};
    for (var i = 0; i < strings.length; i++) if (index[strings[i]] === undefined) index[strings[i]] = i;

    return { strings: strings, index: index, resMap: withRes.map(function (r) { return r.resId; }) };
  }

  function encode(doc) {
    var built = buildPool(doc);
    var idx = built.index;
    var S = function (s) {
      if (s === null || s === undefined || s === '') return -1;
      var i = idx[s];
      return i === undefined ? -1 : i;
    };

    var nodes = new B.Out(4096);

    function node(type, size, line) {
      nodes.u16(type); nodes.u16(16); nodes.u32(size);
      nodes.u32(line || 1); nodes.u32(0xffffffff);
    }

    for (var d = 0; d < doc.nsDecls.length; d++) {
      node(XML_NS_START, 24, 1);
      nodes.u32(S(doc.nsDecls[d].prefix) >>> 0);
      nodes.u32(S(doc.nsDecls[d].uri) >>> 0);
    }

    (function emit(el) {
      if (el.text !== undefined) {
        node(XML_CDATA, 28, 1);
        nodes.u32(S(el.text) >>> 0);
        nodes.u16(8); nodes.byte(0); nodes.byte(TYPE_STRING); nodes.u32(S(el.text) >>> 0);
        return;
      }

      var attrs = el.attrs;
      node(XML_EL_START, 16 + 20 + 20 * attrs.length, el.line || 1);
      nodes.u32(S(el.nsUri) >>> 0);
      nodes.u32(S(el.name) >>> 0);
      nodes.u16(20); nodes.u16(20); nodes.u16(attrs.length);

      // 1-based, 0 for "not present" - recomputed rather than carried over,
      // since inserting an attribute shifts every index after it.
      var idI = 0, clsI = 0, styI = 0;
      for (var i = 0; i < attrs.length; i++) {
        if (attrs[i].nsUri === ANDROID_NS && attrs[i].name === 'id') idI = i + 1;
        else if (!attrs[i].nsUri && attrs[i].name === 'class') clsI = i + 1;
        else if (!attrs[i].nsUri && attrs[i].name === 'style') styI = i + 1;
      }
      nodes.u16(idI); nodes.u16(clsI); nodes.u16(styI);

      for (i = 0; i < attrs.length; i++) {
        var a = attrs[i];
        nodes.u32(S(a.nsUri) >>> 0);
        nodes.u32(S(a.name) >>> 0);
        // rawValue is only meaningful for strings; everything else says -1 and
        // lets the typed value speak.
        nodes.u32(a.type === TYPE_STRING ? (S(a.raw !== null && a.raw !== undefined ? a.raw : '') >>> 0) : 0xffffffff);
        nodes.u16(8); nodes.byte(0); nodes.byte(a.type);
        nodes.u32(a.type === TYPE_STRING ? (S(a.raw !== null && a.raw !== undefined ? a.raw : '') >>> 0) : (a.data >>> 0));
      }

      for (var c = 0; c < el.children.length; c++) emit(el.children[c]);

      node(XML_EL_END, 24, el.line || 1);
      nodes.u32(S(el.nsUri) >>> 0);
      nodes.u32(S(el.name) >>> 0);
    }(doc.root));

    for (d = doc.nsDecls.length - 1; d >= 0; d--) {
      node(XML_NS_END, 24, 1);
      nodes.u32(S(doc.nsDecls[d].prefix) >>> 0);
      nodes.u32(S(doc.nsDecls[d].uri) >>> 0);
    }

    var poolChunk = writePool(built.strings);
    var mapSize = 8 + built.resMap.length * 4;
    var nodeBytes = nodes.done();
    var total = 8 + poolChunk.length + mapSize + nodeBytes.length;

    var out = new B.Out(total);
    out.u16(RES_XML); out.u16(8); out.u32(total);
    out.raw(poolChunk);
    out.u16(XML_RES_MAP); out.u16(8); out.u32(mapSize);
    for (var m = 0; m < built.resMap.length; m++) out.u32(built.resMap[m]);
    out.raw(nodeBytes);
    return out.done();
  }

  /* ------------------------------------------------------- tree convenience */

  function attrOf(el, name, nsUri) {
    for (var i = 0; i < el.attrs.length; i++) {
      var a = el.attrs[i];
      if (a.name === name && (nsUri === undefined || a.nsUri === nsUri)) return a;
    }
    return null;
  }
  function attrValue(doc, el, name) {
    var a = attrOf(el, name, ANDROID_NS) || attrOf(el, name, null);
    if (!a) return null;
    return a.type === TYPE_STRING && a.raw !== null ? a.raw : fmtValue(a.type, a.data, doc.strings);
  }
  function children(el, tag) {
    var out = [];
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (c.text === undefined && (!tag || c.name === tag)) out.push(c);
    }
    return out;
  }
  function find(el, tag, out) {
    out = out || [];
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (c.text !== undefined) continue;
      if (c.name === tag) out.push(c);
      find(c, tag, out);
    }
    return out;
  }

  /** Sets (or inserts, keeping resource-id order) an android: attribute. */
  function setAttr(el, name, type, data, raw) {
    var a = attrOf(el, name, ANDROID_NS);
    if (a) { a.type = type; a.data = data >>> 0; a.raw = raw === undefined ? null : raw; return a; }
    var resId = ATTRS ? ATTRS.id(name) : 0;
    a = { name: name, nsUri: ANDROID_NS, resId: resId >>> 0, type: type, data: data >>> 0,
          raw: raw === undefined ? null : raw };
    var at = el.attrs.length;
    if (resId) {
      for (var i = 0; i < el.attrs.length; i++) {
        if (el.attrs[i].resId && el.attrs[i].resId > resId) { at = i; break; }
        if (!el.attrs[i].resId) { at = i; break; }
      }
    }
    el.attrs.splice(at, 0, a);
    return a;
  }
  function setString(el, name, value) { return setAttr(el, name, TYPE_STRING, 0, value); }
  function setInt(el, name, value)    { return setAttr(el, name, TYPE_INT_DEC, value | 0); }
  function setBool(el, name, value)   { return setAttr(el, name, TYPE_INT_BOOLEAN, value ? 0xffffffff : 0); }
  function removeAttr(el, name) {
    for (var i = el.attrs.length - 1; i >= 0; i--) {
      if (el.attrs[i].name === name) { el.attrs.splice(i, 1); return true; }
    }
    return false;
  }

  /* --------------------------------------------------------- resources.arsc */

  function parseArsc(u8) {
    if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
    var c = new B.Cur(u8, 0);
    var type = c.u16(), headerSize = c.u16(), size = c.u32();
    if (type !== RES_TABLE) throw new Error('Not a resources.arsc (type 0x' + type.toString(16) + ')');
    var packageCount = c.u32();

    var globalPool = null, packages = [];
    var p = headerSize, limit = Math.min(size || u8.length, u8.length);

    while (p + 8 <= limit) {
      var ct = c.at16(p), chs = c.at16(p + 2), csz = c.at32(p + 4);
      if (csz < 8 || p + csz > limit) break;
      if (ct === RES_STRING_POOL && !globalPool) globalPool = readPool(u8, p);
      else if (ct === TABLE_PACKAGE) packages.push(readPackage(u8, p, chs, csz));
      p += csz;
    }

    var byId = {};
    packages.forEach(function (pkg) {
      Object.keys(pkg.entries).forEach(function (id) { byId[id] = pkg.entries[id]; });
    });

    /** id -> "@type/name", or the literal string when it is one. */
    function resolve(id) {
      var e = byId[id >>> 0];
      if (!e) return null;
      return '@' + e.type + '/' + e.key;
    }
    /** id -> the actual string value, following one level of indirection. */
    function stringOf(id, depth) {
      var e = byId[id >>> 0];
      if (!e || !e.value) return null;
      if (e.value.type === TYPE_STRING) {
        return globalPool ? globalPool.strings[e.value.data] : null;
      }
      if (e.value.type === TYPE_REFERENCE && (depth || 0) < 4) return stringOf(e.value.data, (depth || 0) + 1);
      return fmtValue(e.value.type, e.value.data, globalPool ? globalPool.strings : []);
    }

    return {
      packages: packages, pool: globalPool, byId: byId,
      resolve: resolve, stringOf: stringOf,
      packageName: packages.length ? packages[0].name : null,
      count: Object.keys(byId).length
    };
  }

  function readPackage(u8, start, headerSize, chunkSize) {
    var c = new B.Cur(u8, start + 8);
    var id = c.u32();
    var nameChars = [];
    for (var i = 0; i < 128; i++) {
      var ch = c.u16();
      if (ch) nameChars.push(String.fromCharCode(ch));
    }
    var typeStringsOff = c.u32(); c.u32();
    var keyStringsOff = c.u32(); c.u32();

    var typePool = typeStringsOff ? readPool(u8, start + typeStringsOff) : { strings: [] };
    var keyPool  = keyStringsOff  ? readPool(u8, start + keyStringsOff)  : { strings: [] };

    var pkg = {
      id: id, name: nameChars.join(''), types: typePool.strings, keys: keyPool.strings,
      entries: {}, configs: {}
    };

    var p = start + headerSize, limit = start + chunkSize;
    while (p + 8 <= limit) {
      var ct = c.at16(p), chs = c.at16(p + 2), csz = c.at32(p + 4);
      if (csz < 8 || p + csz > limit) break;
      if (ct === TABLE_TYPE) readType(u8, p, chs, csz, pkg, typePool);
      p += csz;
    }
    return pkg;
  }

  function readType(u8, start, headerSize, chunkSize, pkg, typePool) {
    var c = new B.Cur(u8, start + 8);
    var typeId = c.u8v(), flags = c.u8v();
    c.u16();
    var entryCount = c.u32(), entriesStart = c.u32();
    var sparse = (flags & 0x01) !== 0;

    var typeName = typePool.strings[typeId - 1] || ('type' + typeId);
    var cfgAt = c.p;
    var cfgSize = c.at32(cfgAt);
    var cfg = configName(u8, cfgAt, cfgSize);
    pkg.configs[cfg] = (pkg.configs[cfg] || 0) + 1;

    var tableAt = start + headerSize;
    var dataAt = start + entriesStart;

    for (var i = 0; i < entryCount; i++) {
      var entryOff, index = i;
      if (sparse) {
        if (tableAt + i * 4 + 4 > start + chunkSize) break;
        var v = c.at32(tableAt + i * 4);
        index = v & 0xffff;
        entryOff = (v >>> 16) * 4;
      } else {
        if (tableAt + i * 4 + 4 > start + chunkSize) break;
        entryOff = c.at32(tableAt + i * 4);
        if (entryOff === 0xffffffff) continue;
      }
      var at = dataAt + entryOff;
      if (at + 8 > u8.length) continue;

      var e = new B.Cur(u8, at);
      var esize = e.u16(), eflags = e.u16(), keyIdx = e.u32();
      var resId = ((pkg.id << 24) | (typeId << 16) | index) >>> 0;

      var rec = pkg.entries[resId];
      if (!rec) {
        rec = { id: resId, type: typeName, key: pkg.keys[keyIdx] || ('id_' + index), value: null, configs: [] };
        pkg.entries[resId] = rec;
      }
      rec.configs.push(cfg);

      if (!(eflags & 0x0001) && at + esize + 8 <= u8.length) {   // simple value
        var vv = new B.Cur(u8, at + esize);
        vv.u16(); vv.u8v();
        var vtype = vv.u8v(), vdata = vv.u32();
        // Keep the default ("") config as the canonical value.
        if (!rec.value || cfg === 'default') rec.value = { type: vtype, data: vdata >>> 0, config: cfg };
      } else if (eflags & 0x0001) {
        rec.complex = true;
      }
    }
  }

  /* A full ResTable_config decode is a lot of surface for very little payoff
   * here; the size + the locale/density bytes are what people actually read. */
  function configName(u8, at, size) {
    if (!size || size < 12) return 'default';
    var c = new B.Cur(u8, at + 4);
    var mcc = c.u16(), mnc = c.u16();
    var lang = [u8[at + 8], u8[at + 9]], region = [u8[at + 10], u8[at + 11]];
    var parts = [];
    if (mcc) parts.push('mcc' + mcc);
    if (mnc) parts.push('mnc' + mnc);
    if (lang[0]) parts.push(String.fromCharCode(lang[0], lang[1]) + (region[0] ? '-r' + String.fromCharCode(region[0], region[1]) : ''));
    if (size >= 16) {
      var density = c.at16(at + 14);
      if (density) parts.push(density === 0xfffe ? 'anydpi' : density === 0xffff ? 'nodpi' : density + 'dpi');
    }
    if (size >= 20) {
      var sdk = c.at16(at + 16);
      if (sdk) parts.push('v' + sdk);
    }
    return parts.length ? parts.join('-') : 'default';
  }

  return {
    parseXml: parseXml, toXml: toXml, encode: encode,
    parseArsc: parseArsc,
    fmtValue: fmtValue, readPool: readPool, writePool: writePool,
    attrOf: attrOf, attrValue: attrValue, children: children, find: find,
    setAttr: setAttr, setString: setString, setInt: setInt, setBool: setBool, removeAttr: removeAttr,
    ANDROID_NS: ANDROID_NS,
    T: {
      NULL: TYPE_NULL, REFERENCE: TYPE_REFERENCE, STRING: TYPE_STRING, FLOAT: TYPE_FLOAT,
      DIMENSION: TYPE_DIMENSION, FRACTION: TYPE_FRACTION,
      INT_DEC: TYPE_INT_DEC, INT_HEX: TYPE_INT_HEX, BOOLEAN: TYPE_INT_BOOLEAN
    }
  };
}));
