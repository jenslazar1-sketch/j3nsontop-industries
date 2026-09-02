/* J3NSONTOP INDUSTRIES - elf.js
 *
 * Just enough ELF to answer the questions you actually ask about a .so you
 * found inside somebody else's APK:
 *
 *   what architecture is it, what does it link against, and is it stripped?
 *
 * DT_NEEDED is the interesting one. A library quietly pulling in libcurl or
 * libssl is doing network work the manifest never mentioned, and a JNI library
 * that links nothing but libc and liblog is probably doing exactly what it says.
 *
 * Not a disassembler and not trying to be — native code analysis is a desktop
 * job. This is the label on the tin.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./binary.js'));
  else root.J3Elf = factory(root.J3Bin);
}(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';

  var MACHINE = {
    0x03: 'x86', 0x28: 'ARM (armeabi-v7a)', 0x3e: 'x86_64',
    0xb7: 'AArch64 (arm64-v8a)', 0x08: 'MIPS', 0xf3: 'RISC-V'
  };
  var TYPE = { 1: 'relocatable', 2: 'executable', 3: 'shared object', 4: 'core dump' };

  // .dynamic tags we care about
  var DT_NULL = 0, DT_NEEDED = 1, DT_STRTAB = 5, DT_SONAME = 14, DT_RPATH = 15, DT_RUNPATH = 29;

  function parse(u8) {
    if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
    if (u8.length < 64 || u8[0] !== 0x7f || u8[1] !== 0x45 || u8[2] !== 0x4c || u8[3] !== 0x46) {
      throw new Error('Not an ELF file');
    }

    var is64 = u8[4] === 2;
    var little = u8[5] === 1;
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    var u16 = function (o) { return dv.getUint16(o, little); };
    var u32 = function (o) { return dv.getUint32(o, little); };
    // Offsets in an Android .so comfortably fit in 53 bits, so reading the low
    // word of a 64-bit field is safe and avoids dragging in BigInt.
    var uN  = function (o) { return is64 ? dv.getUint32(o, little) + dv.getUint32(o + 4, little) * 4294967296 : u32(o); };

    var out = {
      bits: is64 ? 64 : 32,
      endian: little ? 'little' : 'big',
      type: TYPE[u16(16)] || ('type ' + u16(16)),
      machine: MACHINE[u16(18)] || ('machine 0x' + u16(18).toString(16)),
      size: u8.length,
      needed: [], soname: null, runpath: null,
      stripped: true, sections: [], pie: u16(16) === 3
    };

    var shoff = uN(is64 ? 0x28 : 0x20);
    var shentsize = u16(is64 ? 0x3a : 0x2e);
    var shnum = u16(is64 ? 0x3c : 0x30);
    var shstrndx = u16(is64 ? 0x3e : 0x32);

    if (!shoff || !shnum || shoff + shnum * shentsize > u8.length) {
      // Section headers can legitimately be absent; the dynamic info lives in
      // the program headers too, but for APK libraries sections are always there.
      return out;
    }

    function shdr(i) {
      var o = shoff + i * shentsize;
      return {
        nameOff: u32(o),
        type: u32(o + 4),
        offset: uN(o + (is64 ? 0x18 : 0x10)),
        size: uN(o + (is64 ? 0x20 : 0x14)),
        entsize: uN(o + (is64 ? 0x38 : 0x24)),
        link: u32(o + (is64 ? 0x28 : 0x18))
      };
    }

    var strTabHdr = shstrndx < shnum ? shdr(shstrndx) : null;
    function sectionName(off) {
      if (!strTabHdr) return '';
      var at = strTabHdr.offset + off, end = at;
      while (end < u8.length && u8[end]) end++;
      return B.utf8(u8.subarray(at, end));
    }

    var dynamic = null, dynstr = null;
    for (var i = 0; i < shnum; i++) {
      var h = shdr(i);
      var name = sectionName(h.nameOff);
      if (name) out.sections.push({ name: name, size: h.size });
      if (name === '.dynamic') dynamic = h;
      else if (name === '.dynstr') dynstr = h;
      else if (name === '.symtab') out.stripped = false;   // symtab survives only if unstripped
    }

    if (dynamic && dynstr) {
      var entSize = is64 ? 16 : 8;
      var count = Math.floor(dynamic.size / entSize);
      var strs = [];
      function str(off) {
        var at = dynstr.offset + off, end = at;
        while (end < u8.length && u8[end]) end++;
        return B.utf8(u8.subarray(at, end));
      }
      for (var d = 0; d < count; d++) {
        var o = dynamic.offset + d * entSize;
        if (o + entSize > u8.length) break;
        var tag = is64 ? uN(o) : u32(o);
        var val = is64 ? uN(o + 8) : u32(o + 4);
        if (tag === DT_NULL) break;
        if (tag === DT_NEEDED) out.needed.push(str(val));
        else if (tag === DT_SONAME) out.soname = str(val);
        else if (tag === DT_RPATH || tag === DT_RUNPATH) out.runpath = str(val);
      }
    }

    out.sections.sort(function (a, b) { return b.size - a.size; });
    return out;
  }

  /* Libraries whose presence tells you something about what the code does. */
  var TELLS = {
    'libcurl.so': 'HTTP client — makes network calls from native code',
    'libssl.so': 'TLS — native network encryption',
    'libcrypto.so': 'OpenSSL crypto',
    'libsqlite.so': 'SQLite database',
    'libmediandk.so': 'Media codecs',
    'libcamera2ndk.so': 'Camera access from native code',
    'libGLESv3.so': 'OpenGL ES 3 rendering',
    'libGLESv2.so': 'OpenGL ES 2 rendering',
    'libvulkan.so': 'Vulkan rendering',
    'libOpenSLES.so': 'Audio capture or playback',
    'libaaudio.so': 'Low-latency audio'
  };

  function notes(info) {
    var out = [];
    info.needed.forEach(function (n) { if (TELLS[n]) out.push({ lib: n, why: TELLS[n] }); });
    return out;
  }

  return { parse: parse, notes: notes, MACHINE: MACHINE };
}));
