/* J3NSONTOP INDUSTRIES - tamper.js
 *
 * Tells you whether an APK has been repacked or had a mod injected into it.
 * The exact inverse of the drop-a-.so-and-patch-onCreate flow: it looks for the
 * fingerprints that flow leaves behind.
 *
 * No single check is proof, so nothing here returns a bare yes/no — it collects
 * independent signals and scores them, because the honest answer to "is this
 * modded" is usually "here is the evidence, you decide". The strong tells:
 *
 *   SIGNER   a real app is signed by its publisher. A debug key, or a v1-only
 *            signature where v2/v3 should be, means the original signing was
 *            stripped and replaced — which only happens in a repack.
 *   PAYLOAD  a native library whose name matches a mod / hook framework, or a
 *            System.loadLibrary() call spliced in to load one.
 *   MANIFEST a custom Application class that runs before the game, a debuggable
 *            flag, VR gates relaxed so it installs where it shouldn't.
 *   PHYSICAL resources.arsc left compressed, or a handful of entries carrying a
 *            different timestamp from the rest — files touched after the build.
 *
 * Reuses the same zip / axml / dex / smali / cert engines as the rest of the
 * lab, so what the phone reports and what the CLI reports are identical.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.J3Tamper = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Native libraries that are a mod, a menu, or a hooking framework. Matched on
   * the bare soname (lib<NAME>.so -> NAME), case-insensitive. */
  var HOOK = [
    /^frida/i, /gadget/i, /substrate/i, /^riru/i, /zygisk/i, /lsposed/i, /xposed/i,
    /^dobby$/i, /whale/i, /xhook/i, /shadowhook/i, /^bhook/i, /inlinehook/i, /gum/i
  ];
  var MOD = [
    /mod.?menu/i, /modmenu/i, /^mod$/i, /cheat/i, /^hack/i, /aimbot/i, /wallhack/i,
    /^esp$/i, /trainer/i, /inject/i, /^menu$/i, /^mega$/i, /melonloader/i, /^lemon/i,
    /^imgui$/i, /overlay.?menu/i, /^j3prefab$/i, /^j3lib$/i, /gorillamod/i, /monkemod/i
  ];
  /* Names that look mod-ish but are legitimate engine / runtime / SDK libs. */
  var LEGIT = new RegExp('^(' + [
    'unity', 'il2cpp', 'main', 'mono', 'monobdwgc', 'unreal', 'ue4', 'ue5', 'godot',
    'fmod', 'fmodstudio', 'openal', 'oboe', 'c\\+\\+_shared', 'c\\+\\+_static', 'gnustl',
    'openxr_loader', 'ovrplatformloader', 'ovrplugin', 'oculusxrplugin', 'vrapi',
    'wave', 'pxr', 'pvr', 'gvr', 'cardboard', 'audiopluginoculusspatializer',
    'interactionsdk', 'ovrlipsync', 'sdktelemetry', 'burst_generated', 'opus_egpv',
    'webrtc.*', 'double-conversion', 'xplat.*', 'flutter', 'app', 'crashlytics',
    'bugsnag', 'tensorflow.*', 'firebase.*', 'hermes', 'jsc', 'reactnative.*',
    'sqlite.*', 'png', 'jpeg', 'turbojpeg', 'ffmpeg', 'avcodec', 'avformat'
  ].join('|') + ')$', 'i');

  /* Application classes that are normal engine bootstraps, not injected loaders. */
  var LEGIT_APP = [
    /^com\.unity3d\./, /^com\.epicgames\./, /^androidx?\./, /^android\./,
    /^com\.google\./, /^io\.flutter\./, /^org\.godotengine\./, /Application$/i,
    /^com\.facebook\.react\./, /^com\.oculus\./, /^com\.meta\./
  ];
  var ANDROID_DEBUG = /CN=Android Debug/i;

  function soName(entry) {
    var m = /(?:^|\/)lib([^/]+)\.so$/.exec(entry);
    return m ? m[1] : null;
  }

  var WEIGHT = { info: 0, low: 5, med: 12, high: 25, critical: 40 };

  /**
   * @param ctx { zip, manifest, dexes:[{name,size,dex}], certs:[...] }
   * @param X   the J3Axml module (for manifest reads)
   * @param S   the J3Smali module (optional; enables pinpointing the loader)
   */
  function scan(ctx, X, S) {
    var z = ctx.zip, doc = ctx.manifest, dexes = ctx.dexes || [], certs = ctx.certs || [];
    var F = [];
    function add(sev, id, title, detail, ev) { F.push({ sev: sev, id: id, title: title, detail: detail, evidence: ev || null }); }

    /* --------------------------------------------------------- signing --- */
    var schemes = z.signing.schemes.slice();
    var hasV1 = z.entries.some(function (e) { return /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(e.name); });
    if (hasV1) schemes.unshift('v1 (JAR)');

    if (!certs.length && !z.signing.present && !hasV1) {
      add('high', 'unsigned', 'Unsigned', 'No signature at all. Android will not install this, and it has clearly been through a repack tool that did not re-sign.');
    }
    certs.forEach(function (c) {
      if (ANDROID_DEBUG.test(c.subject || '')) {
        add('high', 'debug-key', 'Signed with the Android debug key',
          'A published app is never shipped with the debug key. The original signature was stripped and replaced with a debug re-sign — the standard last step of a repack. (Also normal for a developer test build.)',
          c.subject);
      } else if (c.selfSigned && /CN=(Unknown|SignChief|Test|Android)\b/i.test(c.subject || '')) {
        add('med', 'generic-signer', 'Generic self-signed certificate',
          'Signer identity is a placeholder rather than a real publisher: ' + c.subject, c.subject);
      }
      if (c.expired) add('med', 'expired-cert', 'Signing certificate expired', 'Expired ' + (c.notAfter ? c.notAfter.toISOString().slice(0, 10) : '?') + '.');
    });
    var hasModern = schemes.some(function (s) { return /v2|v3/.test(s); });
    if ((hasV1 || z.signing.present) && !hasModern) {
      add('med', 'v1-only', 'v1-only signature',
        'Signed with the legacy JAR scheme and no v2/v3. Modern build pipelines always produce v2/v3; a v1-only signature is typical of a re-sign after tampering.', schemes.join(', '));
    }

    /* ---------------------------------------------------- native libs --- */
    // Null-prototype maps: a dex string pool is full of "toString"/"valueOf"/
    // "constructor", and a normal object would report those as loaded libraries
    // via the prototype chain.
    var present = Object.create(null);   // bare name -> [entries]
    z.entries.forEach(function (e) {
      var n = soName(e.name);
      if (!n) return;
      (present[n] || (present[n] = [])).push(e.name);
    });
    var modLibs = [], hookLibs = [];
    Object.keys(present).forEach(function (n) {
      if (LEGIT.test(n)) return;
      if (HOOK.some(function (r) { return r.test(n); })) hookLibs.push(n);
      else if (MOD.some(function (r) { return r.test(n); })) modLibs.push(n);
    });
    hookLibs.forEach(function (n) {
      add('critical', 'hook-framework', 'Hooking framework present: lib' + n + '.so',
        'This is an instrumentation / hooking library (Frida, Substrate, Riru/Zygisk and friends). Its only reason to be inside a game is to alter it at runtime.', present[n].join(', '));
    });
    modLibs.forEach(function (n) {
      add('high', 'mod-lib', 'Mod library present: lib' + n + '.so',
        'The name matches a mod menu / overlay / cheat library. Legitimate apps do not ship these.', present[n].join(', '));
    });

    /* -------------------------------- loadLibrary cross-reference ------- */
    /* One pass per dex string pool: which present lib names are referenced by
     * name in the code, i.e. actually System.loadLibrary()'d. */
    var loaded = Object.create(null);
    var names = Object.keys(present);
    if (names.length) {
      var nameSet = Object.create(null);
      names.forEach(function (n) { nameSet[n] = true; });
      dexes.forEach(function (d) {
        try {
          var dex = d.dex, cnt = dex.counts.strings;
          for (var i = 0; i < cnt; i++) {
            var s = dex.string(i);
            if (s.length > 0 && s.length < 40 && nameSet[s]) loaded[s] = (loaded[s] || 0) + 1;
          }
        } catch (e) { }
      });
    }
    (modLibs.concat(hookLibs)).forEach(function (n) {
      if (!loaded[n]) return;
      var where = S ? locateLoad(dexes, S, n) : null;
      add('critical', 'mod-loadlib', 'lib' + n + '.so is loaded by the code',
        'The mod library is present AND a System.loadLibrary("' + n + '") call references it' +
        (where ? ' — spliced into ' + where : '') +
        '. That is an injected loader: the payload is wired to run at startup.', where);
    });

    /* -------------------------------------------------- manifest --- */
    if (doc && X) {
      var app = X.children(doc.root, 'application')[0];
      if (app) {
        var appName = X.attrValue(doc, app, 'name');
        if (appName && !LEGIT_APP.some(function (r) { return r.test(appName); })) {
          add('low', 'custom-app', 'Custom Application class: ' + appName,
            'A custom android:name on <application> runs before anything else. Usually legitimate, but it is also where a repacker bootstraps a loader — worth a look if other signals are red.', appName);
        }
        if (X.attrValue(doc, app, 'debuggable') === 'true') {
          add('med', 'debuggable', 'Debuggable flag set',
            'debuggable="true" on a shipped app lets anyone attach a debugger. Repack tools set it so the modder can poke at the running game.');
        }
      }
      // VR gates relaxed = the de-VR patch signature
      var relaxed = X.find(doc.root, 'uses-feature').filter(function (f) {
        var nm = X.attrValue(doc, f, 'name');
        return nm && /vr|headtracking|oculus/i.test(nm) && X.attrValue(doc, f, 'required') === 'false';
      });
      if (relaxed.length) {
        add('med', 'vr-relaxed', 'VR feature gates relaxed',
          relaxed.length + ' VR feature(s) set to not-required — the signature of a de-VR patch so the app installs on hardware it was not built for.',
          relaxed.map(function (f) { return X.attrValue(doc, f, 'name'); }).join(', '));
      }
    }

    /* -------------------------------------------------- physical --- */
    var arsc = z.get && z.get('resources.arsc');
    if (arsc && arsc.method !== 0) {
      add('med', 'arsc-compressed', 'resources.arsc is compressed',
        'Since Android 11 resources.arsc must be stored uncompressed. A compressed one means a repack tool rebuilt the archive without aligning it.');
    }
    // native libs compressed / unaligned when the app mmaps them
    var extractFalse = false;
    if (doc && X) {
      var ap = X.children(doc.root, 'application')[0];
      extractFalse = ap && X.attrValue(doc, ap, 'extractNativeLibs') === 'false';
    }
    if (extractFalse) {
      var badSo = z.entries.filter(function (e) {
        if (!/\.so$/.test(e.name)) return false;
        try { return e.method !== 0 || (z.locate(e) % 4096) !== 0; } catch (x) { return false; }
      });
      if (badSo.length) {
        add('med', 'so-unaligned', badSo.length + ' native librar' + (badSo.length === 1 ? 'y' : 'ies') + ' not page-aligned',
          'extractNativeLibs is false, so the platform mmaps the .so files — they must be stored and 4096-aligned. These are not, which a correct build never produces but a hand-repack does.',
          badSo.slice(0, 6).map(function (e) { return e.name; }).join(', '));
      }
    }

    // timestamp outliers: files touched after the original build
    var ts = timestampOutliers(z);
    if (ts) {
      add('med', 'timestamp-outliers', ts.list.length + ' entr' + (ts.list.length === 1 ? 'y' : 'ies') + ' with a different timestamp',
        'Most of the archive shares one build time; these carry a later one, consistent with files added or edited after the original build.',
        ts.list.join(', '));
    }

    /* ------------------------------------------------------ verdict --- */
    var score = F.reduce(function (a, f) { return a + (WEIGHT[f.sev] || 0); }, 0);
    var has = function (id) { return F.some(function (f) { return f.id === id; }); };
    var maxSev = F.reduce(function (m, f) { return WEIGHT[f.sev] > WEIGHT[m] ? f.sev : m; }, 'info');

    var verdict, vlevel;
    if (has('mod-loadlib') || has('hook-framework')) { verdict = 'INJECTED'; vlevel = 'critical'; }
    else if (has('mod-lib')) { verdict = 'MOD PRESENT'; vlevel = 'high'; }
    else if (score >= 24) { verdict = 'REPACKED'; vlevel = 'high'; }
    else if (score >= 12) { verdict = 'LIKELY REPACKED'; vlevel = 'med'; }
    else if (score > 0) { verdict = 'MINOR SIGNALS'; vlevel = 'low'; }
    else { verdict = 'CLEAN'; vlevel = 'ok'; }

    F.sort(function (a, b) { return WEIGHT[b.sev] - WEIGHT[a.sev]; });
    return { verdict: verdict, level: vlevel, score: score, maxSev: maxSev,
             findings: F, schemes: schemes, loadedLibs: loaded };
  }

  /* Best-effort: find the class.method that loads a given lib by name. Bounded
   * hard because an injected loader is always tiny and in a small dex, never
   * buried in a 60 MB il2cpp blob. */
  function locateLoad(dexes, S, wantName) {
    var need = '"' + wantName + '"';
    var order = dexes.slice().sort(function (a, b) { return (a.size || 0) - (b.size || 0); });
    var budget = 4000;
    for (var d = 0; d < order.length; d++) {
      if ((order[d].size || 0) > 6 * 1024 * 1024) continue;
      var dex = order[d].dex;
      for (var i = 0; i < dex.classes.length; i++) {
        var ci;
        try { ci = dex.classInfo(i); } catch (e) { continue; }
        for (var m = 0; m < ci.methods.length; m++) {
          var mm = ci.methods[m];
          if (!mm.hasCode || mm.insns > 3000) continue;
          if (--budget < 0) return null;
          var text;
          try { text = S.render(S.disassemble(dex, dex.bytes, mm.codeOff, { max: 600 })); }
          catch (e) { continue; }
          if (text.indexOf('loadLibrary') >= 0 && text.indexOf(need) >= 0) {
            return ci.name + '.' + mm.name + '()';
          }
        }
      }
    }
    return null;
  }

  function timestampOutliers(z) {
    var entries = z.entries.filter(function (e) { return !e.isDir && e.date; });
    if (entries.length < 10) return null;
    var buckets = Object.create(null), best = null;
    entries.forEach(function (e) {
      var t = e.date.getTime();
      if (t < 315532800000) return;           // ignore 1980-ish zeroed times
      var key = Math.round(t / 60000);         // minute buckets
      buckets[key] = (buckets[key] || 0) + 1;
      if (!best || buckets[key] > buckets[best]) best = key;
    });
    if (best === null) return null;
    var dominant = buckets[best], total = entries.length;
    if (dominant / total < 0.55) return null;   // no clear build cluster
    var domT = best * 60000;
    var out = entries.filter(function (e) {
      var t = e.date.getTime();
      return t >= 315532800000 && Math.abs(t - domT) > 3600000;   // >1h from the cluster
    });
    if (!out.length || out.length > 15) return null;
    return { list: out.map(function (e) { return e.name; }) };
  }

  return { scan: scan };
}));
