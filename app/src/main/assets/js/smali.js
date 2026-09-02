/* J3NSONTOP INDUSTRIES - smali.js
 *
 * Dalvik bytecode disassembler.
 *
 * Until now APK LAB could show you a method's signature but not what it did.
 * This turns the bodies into readable smali, which is the honest halfway house
 * between "here is a name" and "here is Java": every instruction is real, the
 * register moves are visible, and no decompiler is guessing at control flow.
 *
 * The whole thing hangs off one table: opcode -> [mnemonic, format]. Dalvik
 * instruction formats are fixed-width and self-describing (10x is one 16-bit
 * unit and no operands, 35c is three units with a packed register list), so
 * once the format is known the decode is mechanical.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.J3Smali = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* opcode -> "mnemonic fmt", index is the opcode byte. Gaps are unused
   * opcodes, which in practice only turn up in ODEX or corrupt input. */
  var T = (
    'nop 10x,move 12x,move/from16 22x,move/16 32x,move-wide 12x,move-wide/from16 22x,' +
    'move-wide/16 32x,move-object 12x,move-object/from16 22x,move-object/16 32x,' +
    'move-result 11x,move-result-wide 11x,move-result-object 11x,move-exception 11x,' +
    'return-void 10x,return 11x,return-wide 11x,return-object 11x,' +
    'const/4 11n,const/16 21s,const 31i,const/high16 21h,const-wide/16 21s,const-wide/32 31i,' +
    'const-wide 51l,const-wide/high16 21h,const-string 21c,const-string/jumbo 31c,const-class 21c,' +
    'monitor-enter 11x,monitor-exit 11x,check-cast 21c,instance-of 22c,array-length 12x,' +
    'new-instance 21c,new-array 22c,filled-new-array 35c,filled-new-array/range 3rc,' +
    'fill-array-data 31t,throw 11x,goto 10t,goto/16 20t,goto/32 30t,packed-switch 31t,sparse-switch 31t,' +
    'cmpl-float 23x,cmpg-float 23x,cmpl-double 23x,cmpg-double 23x,cmp-long 23x,' +
    'if-eq 22t,if-ne 22t,if-lt 22t,if-ge 22t,if-gt 22t,if-le 22t,' +
    'if-eqz 21t,if-nez 21t,if-ltz 21t,if-gez 21t,if-gtz 21t,if-lez 21t,' +
    '- ,- ,- ,- ,- ,- ,' +
    'aget 23x,aget-wide 23x,aget-object 23x,aget-boolean 23x,aget-byte 23x,aget-char 23x,aget-short 23x,' +
    'aput 23x,aput-wide 23x,aput-object 23x,aput-boolean 23x,aput-byte 23x,aput-char 23x,aput-short 23x,' +
    'iget 22c,iget-wide 22c,iget-object 22c,iget-boolean 22c,iget-byte 22c,iget-char 22c,iget-short 22c,' +
    'iput 22c,iput-wide 22c,iput-object 22c,iput-boolean 22c,iput-byte 22c,iput-char 22c,iput-short 22c,' +
    'sget 21c,sget-wide 21c,sget-object 21c,sget-boolean 21c,sget-byte 21c,sget-char 21c,sget-short 21c,' +
    'sput 21c,sput-wide 21c,sput-object 21c,sput-boolean 21c,sput-byte 21c,sput-char 21c,sput-short 21c,' +
    'invoke-virtual 35c,invoke-super 35c,invoke-direct 35c,invoke-static 35c,invoke-interface 35c,- ,' +
    'invoke-virtual/range 3rc,invoke-super/range 3rc,invoke-direct/range 3rc,invoke-static/range 3rc,' +
    'invoke-interface/range 3rc,- ,- ,' +
    'neg-int 12x,not-int 12x,neg-long 12x,not-long 12x,neg-float 12x,neg-double 12x,' +
    'int-to-long 12x,int-to-float 12x,int-to-double 12x,long-to-int 12x,long-to-float 12x,long-to-double 12x,' +
    'float-to-int 12x,float-to-long 12x,float-to-double 12x,double-to-int 12x,double-to-long 12x,' +
    'double-to-float 12x,int-to-byte 12x,int-to-char 12x,int-to-short 12x,' +
    'add-int 23x,sub-int 23x,mul-int 23x,div-int 23x,rem-int 23x,and-int 23x,or-int 23x,xor-int 23x,' +
    'shl-int 23x,shr-int 23x,ushr-int 23x,' +
    'add-long 23x,sub-long 23x,mul-long 23x,div-long 23x,rem-long 23x,and-long 23x,or-long 23x,xor-long 23x,' +
    'shl-long 23x,shr-long 23x,ushr-long 23x,' +
    'add-float 23x,sub-float 23x,mul-float 23x,div-float 23x,rem-float 23x,' +
    'add-double 23x,sub-double 23x,mul-double 23x,div-double 23x,rem-double 23x,' +
    'add-int/2addr 12x,sub-int/2addr 12x,mul-int/2addr 12x,div-int/2addr 12x,rem-int/2addr 12x,' +
    'and-int/2addr 12x,or-int/2addr 12x,xor-int/2addr 12x,shl-int/2addr 12x,shr-int/2addr 12x,ushr-int/2addr 12x,' +
    'add-long/2addr 12x,sub-long/2addr 12x,mul-long/2addr 12x,div-long/2addr 12x,rem-long/2addr 12x,' +
    'and-long/2addr 12x,or-long/2addr 12x,xor-long/2addr 12x,shl-long/2addr 12x,shr-long/2addr 12x,ushr-long/2addr 12x,' +
    'add-float/2addr 12x,sub-float/2addr 12x,mul-float/2addr 12x,div-float/2addr 12x,rem-float/2addr 12x,' +
    'add-double/2addr 12x,sub-double/2addr 12x,mul-double/2addr 12x,div-double/2addr 12x,rem-double/2addr 12x,' +
    'add-int/lit16 22s,rsub-int 22s,mul-int/lit16 22s,div-int/lit16 22s,rem-int/lit16 22s,' +
    'and-int/lit16 22s,or-int/lit16 22s,xor-int/lit16 22s,' +
    'add-int/lit8 22b,rsub-int/lit8 22b,mul-int/lit8 22b,div-int/lit8 22b,rem-int/lit8 22b,' +
    'and-int/lit8 22b,or-int/lit8 22b,xor-int/lit8 22b,shl-int/lit8 22b,shr-int/lit8 22b,ushr-int/lit8 22b'
  ).split(',');

  // 0xe3..0xf9 are unused in modern dex; 0xfa.. are the invoke-polymorphic family.
  var TAIL = {
    0xfa: 'invoke-polymorphic 45cc', 0xfb: 'invoke-polymorphic/range 4rcc',
    0xfc: 'invoke-custom 35c',       0xfd: 'invoke-custom/range 3rc',
    0xfe: 'const-method-handle 21c', 0xff: 'const-method-type 21c'
  };

  function entry(op) {
    if (TAIL[op]) return TAIL[op].split(' ');
    var e = T[op];
    if (!e || e.charAt(0) === '-') return null;
    var sp = e.lastIndexOf(' ');
    return [e.slice(0, sp), e.slice(sp + 1)];
  }

  /** How many 16-bit units each format occupies. */
  var SIZE = {
    '10x': 1, '12x': 1, '11n': 1, '11x': 1, '10t': 1,
    '20t': 2, '22x': 2, '21t': 2, '21s': 2, '21h': 2, '21c': 2, '23x': 2,
    '22b': 2, '22t': 2, '22s': 2, '22c': 2,
    '30t': 3, '31i': 3, '31t': 3, '31c': 3, '32x': 3, '35c': 3, '3rc': 3,
    '45cc': 4, '4rcc': 4, '51l': 5
  };

  /** Which pool a @index operand points into, worked out from the mnemonic. */
  function refKind(name) {
    if (/^invoke-custom/.test(name)) return 'call_site';
    if (/^invoke/.test(name)) return 'method';
    if (/^(iget|iput|sget|sput)/.test(name)) return 'field';
    if (/^const-string/.test(name)) return 'string';
    if (/^const-method-handle/.test(name)) return 'method_handle';
    if (/^const-method-type/.test(name)) return 'proto';
    return 'type';
  }

  function s4(n)  { return n & 0x8 ? n - 16 : n; }
  function s8(n)  { return n & 0x80 ? n - 256 : n; }
  function s16(n) { return n & 0x8000 ? n - 65536 : n; }

  function hexs(n) {
    return (n < 0 ? '-0x' + (-n).toString(16) : '0x' + n.toString(16));
  }

  /**
   * @param dex  a J3Dex.parse() result, used to resolve @index operands
   * @param code Uint8Array view of the whole dex (we index absolutely)
   * @param off  code_item offset
   */
  function disassemble(dex, u8, codeOff, opts) {
    opts = opts || {};
    var max = opts.max || 4000;
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    var registers = dv.getUint16(codeOff, true);
    var ins       = dv.getUint16(codeOff + 2, true);
    var outs      = dv.getUint16(codeOff + 4, true);
    var tries     = dv.getUint16(codeOff + 6, true);
    var insnsSize = dv.getUint32(codeOff + 12, true);
    var base      = codeOff + 16;

    var u16 = function (i) { return dv.getUint16(base + i * 2, true); };

    function ref(kind, idx) {
      try {
        if (kind === 'string') {
          var s = dex.string(idx);
          return '"' + (s.length > 90 ? s.slice(0, 90) + '…' : s).replace(/\n/g, '\\n') + '"';
        }
        if (kind === 'type')   return dex.type(idx);
        if (kind === 'field')  { var f = dex.field(idx);  return f ? f.cls + '.' + f.name + ':' + f.type : 'field@' + idx; }
        if (kind === 'method') { var m = dex.method(idx); return m ? m.cls + '.' + m.name + '(' + m.args.join(', ') + ')' : 'method@' + idx; }
      } catch (e) { }
      return kind + '@' + idx;
    }

    var out = [], i = 0, truncated = false;

    while (i < insnsSize) {
      if (out.length >= max) { truncated = true; break; }

      var unit = u16(i);
      var op = unit & 0xff, hi = (unit >> 8) & 0xff;
      var e = entry(op);

      if (!e) {
        // Padding, switch/array payload tables, or genuinely unknown.
        out.push({ at: i, text: '(data 0x' + ('0000' + unit.toString(16)).slice(-4) + ')' });
        i++;
        continue;
      }

      var name = e[0], fmt = e[1], n = SIZE[fmt] || 1, text;
      var A = hi & 0x0f, B = (hi >> 4) & 0x0f;

      switch (fmt) {
        case '10x': text = name; break;
        case '12x': text = name + ' v' + A + ', v' + B; break;
        case '11n': text = name + ' v' + A + ', ' + hexs(s4(B)); break;
        case '11x': text = name + ' v' + hi; break;
        case '10t': text = name + ' :' + hexs(i + s8(hi)); break;
        case '20t': text = name + ' :' + hexs(i + s16(u16(i + 1))); break;
        case '22x': text = name + ' v' + hi + ', v' + u16(i + 1); break;
        case '21t': text = name + ' v' + hi + ', :' + hexs(i + s16(u16(i + 1))); break;
        case '21s': text = name + ' v' + hi + ', ' + hexs(s16(u16(i + 1))); break;
        case '21h':
          // The literal is the operand shifted into the high half of the word.
          text = name + ' v' + hi + ', ' + (/wide/.test(name)
              ? '0x' + u16(i + 1).toString(16) + '000000000000'
              : '0x' + u16(i + 1).toString(16) + '0000');
          break;
        case '21c': text = name + ' v' + hi + ', ' + ref(refKind(name), u16(i + 1)); break;
        case '23x': {
          var bc = u16(i + 1);
          text = name + ' v' + hi + ', v' + (bc & 0xff) + ', v' + ((bc >> 8) & 0xff);
          break;
        }
        case '22b': {
          var bc2 = u16(i + 1);
          text = name + ' v' + hi + ', v' + (bc2 & 0xff) + ', ' + hexs(s8((bc2 >> 8) & 0xff));
          break;
        }
        case '22t': text = name + ' v' + A + ', v' + B + ', :' + hexs(i + s16(u16(i + 1))); break;
        case '22s': text = name + ' v' + A + ', v' + B + ', ' + hexs(s16(u16(i + 1))); break;
        case '22c': text = name + ' v' + A + ', v' + B + ', ' + ref(refKind(name), u16(i + 1)); break;
        case '30t': text = name + ' :' + hexs(i + ((u16(i + 1) | (u16(i + 2) << 16)) | 0)); break;
        case '31i': text = name + ' v' + hi + ', ' + hexs((u16(i + 1) | (u16(i + 2) << 16)) | 0); break;
        case '31t': text = name + ' v' + hi + ', :' + hexs(i + ((u16(i + 1) | (u16(i + 2) << 16)) | 0)); break;
        case '31c': text = name + ' v' + hi + ', ' + ref('string', (u16(i + 1) | (u16(i + 2) << 16)) >>> 0); break;
        case '32x': text = name + ' v' + u16(i + 1) + ', v' + u16(i + 2); break;
        case '35c': case '45cc': {
          // A = argument count, the registers are nibbles of G|F|E|D|C.
          var idx35 = u16(i + 1), fedc = u16(i + 2);
          var regs = [fedc & 0xf, (fedc >> 4) & 0xf, (fedc >> 8) & 0xf, (fedc >> 12) & 0xf, A];
          var list = [];
          for (var k = 0; k < B; k++) list.push('v' + regs[k]);
          text = name + ' {' + list.join(', ') + '}, ' + ref(refKind(name), idx35);
          if (fmt === '45cc') text += ', proto@' + u16(i + 3);
          break;
        }
        case '3rc': case '4rcc': {
          var idxr = u16(i + 1), first = u16(i + 2);
          text = name + ' {v' + first + ' .. v' + (first + hi - 1) + '}, ' + ref(refKind(name), idxr);
          if (fmt === '4rcc') text += ', proto@' + u16(i + 3);
          break;
        }
        case '51l': {
          var lo = (u16(i + 1) | (u16(i + 2) << 16)) >>> 0;
          var hiw = (u16(i + 3) | (u16(i + 4) << 16)) >>> 0;
          text = name + ' v' + hi + ', 0x' + hiw.toString(16) + ('00000000' + lo.toString(16)).slice(-8);
          break;
        }
        default: text = name;
      }

      out.push({ at: i, text: text });
      i += n;
    }

    return {
      registers: registers, ins: ins, outs: outs, tries: tries,
      insnsSize: insnsSize, lines: out, truncated: truncated
    };
  }

  /** Renders a method body as a smali-ish listing. */
  function render(dis) {
    var head = '    .registers ' + dis.registers +
               '   .params ' + dis.ins + '   .outs ' + dis.outs +
               (dis.tries ? '   .catches ' + dis.tries : '') + '\n';
    var body = dis.lines.map(function (l) {
      return '    ' + ('000' + l.at.toString(16)).slice(-4) + ':  ' + l.text;
    }).join('\n');
    return head + body + (dis.truncated ? '\n    … truncated' : '');
  }

  return { disassemble: disassemble, render: render, entry: entry, SIZE: SIZE };
}));
