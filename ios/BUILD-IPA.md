# Getting the .ipa

There is no `.ipa` in this repo, and it cannot be built on Windows — an `.ipa`
is a compiled iOS binary, and only Apple's `xcodebuild` (macOS-only) produces
one. Pick one of these:

## A. Free cloud Mac — no Mac, no Apple account (recommended)

1. Push this whole repo to GitHub.
2. Open the **Actions** tab. The **Build iOS IPA** workflow runs automatically
   (or press **Run workflow**).
3. When it's green, open the run and download the **J3NSONTOP-ipa** artifact.
   Inside is `J3NSONTOP-unsigned.ipa`.
4. Install it with **AltStore**, **SideStore**, or **Sideloadly** — they
   re-sign the unsigned `.ipa` with your own free Apple ID and install it. (Free
   Apple IDs expire the app after 7 days; refresh in the tool, or use a paid
   account for a year.)

The runner is a real Mac in the cloud (GitHub's `macos-14`). ~5 minutes.

## B. You have a Mac

```bash
brew install xcodegen
cd ios && xcodegen generate
open J3NSONTOP.xcodeproj      # Product > Archive > Distribute App -> .ipa
```
For the Simulator you need no signing — just Run.

## C. Signed .ipa straight from CI

Requires a paid or free Apple Developer account. Add your cert + provisioning
profile as repo secrets and switch the workflow to the signed path — the exact
steps are in the comment block at the bottom of
`.github/workflows/ios.yml`, using `ios/ExportOptions.plist`.

---
There is **no** legitimate way to compile this to an `.ipa` on Windows, and any
"iOS emulator / builder for Windows" is malware. Use A, B, or C.
