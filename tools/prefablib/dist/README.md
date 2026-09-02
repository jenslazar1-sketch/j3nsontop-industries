# libj3prefab.so — drop-in prefab spawner

Dear ImGui + the J3 prefab spawner, in one self-contained shared library with a
plain C API and no JNI. Drop it into your APK and drive it from your game.

```
lib/
  arm64-v8a/libj3prefab.so     phones and tablets (64-bit ARM)
  armeabi-v7a/libj3prefab.so   older 32-bit ARM
  x86_64/libj3prefab.so        emulators, Chromebooks
j3lib.h                        the runtime API you call
j3_prefabs.h                   the registry + spawn-callback API
```

**Verified**: each `.so` loads on-device, its C API resolves via `dlsym`, and
the registry runs natively (see the emulator test in the build notes). The
render path is the same ImGui code that ships in the J3NSONTOP app's native
console, verified rendering and spawning on a real Android 16 device.

**Scope**: a modding SDK for a game you own or a single-player game you're
modding for yourself — same category as an in-editor object palette. It spawns
prefabs *you* register through a callback *you* write. It has no hooks, no
memory scanner, and no way to attach to a process. It is not, and won't become,
an injector for gaining an advantage over other players online.

## Put it in an APK

Native libraries live under `lib/<abi>/` inside the APK. If you build the APK:

- **Gradle / Android Studio**: drop the `lib/<abi>/*.so` under
  `src/main/jniLibs/`, so `src/main/jniLibs/arm64-v8a/libj3prefab.so`, etc.
- **Unity**: put each `.so` under `Assets/Plugins/Android/libs/<abi>/`.
- **Repacking an existing APK** (with the J3 APK Lab / apktool): add the files
  as `lib/<abi>/libj3prefab.so`, then rebuild, **zipalign** and **re-sign** —
  a changed APK must be signed again or it won't install.

Ship at least the ABI(s) your game targets. arm64-v8a covers essentially all
real phones; add armeabi-v7a only if your game is still 32-bit.

### Getting it actually loaded (Unity, smali)

Dropping the `.so` into `lib/` only ships it — nothing loads it. In a Unity APK
the usual hook is the player activity's `onCreate`:

```
smali/com/unity3d/player/UnityPlayerActivity.smali
```

Insert straight after the `.locals` line:

```smali
.method protected onCreate(Landroid/os/Bundle;)V
    .locals 2

    const-string v0, "j3prefab"

    invoke-static {v0}, Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V

    # ... original body follows unchanged
```

Four things that bite people here:

1. **The name has no `lib` and no `.so`.** `System.loadLibrary("j3prefab")`
   resolves to `libj3prefab.so`. Passing `"libj3prefab"` makes it look for
   `liblibj3prefab.so` and throws `UnsatisfiedLinkError` at launch. This is the
   single most common mistake.
2. **Check `.locals`.** Using `v0` needs `.locals 1` or higher. If the method
   says `.locals 0`, bump it. Inserting at the very top is safe because no local
   register is live yet — parameters live in `p0`/`p1`, which are separate.
3. **Newer Unity renamed the class.** Unity 2023+/6 often uses
   `UnityPlayerGameActivity.smali` (or a custom activity). Check
   `AndroidManifest.xml` for the real launcher activity rather than assuming.
4. **`extractNativeLibs="false"`** (the default on modern builds) means the
   `.so` is mmapped straight out of the APK, so it must be **stored uncompressed
   and 4096-byte aligned** or the app crashes on load. `zipalign -p 4` handles
   it; so does the J3 zip writer, and `apklab verify` will tell you.

`apklab info <apk>` shows the launcher activity and whether
`extractNativeLibs` is set, which covers points 3 and 4 before you start.

## Load and drive it

The library owns its own ImGui context and GLES3 backend. You give it a GLES3
context, a size, a per-frame tick, and touch events.

```c
#include "j3lib.h"

// once, on the GL thread, after your GL context exists
j3lib_init(displayDensity);          // ~2.6 on a phone; 1.0 if unsure

// register what your game can spawn (or call j3lib_load_demo() to try it out)
j3_prefabs_add("enemy.grunt", "Grunt", "Enemies", "melee", "G",
               (1u<<J3_PARAM_COUNT) | (1u<<J3_PARAM_DISTANCE));

// tell it how to spawn — YOUR code, the only thing that knows your engine
int my_spawn(const char* id, const J3SpawnArgs* a, void* user) {
    for (int i = 0; i < a->count; i++)
        MyGameSpawn(id, a->distance, a->scale, a->yaw);   // your call
    return 1;
}
j3_prefabs_set_spawn_callback(my_spawn, myGame);

// every frame, after you draw your scene, before the buffer swap
j3lib_resize(width, height);
j3lib_frame(dtSeconds);

// on each touch event
j3lib_touch(action, x, y);           // action: 0 down, 1 move, 2 up

// toggle the menu from a button
j3lib_set_open(!j3lib_is_open());

// teardown
j3lib_shutdown();
```

If nothing else is drawing the surface (a standalone menu rather than an
overlay), turn on clearing: `j3lib_set_clear(1, 0.02f, 0.03f, 0.04f, 1.0f);`.

## Loading it without a header (dlopen)

Any language that can `dlopen`/`dlsym` can use it — no header needed, just the
symbol names:

```c
void* h = dlopen("libj3prefab.so", RTLD_NOW);
int (*init)(float)   = dlsym(h, "j3lib_init");
void (*frame)(float) = dlsym(h, "j3lib_frame");
// ... and the rest of the j3lib_* / j3_prefabs_* names
```

The full exported set: `j3lib_init j3lib_resize j3lib_frame j3lib_touch
j3lib_set_open j3lib_is_open j3lib_set_clear j3lib_load_demo j3lib_surface_lost
j3lib_shutdown j3lib_version` and `j3_prefabs_init j3_prefabs_add
j3_prefabs_clear j3_prefabs_count j3_prefabs_set_spawn_callback
j3_prefabs_set_scan_callback j3_prefabs_draw j3_prefabs_draw_body
j3_prefabs_total_spawned j3_prefabs_last_spawn`. Nothing else is exported —
every ImGui internal is hidden, so it can't clash with a host that links its own
ImGui.

## From Unity (C# / P/Invoke)

```csharp
const string L = "j3prefab";
[DllImport(L)] static extern int  j3lib_init(float density);
[DllImport(L)] static extern void j3lib_frame(float dt);
[DllImport(L)] static extern void j3lib_touch(int action, float x, float y);
[DllImport(L)] static extern void j3_prefabs_add(
    string id, string name, string cat, string tags, string glyph, uint mask);

[StructLayout(LayoutKind.Sequential)]
struct J3SpawnArgs { public int count; public float distance, scale, yaw; }
delegate int SpawnFn(string id, ref J3SpawnArgs a, IntPtr user);
[DllImport(L)] static extern void j3_prefabs_set_spawn_callback(SpawnFn fn, IntPtr user);
```

Your `SpawnFn` calls `Instantiate(...)` for a prefab you own — ordinary Unity
modding of your own project. Note Unity drives its own GL/Vulkan; the simplest
path is a low-level native plugin render event, or use `j3_prefabs_draw_body`
inside your own ImGui integration instead of the whole `j3lib_frame`.

## Rebuild from source

```bash
cd tools/prefablib
ANDROID_NDK=/path/to/ndk bash build.sh        # writes dist/lib/<abi>/libj3prefab.so
```

Needs the Android NDK and CMake. It reuses the vendored Dear ImGui and the
shared `j3_prefabs.cpp`, so the drop-in library and the in-app panel never
diverge.
