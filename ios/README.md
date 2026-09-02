# J3NSONTOP INDUSTRIES — iOS

The iOS build of the app. It reuses the **exact same web layer** as Android
(`../app/src/main/assets`), wrapped in a `WKWebView` host, so the toolbox, APK
Lab and the tamper detector all run unchanged.

> **This is a scaffold, not a compiled app.** It was written on Windows, where
> Apple's toolchain does not exist, so nothing here has been built or run. It is
> correct to the best of my knowledge and ready to open on a Mac — see
> *Building* below. If a line does not compile, it is a scaffold bug, not a
> design one; the web layer it hosts is the same code already proven on Android.

## What ports, and what doesn't

The app is a WebView over standard web APIs, so most of it is already an iOS
app the moment it loads:

| Section | iOS | Notes |
|---|---|---|
| Arsenal | ✅ | pure web |
| Toolbox (20 tools) | ✅ | `crypto.subtle` works — see *Secure context* |
| APK Lab | ✅ | all parsing is JS; open files via the share sheet / Files |
| Integrity (tamper) | ✅ | same engine |
| Intel | ✅ | device facts adjust to iOS |
| **Scanner** | ❌ | needs the installed-app list; iOS sandboxes that away entirely. Hidden by the host. |
| **Native console / prefab lib** | ❌ | that is Android JNI + GLES. The iOS equivalent is a separate Metal port (below). |

The native surface the sandbox *can* do — saving a file, sharing, opening a
link, receiving a shared APK — is bridged in `WebViewController.swift`. The
shared `core.js` routes to it only when the iOS host is present (`window.webkit
.messageHandlers.j3`), so Android and the browser are byte-for-byte unaffected.

## Secure context

A `file://` page is not a secure context, so `crypto.subtle` — every hash and
certificate fingerprint in the app — would be missing, exactly as on Android.
The fix is the same: the host runs a tiny **GCDWebServer bound to
`127.0.0.1`** and loads `http://localhost:<port>/`. Loopback is a secure
context in WebKit, so WebCrypto is available and no byte ever leaves the device.

## Building (on a Mac)

```bash
brew install xcodegen          # once
cd ios
xcodegen generate              # project.yml -> J3NSONTOP.xcodeproj
open J3NSONTOP.xcodeproj
```

In Xcode: pick your team under *Signing & Capabilities*, then **Product ▸
Archive ▸ Distribute App** to produce the `.ipa`. For the Simulator you need no
team — just Run.

**No Mac?** The same project builds unattended on a **macOS CI runner**
(GitHub Actions `macos-14`, or a hosted Mac from MacStadium / AWS EC2 Mac).
A minimal CI step: `xcodegen generate` → `xcodebuild -scheme J3NSONTOP archive`
→ `xcodebuild -exportArchive`. There is **no iOS emulator for Windows** — the
Simulator is macOS-only, and anything advertised as an "iOS emulator for
Windows" is malware. Use a Mac, a cloud Mac, or a real device.

## Files

```
ios/
  project.yml                 XcodeGen config (the whole project, as text)
  App/
    AppDelegate.swift         app entry
    SceneDelegate.swift       builds the window, routes shared files in
    WebViewController.swift   WKWebView host, loopback server, native bridge
    Info.plist               scene manifest, document types, ATS localhost
  (www is ../app/src/main/assets, bundled at build time — one shared copy)
```

## The library on iOS

`libj3prefab` (the ImGui prefab spawner + movement panel) is portable C++, so
it can become an iOS **framework you link into your own app** — the compile-in
path, the same as Android's `jniLibs`. One real change is required: the GLES3
backend (`imgui_impl_opengl3`) has to be swapped for **`imgui_impl_metal`**
(Objective-C++), because iOS dropped OpenGL ES for Metal. That is a genuine
port and needs a Mac to build and test, so it is not included here — ask and
it is a clean next step.

What is **not** on the table is a Cydia/Substrate **`.deb` tweak**. A tweak's
whole purpose is to hook and inject into *other* apps on a jailbroken device —
the iOS twin of the APK injector this project does not build. The framework
above is for your own app; the tweak is not something I will produce.
