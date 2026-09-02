/* J3NSONTOP INDUSTRIES - j3lib.h
 *
 * The standalone drop-in: Dear ImGui + the prefab spawner, compiled into one
 * self-contained libj3prefab.so with a plain C API and no JNI. Drop it into an
 * APK's lib/<abi>/ and drive it from your game.
 *
 * The library OWNS its own ImGui context and the GLES3 backend. You give it a
 * GLES3 context, a size, a per-frame tick, and touch events; it draws the
 * spawner as an overlay on top of whatever you already rendered. It coexists
 * with a host that has its own ImGui — every entry point saves and restores the
 * current context around its work.
 *
 * Scope, same as the panel it wraps: a modding SDK for a game you own or a
 * single-player game you're modding for yourself. It registers prefabs YOU
 * declare and spawns them through a callback YOU write. It has no hooks, no
 * memory scanner, and no way to attach to a process. See PREFABS.md.
 *
 * Minimal integration:
 *
 *     j3lib_init(density);                       // once, on the GL thread
 *     j3_prefabs_add("enemy.grunt", "Grunt", "Enemies", 0, "G", 3);
 *     j3_prefabs_set_spawn_callback(my_spawn, game);
 *     ... every frame, after you draw your scene:
 *     j3lib_resize(w, h);
 *     j3lib_frame(dt);
 *     ... on each touch:  j3lib_touch(action, x, y);
 *     j3lib_shutdown();                          // on teardown
 *
 * The prefab registry API (j3_prefabs_*) lives in j3_prefabs.h and is exported
 * from this same library.
 */
#ifndef J3LIB_H
#define J3LIB_H

#include "j3_prefabs.h"   /* the registry + spawn-callback API (also defines J3_API) */

#ifdef __cplusplus
extern "C" {
#endif

/* Creates the ImGui context and the GLES3 backend. `density` scales the UI for
 * the screen (e.g. the display's logical density, ~2.6 on a modern phone; pass
 * 1.0 if unsure). Returns 1 on success, 0 if the GL backend failed. Idempotent. */
J3_API int  j3lib_init(float density);

/* The drawable size in pixels. Call whenever the surface changes. */
J3_API void j3lib_resize(int width, int height);

/* One frame. Call between your own scene render and buffer swap, on the GL
 * thread, with the seconds elapsed since the last call. Renders the spawner
 * overlay; does not clear the framebuffer (see j3lib_set_clear). */
J3_API void j3lib_frame(float dt_seconds);

/* Feed input. action: 0 = down, 1 = move, 2 = up. Coordinates in pixels, same
 * space as j3lib_resize. One finger drives the ImGui cursor. */
J3_API void j3lib_touch(int action, float x, float y);

/* Show / hide the spawner window. Wire this to your menu button. */
J3_API void j3lib_set_open(int open);
J3_API int  j3lib_is_open(void);

/* By default the library overlays (no clear), assuming your game already drew
 * the frame. Enable this only when the library owns the whole surface. */
J3_API void j3lib_set_clear(int enable, float r, float g, float b, float a);

/* Populates the registry with a sample set and installs an internal spawn
 * callback that just logs, so the library visibly works before you wire in your
 * own prefabs. Call your own j3_prefabs_set_spawn_callback afterwards to take
 * over. Purely for bring-up. */
J3_API void j3lib_load_demo(void);

/* The GL context was lost (pause/resume). Drops the backend's device objects
 * without touching now-invalid GL state; j3lib_init rebuilds them. */
J3_API void j3lib_surface_lost(void);

/* Tears down the backend and the ImGui context. */
J3_API void j3lib_shutdown(void);

/* {"imgui":"1.93.0 WIP","num":19294,"abi":"arm64-v8a"} */
J3_API const char* j3lib_version(void);

#ifdef __cplusplus
}
#endif

#endif /* J3LIB_H */
