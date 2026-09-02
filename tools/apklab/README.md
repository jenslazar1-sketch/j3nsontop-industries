# APK LAB — command line

The desktop half of the APK lab that ships inside the app.

It runs on the **same engine** as the Android build — `apklab.js` requires
straight out of `app/src/main/assets/js/`. There is one AXML decoder, one dex
reader and one zip writer in this project, not two that quietly drift apart.
Running `apklab selftest` is therefore also the regression test for what the
phone is doing.

What the desktop adds over the phone: **signing and verification**, which need
a keystore and the Android SDK build-tools.

## Requirements

| Need                     | Why                                        |
|--------------------------|--------------------------------------------|
| Node 18+                 | runs the engine                            |
| Android SDK build-tools  | `apksigner`, `zipalign`, only for sign/verify |
| jadx *(optional)*        | bytecode → Java, for `apklab jadx`         |

The SDK is found automatically from `local.properties`, `ANDROID_HOME`,
`ANDROID_SDK_ROOT`, or the default install path. Nothing to configure if you
have ever opened this project in Android Studio.

## Commands

```
apklab info    <apk>                      identity, permissions, certs, code
apklab decode  <apk> [-o dir]             unpack + readable manifest/resources/classes
apklab build   <dir> [-o apk]             repack a decoded folder, zipalign-correct
apklab patch   <apk> [options] [-o apk]   rewrite the manifest without unpacking
apklab sign    <apk> [--ks ...]           zipalign + apksigner
apklab verify  <apk>                      alignment, signature, CRCs, arsc placement
apklab strings <apk>                      URLs, hosts, secrets from the dex pools
apklab diff    <a.apk> <b.apk>            what changed between two builds
apklab jadx    <apk>                      hand off to jadx for Java source
apklab selftest                           verify the engine against a real APK
```

On Windows use `apklab.cmd`; on macOS/Linux `./apklab`. Both just call
`node apklab.js`.

## The two ways to change an APK

**`patch`** — for manifest-only edits. Nothing is unpacked, so every other
entry is copied through as raw compressed bytes and nothing can go wrong with
them.

```bash
apklab patch app.apk --label "NEW NAME" --version-code 12 --debuggable off \
                     --add-perm android.permission.INTERNET -o new.apk
apklab sign new.apk
```

**`decode` → edit → `build`** — for changing actual files.

```bash
apklab decode app.apk -o work/
#   edit work/assets/..., work/res/..., whatever
apklab build work/ -o new.apk
apklab sign  new.apk
apklab verify new.apk
```

`decode` also drops three read-only companions next to the real files:

- `AndroidManifest.decoded.xml` — the binary manifest as readable XML
- `resources.decoded.txt` — every resource id, name and string value
- `classes*.dex.txt` — every class, field and method signature

`build` skips those, so you can leave them where they are.

## Signing

Both `patch` and `build` **strip the signature**, because any change voids it.
An unsigned APK will not install.

`apklab sign` defaults to the standard Android debug key — fine for
side-loading, not for the Play Store. For a real key:

```bash
keytool -genkeypair -v -keystore my.jks -alias mykey \
        -keyalg RSA -keysize 2048 -validity 10000

apklab sign new.apk --ks my.jks --ks-pass "$PASS" --alias mykey
```

Keep that `.jks` and its password forever. Every future update of the same app
has to be signed with the same key or Android refuses to install it over the
top.

## What it does not do

**Bytecode → Java.** That is [jadx](https://github.com/skylot/jadx), and it is
a big, good tool that would be silly to reimplement badly. `apklab jadx` hands
off to it when it is on PATH. What this project gives you instead is
structure — classes, methods, fields, and every string constant — which is
enough for most "what does this thing actually do" questions and is what can
realistically also run on a phone.

**Repackage native code.** `.so` files are copied through byte for byte,
stored and 4096-aligned as the platform requires, but nothing reads them.

**Verify signatures cryptographically.** `apklab info` *reads* the certificate;
`apklab verify` shells out to `apksigner` to actually check the maths.

## Why the zip writer is custom

Since targetSdk 30 the platform mmaps `resources.arsc` directly out of the APK.
That entry has to be **stored, not deflated, and 4-byte aligned**, and native
libraries want 4096-byte alignment. A generic zip library gets this wrong and
produces an APK that looks perfectly fine and then fails to install with an
error nobody can read.

`zip.js` does the alignment itself, using the same `0xd935` padding extra-field
that `zipalign` uses. `apklab verify` checks it, and so does Google's own
`zipalign -c`.