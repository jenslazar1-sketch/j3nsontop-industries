/* J3NSONTOP INDUSTRIES - engines/index.js
 *
 * One import point for the analysis engines.
 *
 * Every file in this folder is byte-for-byte the same code the Android app, the
 * iOS app and the CLI run. They are UMD modules with no DOM in them at all —
 * they take a Uint8Array and give back structure — so React Native's bundler
 * loads them as plain CommonJS with no shim, no polyfill and no fork. That is
 * the whole reason this port is small: the parsers were never web code, they
 * were just living in a web app.
 *
 * The one exception is cryptoShim, required first, because certificate
 * fingerprints need SHA-256/SHA-1 and RN has no WebCrypto. See that file.
 */
'use strict';

require('./cryptoShim.js');

var J3Bin = require('./binary.js');
var J3Zip = require('./zip.js');
var J3Attrs = require('./attrs.js');
var J3Axml = require('./axml.js');
var J3Dex = require('./dex.js');
var J3Smali = require('./smali.js');
var J3Cert = require('./cert.js');
var J3Elf = require('./elf.js');
var J3Vr = require('./vrscan.js');
var J3Tamper = require('./tamper.js');

module.exports = {
  J3Bin: J3Bin,
  J3Zip: J3Zip,
  J3Attrs: J3Attrs,
  J3Axml: J3Axml,
  J3Dex: J3Dex,
  J3Smali: J3Smali,
  J3Cert: J3Cert,
  J3Elf: J3Elf,
  J3Vr: J3Vr,
  J3Tamper: J3Tamper,
};
