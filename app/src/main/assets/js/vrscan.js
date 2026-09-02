/* J3NSONTOP INDUSTRIES - vrscan.js
 *
 * Works out what a VR APK needs, and whether a plain phone can give it.
 *
 * The question "can I run this VR game on my phone" almost never has one
 * answer — it decomposes into four independent blockers, and which ones you
 * hit decides whether the job is a five-minute manifest patch or a multi-year
 * runtime project:
 *
 *   1. ABI       does the native code even load on this CPU?
 *   2. INSTALL   does the manifest demand hardware the phone lacks?
 *   3. RUNTIME   which XR API does it call, and is there anything to answer?
 *   4. INPUT     does it need 6DoF + two tracked controllers?
 *
 * This module reports all four honestly rather than a green/red verdict,
 * because "it installs but dies at xrCreateInstance" is the single most common
 * outcome and a yes/no would hide it.
 *
 * Detection is by native library soname and manifest feature, not guesswork:
 * a Quest game always ships libopenxr_loader.so or libvrapi.so, and always
 * declares the headtracking feature.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.J3Vr = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Native libraries that identify the XR API in use. Order matters: an app
   * shipping both vrapi and the openxr loader is a legacy title mid-migration,
   * and vrapi is what it will actually call. */
  var RUNTIMES = [
    { lib: /^libvrapi\.so$/i, id: 'vrapi', name: 'Oculus VrApi (legacy Quest)',
      note: 'Pre-OpenXR Meta API. Talks to the Oculus system service over IPC, which does not exist outside a Quest. Nothing short of reimplementing that service helps.',
      phone: 'blocked' },
    { lib: /^libopenxr_loader\.so$/i, id: 'openxr', name: 'OpenXR',
      note: 'The loader looks for a runtime via the active-runtime broker. A phone has none, so xrCreateInstance fails with XR_ERROR_RUNTIME_UNAVAILABLE. This is the case a shim runtime can actually address.',
      phone: 'shim' },
    { lib: /^libwvr_api\.so$/i, id: 'wave', name: 'HTC Wave SDK',
      note: 'Vive Focus / Wave runtime. Vendor service, same problem as VrApi.',
      phone: 'blocked' },
    { lib: /^lib(pxr|picoxr|pvr)[a-z_]*\.so$/i, id: 'pico', name: 'Pico / PXR SDK',
      note: 'Pico vendor runtime. Same vendor-service problem.',
      phone: 'blocked' },
    { lib: /^libgvr\.so$/i, id: 'gvr', name: 'Google VR (Cardboard / Daydream)',
      note: 'This one was BUILT for phones — it renders side-by-side on the handset itself. Very likely already runs.',
      phone: 'native' },
    { lib: /^libcardboard.*\.so$/i, id: 'cardboard', name: 'Cardboard XR',
      note: 'Phone-based VR by design. Should run as-is.',
      phone: 'native' }
  ];

  var ENGINES = [
    { lib: /^libunity\.so$/i,        name: 'Unity' },
    { lib: /^libUE4\.so$/i,          name: 'Unreal Engine 4' },
    { lib: /^libUnreal\.so$/i,       name: 'Unreal Engine 5' },
    { lib: /^libgodot.*\.so$/i,      name: 'Godot' },
    { lib: /^libil2cpp\.so$/i,       name: 'Unity (IL2CPP)' },
    { lib: /^libmain\.so$/i,         name: 'Unity (native bootstrap)' }
  ];

  /* Manifest features that gate INSTALLATION. required="true" on any of these
   * makes the package manager refuse the install on a device without the
   * hardware — which is every phone. */
  var VR_FEATURES = {
    'android.hardware.vr.headtracking': '6DoF head tracking',
    'android.software.vr.mode':         'Android VR Mode',
    'android.hardware.vr.high_performance': 'VR performance tier',
    'oculus.software.handtracking':     'Hand tracking',
    'com.oculus.feature.PASSTHROUGH':   'Passthrough camera',
    'oculus.software.eye_tracking':     'Eye tracking',
    'oculus.software.face_tracking':    'Face tracking',
    'oculus.software.body_tracking':    'Body tracking',
    'wave.feature.handtracking':        'Wave hand tracking'
  };

  /**
   * @param zip   an open J3Zip archive
   * @param doc   the parsed AndroidManifest (J3Axml.parseXml result), or null
   * @param axml  the J3Axml module (passed in so this file stays dependency-free)
   */
  function scan(zip, doc, axml) {
    var out = {
      isVR: false, runtime: null, engine: null,
      abis: [], has64: false, hasArm: false, hasX86: false,
      features: [], permissions: [], categories: [],
      blockers: [], notes: [], libs: []
    };

    /* ---- native libraries: the ground truth about what this app calls ---- */
    var abiSet = {};
    zip.entries.forEach(function (e) {
      var m = /^lib\/([^/]+)\/(.+\.so)$/.exec(e.name);
      if (!m) return;
      abiSet[m[1]] = true;
      var soname = m[2];
      out.libs.push({ abi: m[1], name: soname, size: e.usize });

      RUNTIMES.forEach(function (r) {
        if (r.lib.test(soname) && (!out.runtime || r.id === 'vrapi')) out.runtime = r;
      });
      ENGINES.forEach(function (g) {
        if (g.lib.test(soname) && !out.engine) out.engine = g.name;
      });
    });

    out.abis = Object.keys(abiSet).sort();
    out.has64  = out.abis.indexOf('arm64-v8a') >= 0;
    out.hasArm = out.has64 || out.abis.indexOf('armeabi-v7a') >= 0;
    out.hasX86 = out.abis.indexOf('x86_64') >= 0 || out.abis.indexOf('x86') >= 0;

    /* ---- manifest: what it demands before it will even install ---- */
    if (doc && axml) {
      axml.find(doc.root, 'uses-feature').forEach(function (f) {
        var name = axml.attrValue(doc, f, 'name');
        var req  = axml.attrValue(doc, f, 'required');
        if (!name) return;
        if (VR_FEATURES[name] || /vr|oculus|openxr|wave|pico/i.test(name)) {
          out.features.push({ name: name, required: req !== 'false',
                              label: VR_FEATURES[name] || name });
        }
      });
      axml.find(doc.root, 'uses-permission').forEach(function (p) {
        var n = axml.attrValue(doc, p, 'name');
        if (n && /oculus|vr\.|horizon|wave|pico/i.test(n)) out.permissions.push(n);
      });
      axml.find(doc.root, 'category').forEach(function (c) {
        var n = axml.attrValue(doc, c, 'name');
        if (n && /oculus|vr|daydream|cardboard/i.test(n)) out.categories.push(n);
      });
    }

    out.isVR = !!out.runtime || out.features.length > 0 || out.categories.length > 0;
    if (!out.isVR) return out;

    /* ---- the four blockers, each reported separately ---- */

    // 1. ABI
    if (!out.hasX86 && out.hasArm) {
      out.blockers.push({
        kind: 'abi', level: 'emulator',
        title: 'ARM-only native code',
        detail: 'Ships ' + out.abis.join(', ') + ' and no x86. A standard x86_64 emulator cannot load it; you need a real ARM phone, or an emulator image with ARM translation (slow, and usually not viable for a GL-heavy game).'
      });
    }

    // 2. INSTALL
    var hard = out.features.filter(function (f) { return f.required; });
    if (hard.length) {
      out.blockers.push({
        kind: 'install', level: 'fixable',
        title: hard.length + ' required VR feature' + (hard.length === 1 ? '' : 's'),
        detail: 'The package manager refuses to install when a required uses-feature is missing: ' +
                hard.map(function (f) { return f.label; }).join(', ') +
                '. Flipping required to false lets it install. That is a manifest edit APK LAB can do.'
      });
    }

    // 3. RUNTIME — the real wall
    if (out.runtime) {
      if (out.runtime.phone === 'blocked') {
        out.blockers.push({
          kind: 'runtime', level: 'hard',
          title: 'Needs the ' + out.runtime.name + ' vendor service',
          detail: out.runtime.note
        });
      } else if (out.runtime.phone === 'shim') {
        out.blockers.push({
          kind: 'runtime', level: 'shim',
          title: 'Needs an OpenXR runtime',
          detail: out.runtime.note
        });
      } else {
        out.notes.push('Uses ' + out.runtime.name + ' — ' + out.runtime.note);
      }
    }

    // 4. INPUT
    if (out.runtime && out.runtime.phone !== 'native') {
      out.blockers.push({
        kind: 'input', level: 'design',
        title: 'Built for 6DoF and two tracked controllers',
        detail: 'A phone has a gyroscope (3DoF rotation) and a touchscreen. Head rotation can be synthesised; position and two 6DoF hands cannot. Seated look-around titles adapt; anything needing real reach does not.'
      });
    }

    return out;
  }

  /** One-line summary for a list view. */
  function verdict(r) {
    if (!r.isVR) return { level: 'none', text: 'Not a VR app' };
    var worst = 'ok';
    r.blockers.forEach(function (b) {
      if (b.level === 'hard') worst = 'hard';
      else if (b.level === 'shim' && worst !== 'hard') worst = 'shim';
      else if (b.level === 'emulator' && worst !== 'hard' && worst !== 'shim') worst = 'emulator';
      else if (b.level === 'fixable' && worst === 'ok') worst = 'fixable';
    });
    var TEXT = {
      ok:       'Should run on a phone as-is',
      fixable:  'Installable after a manifest patch',
      emulator: 'Needs a real ARM device',
      shim:     'Installs, but needs an OpenXR runtime to start',
      hard:     'Needs a vendor runtime that does not exist off-headset'
    };
    return { level: worst, text: TEXT[worst] };
  }

  /** The manifest edits that make a VR APK installable on a phone. */
  function relaxPlan(doc, axml) {
    if (!doc) return [];
    var plan = [];
    axml.find(doc.root, 'uses-feature').forEach(function (f) {
      var name = axml.attrValue(doc, f, 'name');
      if (!name) return;
      if (!(VR_FEATURES[name] || /vr|oculus|openxr|wave|pico/i.test(name))) return;
      if (axml.attrValue(doc, f, 'required') === 'false') return;
      plan.push({ el: f, name: name, action: 'required=false' });
    });
    return plan;
  }

  /** Applies relaxPlan in place. Returns how many elements changed. */
  function relax(doc, axml) {
    var plan = relaxPlan(doc, axml);
    plan.forEach(function (p) { axml.setBool(p.el, 'required', false); });
    return plan.length;
  }

  return {
    scan: scan, verdict: verdict, relax: relax, relaxPlan: relaxPlan,
    RUNTIMES: RUNTIMES, VR_FEATURES: VR_FEATURES
  };
}));
