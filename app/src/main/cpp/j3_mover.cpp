/* J3NSONTOP INDUSTRIES - j3_mover.cpp
 *
 * Touch flight stick + look pad. See j3_mover.h for the contract.
 *
 * Drawn with InvisibleButton + IsItemActive rather than real widgets, because
 * a stick needs the drag to keep tracking after the finger leaves the circle,
 * which ImGui's normal hover-based items will not do.
 *
 * One caveat that is inherent rather than a bug: ImGui models a single mouse,
 * so only one pad can be active at a time. Whichever you grab first owns the
 * drag until you let go. Two-thumb simultaneous control would need real
 * multitouch plumbed through as separate pointers, which the backend this ships
 * with does not do.
 */
#include "j3_mover.h"
#include "imgui.h"

#include <cmath>

namespace {

J3MoveFn g_cb   = nullptr;
void*    g_user = nullptr;

float g_speed = 3.0f;
float g_look  = 0.25f;
bool  g_boost = false;
bool  g_invertY = false;

/* Latched vertical, so you can hold altitude without a finger on it. */
int   g_climb = 0;          // -1 down, 0 none, +1 up

const ImVec4 ACID = ImVec4(0.486f, 1.0f, 0.0f, 1.0f);
const ImVec4 DIM  = ImVec4(0.557f, 0.655f, 0.604f, 1.0f);

/* A round analog stick. Returns deflection in [-1,1] on each axis. */
ImVec2 stick(const char* id, float size, const char* label) {
    ImGui::PushID(id);
    ImVec2 p0 = ImGui::GetCursorScreenPos();
    ImGui::InvisibleButton("##pad", ImVec2(size, size));
    bool active = ImGui::IsItemActive();

    ImVec2 c = ImVec2(p0.x + size * 0.5f, p0.y + size * 0.5f);
    float r = size * 0.5f;

    ImVec2 v(0, 0);
    if (active) {
        ImVec2 m = ImGui::GetIO().MousePos;
        v = ImVec2(m.x - c.x, m.y - c.y);
        float len = sqrtf(v.x * v.x + v.y * v.y);
        if (len > r) { v.x = v.x / len * r; v.y = v.y / len * r; }   // clamp to the ring
        v.x /= r; v.y /= r;
    }

    ImDrawList* dl = ImGui::GetWindowDrawList();
    dl->AddCircleFilled(c, r, IM_COL32(8, 14, 20, 255));
    dl->AddCircle(c, r, active ? IM_COL32(124, 255, 0, 220) : IM_COL32(124, 255, 0, 70), 0, 2.0f);
    // cross-hairs so the neutral position reads at a glance
    dl->AddLine(ImVec2(c.x - r * 0.5f, c.y), ImVec2(c.x + r * 0.5f, c.y), IM_COL32(124, 255, 0, 40));
    dl->AddLine(ImVec2(c.x, c.y - r * 0.5f), ImVec2(c.x, c.y + r * 0.5f), IM_COL32(124, 255, 0, 40));
    dl->AddCircleFilled(ImVec2(c.x + v.x * r, c.y + v.y * r), r * 0.28f,
                        active ? IM_COL32(124, 255, 0, 255) : IM_COL32(124, 255, 0, 120));

    if (label) {
        ImVec2 ts = ImGui::CalcTextSize(label);
        dl->AddText(ImVec2(c.x - ts.x * 0.5f, p0.y + size + 2), IM_COL32(142, 167, 154, 255), label);
    }
    ImGui::PopID();
    return v;
}

} // namespace

extern "C" {

void j3_move_set_callback(J3MoveFn fn, void* user) { g_cb = fn; g_user = user; }
void  j3_move_set_speed(float s) { g_speed = s > 0 ? s : 0.1f; }
float j3_move_get_speed(void)    { return g_speed; }
void  j3_move_set_look_sensitivity(float d) { g_look = d > 0 ? d : 0.01f; }
void  j3_move_reset(void) { g_climb = 0; g_boost = false; }

void j3_move_draw_body(void) {
    if (!ImGui::GetCurrentContext()) return;
    ImGuiIO& io = ImGui::GetIO();
    float scale = ImGui::GetStyle().FontScaleMain;
    if (scale <= 0.0f) scale = 1.0f;

    ImGui::TextColored(ACID, "MOVEMENT");
    ImGui::SameLine();
    ImGui::TextDisabled("| deltas only - the host applies them");

    if (!g_cb) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1, 0.23f, 0.23f, 1));
        ImGui::TextWrapped("No host connected. Nothing moves until a game installs a movement callback.");
        ImGui::PopStyleColor();
    }

    float pad = 110.0f * scale;

    /* left: translate. right: look. */
    ImVec2 move = stick("move", pad, "MOVE");
    ImGui::SameLine(0, 24 * scale);
    ImVec2 look = stick("look", pad, "LOOK");

    ImGui::Dummy(ImVec2(0, 14 * scale));

    /* vertical is latched so altitude can be held without a finger */
    if (ImGui::Button(g_climb > 0 ? "[ UP ]" : "UP", ImVec2(pad * 0.72f, 42 * scale)))
        g_climb = (g_climb > 0) ? 0 : 1;
    ImGui::SameLine();
    if (ImGui::Button(g_climb < 0 ? "[ DOWN ]" : "DOWN", ImVec2(pad * 0.72f, 42 * scale)))
        g_climb = (g_climb < 0) ? 0 : -1;
    ImGui::SameLine();
    ImGui::Button("BOOST", ImVec2(pad * 0.72f, 42 * scale));
    g_boost = ImGui::IsItemActive();

    ImGui::SliderFloat("Speed", &g_speed, 0.2f, 20.0f, "%.1f u/s");
    ImGui::SliderFloat("Look", &g_look, 0.05f, 1.0f, "%.2f deg/px");
    ImGui::Checkbox("Invert Y", &g_invertY);
    if (ImGui::Button("Stop")) j3_move_reset();

    /* ---- build this frame's delta ---- */
    float dt = io.DeltaTime > 0 ? io.DeltaTime : 1.0f / 60.0f;
    float sp = g_speed * (g_boost ? 3.0f : 1.0f) * dt;

    J3MoveDelta d;
    d.dx = move.x * sp;
    d.dz = -move.y * sp;             // stick up = forward
    d.dy = (float)g_climb * sp;
    d.yaw   = look.x * g_look * 60.0f * dt * 60.0f * 0.016f;
    d.pitch = (g_invertY ? look.y : -look.y) * g_look * 60.0f * dt * 60.0f * 0.016f;
    d.boost = g_boost ? 1 : 0;

    bool moving = (fabsf(d.dx) + fabsf(d.dy) + fabsf(d.dz) +
                   fabsf(d.yaw) + fabsf(d.pitch)) > 1e-6f;

    ImGui::Spacing();
    if (moving) {
        ImGui::TextColored(ACID, "d %+.3f %+.3f %+.3f   look %+.2f %+.2f",
                           d.dx, d.dy, d.dz, d.yaw, d.pitch);
    } else {
        ImGui::TextColored(DIM, "idle");
    }

    if (moving && g_cb) g_cb(&d, g_user);
}

} // extern "C"
