/* J3NSONTOP INDUSTRIES - j3_prefabs.h
 *
 * The embeddable prefab-spawner panel: a Dear ImGui browser that lists prefabs
 * a host game registers, and spawns the one you pick by calling back into the
 * host. Engine-agnostic on purpose — it never reaches into a game itself.
 *
 * The contract is deliberately one-directional:
 *
 *     host  --register-->  panel        the game tells the panel what exists
 *     panel --spawn cb-->  host         the panel asks the game to spawn one
 *
 * The panel owns no game state and pokes no memory. It cannot spawn anything
 * the host has not registered, and it cannot spawn at all unless the host
 * installs a spawn callback. That is what keeps it a modding SDK rather than an
 * injector: it works with a game, through an interface the game opens, not
 * against one.
 *
 * A C ABI, so it embeds from C, C++, Unity (P/Invoke / DllImport), or anything
 * that can call a shared library.
 */
#ifndef J3_PREFABS_H
#define J3_PREFABS_H

#include <stdint.h>

/* Public API symbols get default visibility so they survive -fvisibility=hidden
 * and land in the shared object's export table. Defined outside the extern "C"
 * guard so a plain-C host sees it too. */
#ifndef J3_API
#  if defined(__GNUC__)
#    define J3_API __attribute__((visibility("default")))
#  else
#    define J3_API
#  endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* One tunable knob exposed on the spawn call. Keep it to the handful that
 * every engine understands; anything richer belongs in the host. */
typedef enum {
    J3_PARAM_COUNT    = 0,   /* how many to spawn (int)                     */
    J3_PARAM_DISTANCE = 1,   /* how far in front of the origin (float)      */
    J3_PARAM_SCALE    = 2,   /* uniform scale multiplier (float)            */
    J3_PARAM_YAW      = 3    /* facing, degrees (float)                     */
} J3ParamKind;

typedef struct {
    int   count;
    float distance;
    float scale;
    float yaw;
} J3SpawnArgs;

/* Called on the render thread when the user hits Spawn. `user` is whatever was
 * passed to j3_prefabs_set_spawn_callback. The host does the actual spawning;
 * returning nonzero marks it a success in the panel's log. */
typedef int (*J3SpawnFn)(const char* prefab_id, const J3SpawnArgs* args, void* user);

/* Optional: the host can hand the panel a live enumerator instead of pushing
 * prefabs one by one. The panel calls this when the user taps Rescan, and the
 * host calls j3_prefabs_add for each prefab it wants to expose. This is the
 * "scan for prefabs" path — the game decides what the scan turns up. */
typedef void (*J3ScanFn)(void* user);

/* ---- lifecycle -------------------------------------------------------- */

/* Safe to call before any prefab is registered. Idempotent. */
J3_API void j3_prefabs_init(void);
J3_API void j3_prefabs_shutdown(void);

/* ---- registration ----------------------------------------------------- */

/* Adds (or replaces, by id) one prefab. category/tags/glyph may be NULL.
 * `param_mask` is a bitfield of (1 << J3ParamKind) for the knobs that make
 * sense for this prefab — a decoration might allow only COUNT, a vehicle all
 * four. */
J3_API void j3_prefabs_add(const char* id, const char* name,
                    const char* category, const char* tags,
                    const char* glyph, uint32_t param_mask);

J3_API void j3_prefabs_clear(void);
J3_API int  j3_prefabs_count(void);

J3_API void j3_prefabs_set_spawn_callback(J3SpawnFn fn, void* user);
J3_API void j3_prefabs_set_scan_callback(J3ScanFn fn, void* user);

/* ---- drawing ---------------------------------------------------------- */

/* Draws the browser into the current ImGui frame. Call between NewFrame and
 * Render, exactly like any other ImGui window. Does nothing if ImGui has no
 * current context. */
J3_API void j3_prefabs_draw(void);

/* For hosts that already have their own window/tab: draws just the body with no
 * Begin/End of its own. */
J3_API void j3_prefabs_draw_body(void);

/* ---- telemetry (for the host, optional) ------------------------------- */

J3_API int         j3_prefabs_total_spawned(void);
J3_API const char* j3_prefabs_last_spawn(void);   /* prefab id, or "" */

#ifdef __cplusplus
}
#endif

#endif /* J3_PREFABS_H */
