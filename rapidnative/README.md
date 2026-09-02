# J3NSONTOP INDUSTRIES — RapidNative monorepo

A real Expo app, not a wrapped website. The APK parsing engines from the Android
app are reused **byte for byte**; the interface is native React Native.

```
.
├── package.json          workspace root (workspaces: ["mobile"])
└── mobile/               <- the Expo app (mobile/package.json)
    ├── app/              Expo Router screens
    │   ├── _layout.tsx   tab navigator
    │   ├── index.tsx     load an APK
    │   ├── apklab.tsx    manifest, contents, dex, native libs
    │   ├── integrity.tsx repack / injection detector
    │   ├── vr.tsx        VR-on-a-phone compatibility
    │   └── intel.tsx     device + engine status
    ├── components/ui.tsx shared panel / row / chip / button
    ├── engines/          the 10 analysis engines (unmodified copies)
    ├── src/lib/          analyse.js, files.ts, store.ts
    ├── scripts/selftest.js
    ├── app.json  metro.config.js  babel.config.js  tsconfig.json  theme.ts
    └── package.json
```

## Why the port is small

The ten engines — `zip` `axml` `attrs` `dex` `smali` `cert` `elf` `vrscan`
`tamper` `binary` — were never web code. They are UMD modules that take a
`Uint8Array` and return structure, with **no DOM reference anywhere in them**, so
Metro loads them as ordinary CommonJS. They are copied in unchanged and the
selftest asserts they are still byte-identical to the Android/iOS/CLI copies.
One engine set, four hosts, no forks.

Only two things genuinely had to be written for React Native:

| Gap | Fix |
|---|---|
| No WebCrypto — `cert.js` needs SHA-256/SHA-1 for signer fingerprints | `engines/cryptoShim.js`, a plain-JS FIPS 180-4 implementation installed as `crypto.subtle.digest`. Verified against known-answer vectors and differentially against Node's `crypto`. A **global shim, not an engine edit**, so `cert.js` stays shared. |
| No file access | `src/lib/files.ts` — document picker → base64 → bytes, with its own base64 decoder (Hermes does not guarantee `atob`) |

`src/lib/analyse.js` deliberately imports nothing from React Native, so the whole
parsing half of the app runs under Node and is testable on a desktop.

## Verified

Everything below was actually run, on Windows, against real APKs:

```
26 passed, 0 failed        node scripts/selftest.js <file.apk>
tsc --noEmit               0 errors
expo export --platform android
                           bundled 1004 modules -> 2.78 MB Hermes bytecode
```

The export was checked to confirm the engines are really in the shipped bundle
(`APK Signature Scheme v3`, `libopenxr_loader`, `INJECTED`, `cryptoShim` … all
present in the `.hbc`).

End-to-end on real files:

| APK | Result |
|---|---|
| `J3NSONTOP-3.0.apk` (2.3 MB) | parsed in 39 ms · `REPACKED` (correct — that build is debug-signed) |
| a 57 MB Unity/OpenXR title | parsed in 415 ms · VR: OpenXR + Unity IL2CPP, 4 blockers · integrity `CLEAN` |

Fingerprints were confirmed identical with and without native WebCrypto, which
is what proves the shim is doing its job rather than silently returning null.

## Running it

```bash
npm install
cd mobile && npx expo start
```

```bash
npm run selftest --workspace mobile -- path/to/app.apk
npm run typecheck --workspace mobile
```

Installed and resolved to Expo 54.0.37 · React Native 0.81.4 · React 19.2.8 ·
Expo Router 6.0.24 — the stack RapidNative's handoff docs describe.

## Notes on the upload format

The import requirement is a *v3 monorepo containing `mobile/package.json`*, so
the zip is laid out that way: workspace root at top level, Expo app in `mobile/`.
Note this is **not** the shape RapidNative *exports* — the documented export is a
flat single-package project with `app/` and `package.json` at the root. Import
and export formats differ, so build to the one above for uploading.

One guess is flagged as such: the `"rapidnative": { "schema": 3, ... }` block in
the root `package.json`. The public docs do not define what marks a project as
"v3", so that field is a best guess at the marker. It is inert if ignored — the
structural requirement (`mobile/package.json`, workspaces) is what actually
matters, and that part is not a guess.

`node_modules/` is excluded from the zip; run `npm install` (or let the importer
do it). If a dependency version is rejected, `npx expo install --fix` inside
`mobile/` renormalises the whole set to the SDK.

## Scope

This app **reads**. It parses an APK and reports what is inside it — manifest,
dex, signers, native libraries, VR requirements, and whether the file shows the
fingerprints of a repack or an injected mod. It does not modify, repack, sign or
inject anything, and there is no network code in the analysis path at all.
