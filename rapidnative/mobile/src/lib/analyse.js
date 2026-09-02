/* J3NSONTOP INDUSTRIES - analyse.js
 *
 * Turns APK bytes into everything the screens display: manifest facts, dex
 * stats, native libraries, signers, the VR verdict and the tamper report.
 *
 * Deliberately free of any React Native import. It takes a Uint8Array and
 * returns plain data, which means it runs unchanged under Node — so the port
 * can be tested against real APKs on a desktop instead of only by tapping
 * through a phone. src/lib/files.ts holds the parts that must touch the device.
 *
 * The context handed to J3Tamper.scan is assembled exactly as the Android app's
 * integrity.js assembles it, so the phone and the CLI reach the same verdict on
 * the same file.
 */
'use strict';

var E = require('../../engines');
var J3Zip = E.J3Zip, J3Axml = E.J3Axml, J3Dex = E.J3Dex,
    J3Smali = E.J3Smali, J3Cert = E.J3Cert, J3Elf = E.J3Elf,
    J3Vr = E.J3Vr, J3Tamper = E.J3Tamper, J3Bin = E.J3Bin;

var DEX_RE = /^classes\d*\.dex$/;
var SIG_RE = /^META-INF\/.*\.(RSA|DSA|EC)$/i;
var LIB_RE = /^lib\/([^/]+)\/(.+\.so)$/;

/* ---------------------------------------------------------------- manifest */

/** Pulls the handful of manifest facts every screen wants at the top. */
function manifestFacts(doc) {
  var f = {
    package: null, versionName: null, versionCode: null,
    minSdk: null, targetSdk: null, compileSdk: null,
    application: null, debuggable: false,
    permissions: [], features: [], activities: []
  };
  if (!doc) return f;

  var root = doc.root;
  f.package = J3Axml.attrValue(doc, root, 'package');
  f.versionName = J3Axml.attrValue(doc, root, 'versionName');
  f.versionCode = J3Axml.attrValue(doc, root, 'versionCode');
  f.compileSdk = J3Axml.attrValue(doc, root, 'compileSdkVersion');

  var sdk = J3Axml.find(root, 'uses-sdk')[0];
  if (sdk) {
    f.minSdk = J3Axml.attrValue(doc, sdk, 'minSdkVersion');
    f.targetSdk = J3Axml.attrValue(doc, sdk, 'targetSdkVersion');
  }

  var app = J3Axml.find(root, 'application')[0];
  if (app) {
    f.application = J3Axml.attrValue(doc, app, 'name');
    f.debuggable = J3Axml.attrValue(doc, app, 'debuggable') === 'true';
  }

  J3Axml.find(root, 'uses-permission').forEach(function (p) {
    var n = J3Axml.attrValue(doc, p, 'name');
    if (n) f.permissions.push(n);
  });
  J3Axml.find(root, 'uses-feature').forEach(function (x) {
    var n = J3Axml.attrValue(doc, x, 'name');
    if (n) f.features.push({ name: n, required: J3Axml.attrValue(doc, x, 'required') !== 'false' });
  });
  J3Axml.find(root, 'activity').forEach(function (a) {
    var n = J3Axml.attrValue(doc, a, 'name');
    if (n) f.activities.push(n);
  });
  return f;
}

/* ------------------------------------------------------------------ shape */

/** Entry counts and byte totals, grouped the way the APK Lab screen shows them. */
function shape(zip) {
  var s = {
    entries: zip.entries.length, total: 0, compressed: 0,
    dexCount: 0, dexBytes: 0, libCount: 0, libBytes: 0,
    resBytes: 0, assetBytes: 0, abis: [], biggest: []
  };
  var abis = Object.create(null);

  zip.entries.forEach(function (e) {
    s.total += e.usize || 0;
    s.compressed += e.csize || 0;
    if (DEX_RE.test(e.name)) { s.dexCount++; s.dexBytes += e.usize || 0; }
    var m = LIB_RE.exec(e.name);
    if (m) { s.libCount++; s.libBytes += e.usize || 0; abis[m[1]] = true; }
    if (e.name.indexOf('res/') === 0 || e.name === 'resources.arsc') s.resBytes += e.usize || 0;
    if (e.name.indexOf('assets/') === 0) s.assetBytes += e.usize || 0;
  });

  s.abis = Object.keys(abis).sort();
  s.biggest = zip.entries.slice()
    .sort(function (a, b) { return (b.usize || 0) - (a.usize || 0); })
    .slice(0, 12)
    .map(function (e) { return { name: e.name, size: e.usize || 0 }; });
  return s;
}

/* ------------------------------------------------------------ native libs */

/** Parses each .so far enough to name its architecture and its dependencies. */
function natives(zip) {
  var out = [];
  var jobs = zip.entries.filter(function (e) { return LIB_RE.test(e.name); })
    .slice(0, 40)                       // a fat APK can carry hundreds; 40 is plenty to characterise it
    .map(function (e) {
      var m = LIB_RE.exec(e.name);
      return zip.read(e).then(function (b) {
        var rec = { abi: m[1], name: m[2], size: e.usize || b.length, machine: null, is64: null, needed: [], soname: null, error: null };
        try {
          var info = J3Elf.parse(b);
          rec.machine = info.machine;
          rec.is64 = info.is64;
          rec.needed = info.needed || [];
          rec.soname = info.soname || null;
        } catch (err) {
          rec.error = String(err && err.message ? err.message : err);
        }
        out.push(rec);
      }).catch(function () { });
    });
  return Promise.all(jobs).then(function () {
    out.sort(function (a, b) { return b.size - a.size; });
    return out;
  });
}

/* ---------------------------------------------------------------- signers */

function collectCerts(zip) {
  var certs = [];
  var jobs = [];

  // v2 / v3 live in the APK Signing Block, ahead of the central directory.
  zip.signing.blocks.forEach(function (b) {
    if (b.id === 0x7109871a || b.id === 0xf05368c0) {
      try {
        J3Cert.certsFromSigBlock(b.data).forEach(function (c) { c.scheme = b.name; certs.push(c); });
      } catch (e) { /* a malformed block is a finding, not a crash */ }
    }
  });

  // v1 is a PKCS#7 blob in META-INF.
  zip.entries.filter(function (e) { return SIG_RE.test(e.name); }).forEach(function (e) {
    jobs.push(zip.read(e).then(function (b) {
      try {
        J3Cert.certsFromPkcs7(b).forEach(function (c) { c.scheme = 'v1 (JAR)'; certs.push(c); });
      } catch (x) { }
    }).catch(function () { }));
  });

  return Promise.all(jobs).then(function () {
    // The same key usually signs v1, v2 and v3 — collapse to one row listing them.
    var seen = Object.create(null);
    var uniq = certs.filter(function (c) {
      var k = c.serial + '|' + c.subject;
      if (seen[k]) { seen[k].schemes.push(c.scheme); return false; }
      c.schemes = [c.scheme]; seen[k] = c; return true;
    });
    return Promise.all(uniq.map(function (c) {
      return J3Cert.fingerprints(c.der).then(function (f) { c.fp = f; });
    })).then(function () { return uniq; });
  });
}

/* ------------------------------------------------------------------ entry */

/**
 * Full analysis of one APK.
 * @param {Uint8Array} bytes
 * @returns {Promise<object>}
 */
function analyse(bytes) {
  var zip = J3Zip.open(bytes);
  var out = {
    size: bytes.length,
    zip: zip,
    manifest: null,
    facts: null,
    dexes: [],
    certs: [],
    libs: [],
    shape: null,
    vr: null,
    vrVerdict: null,
    tamper: null,
    errors: []
  };
  var jobs = [];

  if (zip.has('AndroidManifest.xml')) {
    jobs.push(zip.read('AndroidManifest.xml').then(function (b) {
      try { out.manifest = J3Axml.parseXml(b); }
      catch (e) { out.errors.push('AndroidManifest.xml: ' + e.message); }
    }).catch(function (e) { out.errors.push('AndroidManifest.xml unreadable'); }));
  } else {
    out.errors.push('No AndroidManifest.xml — this is a zip, but not an APK.');
  }

  zip.entries.filter(function (e) { return DEX_RE.test(e.name); }).forEach(function (e) {
    jobs.push(zip.read(e).then(function (b) {
      try { out.dexes.push({ name: e.name, size: b.length, dex: J3Dex.parse(b) }); }
      catch (x) { out.errors.push(e.name + ': ' + x.message); }
    }).catch(function () { }));
  });

  jobs.push(collectCerts(zip).then(function (c) { out.certs = c; }));
  jobs.push(natives(zip).then(function (l) { out.libs = l; }));

  return Promise.all(jobs).then(function () {
    out.shape = shape(zip);
    out.facts = manifestFacts(out.manifest);

    try {
      out.vr = J3Vr.scan(zip, out.manifest, J3Axml);
      out.vrVerdict = J3Vr.verdict(out.vr);
    } catch (e) { out.errors.push('VR scan: ' + e.message); }

    try {
      out.tamper = J3Tamper.scan(
        { zip: zip, manifest: out.manifest, dexes: out.dexes, certs: out.certs },
        J3Axml, J3Smali
      );
    } catch (e) { out.errors.push('Integrity scan: ' + e.message); }

    // dex classes are only needed while scanning; drop them so a big APK does
    // not sit in memory for the life of the screen.
    out.dexStats = out.dexes.map(function (d) {
      return {
        name: d.name,
        size: d.size,
        classes: d.dex && d.dex.classes ? d.dex.classes.length : 0,
        strings: d.dex && d.dex.strings ? d.dex.strings.length : 0
      };
    });
    return out;
  });
}

module.exports = {
  analyse: analyse,
  manifestFacts: manifestFacts,
  shape: shape,
  natives: natives,
  collectCerts: collectCerts,
  human: J3Bin.human
};
