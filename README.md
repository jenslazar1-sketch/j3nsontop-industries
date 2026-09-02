# J3NSONTOP INDUSTRIES — Android

The whole J3NSONTOP operation as one Android app: the arsenal of sites and
builds, **16 offline tools**, and an **on-device APK lab** that decompiles,
inspects, edits and repacks APKs without a network connection.

```
app/src/main/assets/     the entire UI and every engine (this is the app)
app/src/main/java/       ~450 lines of Android host, no dependencies
tools/apklab/            the desktop CLI, sharing the same engine
```

## Build it

**Android Studio** — `File ▸ Open…` and pick this folder (not "Import"). Let
Gradle sync once with the network on, then `Build ▸ Build APK(s)`.

**Command line**

```bash
gradlew.bat assembleDebug          # app/build/outputs/apk/debug/J3NSONTOP-2.0-debug.apk
gradlew.bat assembleRelease        # app/build/outputs/apk/release/J3NSONTOP-2.0.apk
```

Both come out **signed and installable**. The release APK is minified,
resource-shrunk, and signed with the standard Android debug key so it
side-loads straight away. For a Play Store upload, pass your own key:

```bash
gradlew.bat assembleRelease -PJ3_KEYSTORE=C:/keys/j3.jks -PJ3_KEYSTORE_PASS=... \
                            -PJ3_KEY_ALIAS=j3 -PJ3_KEY_PASS=...
```

Version bumps live in `app/build.gradle` — `versionCode` has to go **up** for
any update, side-loaded or not.

## What is in it

### Arsenal
The catalogue — live sites, hosted tools, builds, crew — now searchable and
filterable instead of one long scroll. Tapping a card opens it in the phone's
browser.

### Toolbox — 16 tools, all offline
Text Destroyer · Banner Forge · Hash Lab · Encoder · JSON Lab · Password Forge ·
ID Forge · Unit Converter · Epoch Lab · Color Lab · Regex Lab · Diff Lab ·
Text Stats · Base Converter · File Inspector · Cipher Deck

Everything runs on the device. Nothing is uploaded anywhere — which is the
point, because the things people reach for these tools with (tokens, dumps,
passwords) are exactly the things that should not be pasted into a stranger's
website.

### APK Lab
Open any `.apk`, `.aab`, `.jar` or `.zip` — tap to pick one, or share one to
J3NSONTOP from any file manager.

- **Decompile** — binary `AndroidManifest.xml` back to readable XML, with
  `resources.arsc` resolved so `@string/app_name` shows the real name
- **Inspect** — every class, method, field and string constant in each dex
- **Verify** — signing certificate, SHA-256/SHA-1 fingerprints, which schemes
- **Scan** — debuggable flags, sensitive permissions, exported components
- **Edit** — label, version, flags, permissions; replace or delete any file
- **Recompile** — repacked, zipalign-correct, saved to Downloads

The repacked APK is **unsigned** — changing anything voids the old signature
and signing needs a keystore the phone does not have. Sign it with the desktop
toolkit (below). The app says so rather than handing you a file that fails at
install time.

## The desktop toolkit

```bash
node tools/apklab/apklab.js info    app.apk
node tools/apklab/apklab.js patch   app.apk --label "NEW" --version-code 7 -o new.apk
node tools/apklab/apklab.js sign    new.apk
node tools/apklab/apklab.js verify  new.apk
node tools/apklab/apklab.js selftest
```

Full documentation: [tools/apklab/README.md](tools/apklab/README.md).

It requires `apklab.js` straight out of the app's asset folder, so the phone
and the desktop run **the same** AXML decoder, dex reader and zip writer.
`apklab selftest` checks that engine against a real built APK — 17 assertions
covering both inflate paths, the CRC32 vector, the attribute table, the AXML
re-encode round trip and the zipalign placement.

## Notable about v2

**No INTERNET permission.** The app asks for `VIBRATE` and nothing else. Every
byte ships inside the APK and the toolbox runs entirely on-device, so the
WebView has nothing to fetch; real links go to the system browser through an
intent, which needs no permission. The app literally cannot phone home.

**No dependencies.** v1 pulled in `androidx.appcompat` for `AppCompatActivity`
and the back dispatcher, which cost ~3 MB and dragged the Kotlin stdlib along
with it (the old "Duplicate class kotlin.*" fight). v2 runs on framework
classes alone.

```
v1 debug APK   3,239,500 bytes
v2 debug APK     175,454 bytes      ~95% smaller, and it does far more
```

**Served from `https://app.j3nsontop.local`, not `file://`.** A `file://` page
is not a secure context, so `crypto.subtle` — every SHA hash and certificate
fingerprint in the app — simply does not exist there. `LocalServer.java` maps
that virtual origin onto the asset folder, which hands the page real WebCrypto
while keeping every byte local. It also streams files handed over by other apps
at `/__file/<id>`, so a 200 MB APK never has to cross the JS bridge as base64.

**Fonts are system stacks.** v1 loaded Anton from Google Fonts, which meant an
"offline" app showing unstyled headings until the network answered.
`sans-serif-condensed` is Roboto Condensed on every Android device.

## Changing things

| What | Where |
|---|---|
| Sites, tools, crew | `app/src/main/assets/js/arsenal.js` — the arrays at the top |
| Add a toolbox tool | `app/src/main/assets/js/toolbox.js` — append one object to `TOOLS` |
| Styling | `app/src/main/assets/css/app.css` |
| Launcher icon | `app/src/main/res/mipmap-*/ic_launcher.png` |
| App name | `app/src/main/res/values/strings.xml` |
| Package id | `app/build.gradle` **and** the `java/` folder name |

The engines (`binary` `zip` `axml` `attrs` `dex` `cert`) are plain UMD modules
with no framework — they load in the WebView and under Node unchanged.

`attrs.js` is generated, not hand-written: 1,521 `android:*` attribute ids
pulled out of `android.jar` with `javap`. It is what lets a hardened APK whose
manifest has had its attribute-name strings blanked still decode as
`android:name` instead of `attr0x01010003`.

## Troubleshooting

**"SDK location not found"** — Android Studio writes `local.properties` on
first open. If it did not: `File ▸ Project Structure ▸ SDK Location`.

**Gradle sync stuck / offline** — `File ▸ Settings ▸ Build, Execution,
Deployment ▸ Gradle` and untick "Offline work". The first sync needs the
network for Gradle 8.7 and AGP 8.6.1.

**`assembleRelease` fails on `lintVitalAnalyzeRelease` when offline** — the
lint artifact is not in the local cache. Build release once with the network
on, or add `lint { checkReleaseBuilds false }` to `app/build.gradle`.

**"Duplicate class kotlin.*"** — cannot happen here any more; v2 has no
dependencies at all. In *another* project it means two Kotlin stdlib versions:
add `implementation platform('org.jetbrains.kotlin:kotlin-bom:1.9.24')`.

**Stale build** — `gradlew.bat clean`, then build again.