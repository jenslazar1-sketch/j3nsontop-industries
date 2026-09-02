/* J3NSONTOP INDUSTRIES - j3_mover.h
 *
 * A touch flight-stick and look-pad for the ImGui panel: on-screen controls
 * that produce a movement delta each frame and hand it to the host.
 *
 * Same contract as the prefab spawner, for the same reason: this module owns
 * no transform and moves nothing itself. It reads touch, turns it into a
 * per-frame delta, and calls back. Whether that delta is applied to a debug
 * camera, a dev spectator rig, or nothing at all is entirely the host's
 * decision — the panel has no idea what a "player" is.
 *
 * Intended use is the flat-screen dev camera every engine has: something to fly
 * around your own scene with when you have no headset on, or when you are
 * building a level and want to look at it.
 *
 *     j3_move_set_callback(my_apply, game);
 *     ... each frame, inside your ImGui window:
 *     j3_move_draw_body();
 *
 * The callback fires once per frame while a control is held.
 */
#ifndef J3_MOVER_H
#define J3_MOVER_H

#include "j3_prefabs.h"   /* for J3_API */

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    /* Movement in the camera's local frame, already scaled by speed and
     * delta-time: right/up/forward metres for this frame. */
    float dx, dy, dz;
    /* Look delta in degrees for this frame. */
    float yaw, pitch;
    /* 1 while the boost control is held. */
    int   boost;
} J3MoveDelta;

/* Return nonzero if the host applied the delta. */
typedef int (*J3MoveFn)(const J3MoveDelta* delta, void* user);

J3_API void j3_move_set_callback(J3MoveFn fn, void* user);

/* Draws the sticks/buttons and emits a delta for this frame. Call inside an
 * ImGui window, between NewFrame and Render. */
J3_API void j3_move_draw_body(void);

/* Units per second at full stick deflection. Default 3.0. */
J3_API void  j3_move_set_speed(float units_per_second);
J3_API float j3_move_get_speed(void);

/* Degrees per screen-unit of drag on the look pad. Default 0.25. */
J3_API void  j3_move_set_look_sensitivity(float deg_per_px);

/* Zeroes any held input — call when the panel is hidden so a held stick does
 * not keep emitting. */
J3_API void j3_move_reset(void);

#ifdef __cplusplus
}
#endif

#endif /* J3_MOVER_H */
