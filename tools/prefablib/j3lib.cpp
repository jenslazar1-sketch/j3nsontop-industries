/* J3NSONTOP INDUSTRIES - j3lib.cpp
 *
 * The standalone runtime around the prefab spawner. See j3lib.h for the API and
 * why it is shaped this way.
 *
 * Owns its own ImGui context and GLES3 backend, brand-styled to match the app.
 * Every public call brackets its work with SetCurrentContext so the library
 * plays nicely with a host that runs its own ImGui.
 */
#include "j3lib.h"
#include "imgui.h"
#include "backends/imgui_impl_opengl3.h"

#include <GLES3/gl3.h>
#include <string>
#include <cstdio>

namespace {

ImGuiContext* g_ctx     = nullptr;
bool          g_ready   = false;
float         g_density = 1.0f;
int           g_w = 0, g_h = 0;
bool          g_open = true;

bool  g_clear = false;
float g_clearCol[4] = { 0.02f, 0.027f, 0.039f, 1.0f };

int  g_demoTotal = 0;

/* Bracket helper: make our context current, restore the host's on the way out.
 * A host with no ImGui just has prev == nullptr, which restores cleanly. */
struct Scope {
    ImGuiContext* prev;
    Scope()  { prev = ImGui::GetCurrentContext(); if (g_ctx) ImGui::SetCurrentContext(g_ctx); }
    ~Scope() { ImGui::SetCurrentContext(prev); }
};

void applyBrandStyle(float density) {
    ImGuiStyle& s = ImGui::GetStyle();
    ImGui::StyleColorsDark();

    s.WindowRounding = 10.0f; s.FrameRounding = 8.0f; s.GrabRounding = 8.0f;
    s.ScrollbarRounding = 8.0f; s.WindowBorderSize = 1.0f; s.FrameBorderSize = 1.0f;
    s.WindowPadding = ImVec2(14, 14); s.FramePadding = ImVec2(12, 9); s.ItemSpacing = ImVec2(10, 10);

    ImVec4* c = s.Colors;
    const ImVec4 acid = ImVec4(0.486f, 1.0f, 0.0f, 1.0f);
    const ImVec4 ink  = ImVec4(0.020f, 0.027f, 0.039f, 0.96f);
    const ImVec4 panel= ImVec4(0.043f, 0.063f, 0.082f, 1.0f);
    c[ImGuiCol_WindowBg]=ink; c[ImGuiCol_ChildBg]=ImVec4(0.031f,0.047f,0.063f,1);
    c[ImGuiCol_PopupBg]=ink; c[ImGuiCol_Border]=ImVec4(0.486f,1,0,0.22f);
    c[ImGuiCol_FrameBg]=panel; c[ImGuiCol_FrameBgHovered]=ImVec4(0.486f,1,0,0.14f);
    c[ImGuiCol_FrameBgActive]=ImVec4(0.486f,1,0,0.24f);
    c[ImGuiCol_TitleBg]=panel; c[ImGuiCol_TitleBgActive]=ImVec4(0.486f,1,0,0.16f);
    c[ImGuiCol_Text]=ImVec4(0.914f,1,0.949f,1); c[ImGuiCol_TextDisabled]=ImVec4(0.557f,0.655f,0.604f,1);
    c[ImGuiCol_Button]=ImVec4(0.486f,1,0,0.12f); c[ImGuiCol_ButtonHovered]=ImVec4(0.486f,1,0,0.30f);
    c[ImGuiCol_ButtonActive]=acid; c[ImGuiCol_SliderGrab]=acid;
    c[ImGuiCol_SliderGrabActive]=ImVec4(1,0,0.659f,1); c[ImGuiCol_CheckMark]=acid;
    c[ImGuiCol_Header]=ImVec4(0.486f,1,0,0.16f); c[ImGuiCol_HeaderHovered]=ImVec4(0.486f,1,0,0.26f);
    c[ImGuiCol_HeaderActive]=ImVec4(0.486f,1,0,0.36f); c[ImGuiCol_Separator]=ImVec4(0.486f,1,0,0.22f);
    c[ImGuiCol_Tab]=ImVec4(0.043f,0.063f,0.082f,1); c[ImGuiCol_TabHovered]=ImVec4(0.486f,1,0,0.30f);
    c[ImGuiCol_TabSelected]=ImVec4(0.486f,1,0,0.20f); c[ImGuiCol_TabSelectedOverline]=acid;
    c[ImGuiCol_PlotLines]=acid; c[ImGuiCol_PlotHistogram]=ImVec4(0,0.898f,1,1);
    c[ImGuiCol_ResizeGrip]=ImVec4(0.486f,1,0,0.20f);

    s.ScaleAllSizes(density);
    s.FontScaleMain = density * 0.85f;
}

int demoSpawn(const char* /*id*/, const J3SpawnArgs* a, void* /*user*/) {
    g_demoTotal += (a && a->count > 0) ? a->count : 1;
    return 1;
}

const char* ABI() {
#if defined(__aarch64__)
    return "arm64-v8a";
#elif defined(__x86_64__)
    return "x86_64";
#elif defined(__arm__)
    return "armeabi-v7a";
#elif defined(__i386__)
    return "x86";
#else
    return "?";
#endif
}

} // namespace

extern "C" {

int j3lib_init(float density) {
    if (g_ready) return 1;

    ImGuiContext* prev = ImGui::GetCurrentContext();
    IMGUI_CHECKVERSION();
    g_ctx = ImGui::CreateContext();
    ImGui::SetCurrentContext(g_ctx);

    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;

    g_density = density > 0.5f ? density : 1.0f;
    applyBrandStyle(g_density);

    bool ok = ImGui_ImplOpenGL3_Init("#version 300 es");
    if (!ok) {
        ImGui::DestroyContext(g_ctx);
        g_ctx = nullptr;
        ImGui::SetCurrentContext(prev);
        return 0;
    }

    g_ready = true;
    ImGui::SetCurrentContext(prev);
    return 1;
}

void j3lib_resize(int width, int height) {
    g_w = width; g_h = height;
    if (!g_ready) return;
    Scope sc;
    ImGui::GetIO().DisplaySize = ImVec2((float)width, (float)height);
}

void j3lib_frame(float dt) {
    if (!g_ready || g_w <= 0 || g_h <= 0) return;
    Scope sc;

    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2((float)g_w, (float)g_h);
    io.DeltaTime = dt > 0.0f ? dt : 1.0f / 60.0f;

    ImGui_ImplOpenGL3_NewFrame();
    ImGui::NewFrame();

    if (g_open) {
        ImGui::SetNextWindowSize(ImVec2(io.DisplaySize.x * 0.9f, io.DisplaySize.y * 0.85f), ImGuiCond_FirstUseEver);
        ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.05f, io.DisplaySize.y * 0.07f), ImGuiCond_FirstUseEver);
        bool open = g_open;
        if (ImGui::Begin("J3 PREFAB SPAWNER", &open)) {
            j3_prefabs_draw_body();
        }
        ImGui::End();
        g_open = open;                        // the window's close box
    }

    ImGui::Render();

    glViewport(0, 0, g_w, g_h);
    if (g_clear) {
        glClearColor(g_clearCol[0], g_clearCol[1], g_clearCol[2], g_clearCol[3]);
        glClear(GL_COLOR_BUFFER_BIT);
    }
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}

void j3lib_touch(int action, float x, float y) {
    if (!g_ready) return;
    Scope sc;
    ImGuiIO& io = ImGui::GetIO();
    io.AddMousePosEvent(x, y);
    if (action == 0)      io.AddMouseButtonEvent(0, true);
    else if (action == 2) io.AddMouseButtonEvent(0, false);
}

void j3lib_set_open(int open) { g_open = open != 0; }
int  j3lib_is_open(void)      { return g_open ? 1 : 0; }

void j3lib_set_clear(int enable, float r, float g, float b, float a) {
    g_clear = enable != 0;
    g_clearCol[0] = r; g_clearCol[1] = g; g_clearCol[2] = b; g_clearCol[3] = a;
}

void j3lib_load_demo(void) {
    j3_prefabs_init();
    j3_prefabs_clear();
    uint32_t all  = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_DISTANCE)|(1<<J3_PARAM_SCALE)|(1<<J3_PARAM_YAW);
    uint32_t some = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_SCALE);
    uint32_t few  = (1<<J3_PARAM_COUNT);
    j3_prefabs_add("prop.crate",   "Wooden Crate", "Props",    "container box",  "#", some);
    j3_prefabs_add("prop.barrel",  "Barrel",       "Props",    "explosive",      "O", some);
    j3_prefabs_add("npc.drone",    "Scout Drone",  "NPCs",     "enemy flying",   "^", all);
    j3_prefabs_add("npc.turret",   "Turret",       "NPCs",     "enemy static",   "T", some);
    j3_prefabs_add("veh.buggy",    "Buggy",        "Vehicles", "car fast",       "=", all);
    j3_prefabs_add("veh.chopper",  "Chopper",      "Vehicles", "air fast",       "Y", all);
    j3_prefabs_add("fx.blast",     "Blast FX",     "Effects",  "particle boom",  "*", few);
    j3_prefabs_add("build.wall",   "Wall Segment", "Building", "structure",      "|", some);
    j3_prefabs_add("pickup.coin",  "Coin",         "Pickups",  "loot money",     "o", few);
    j3_prefabs_set_spawn_callback(demoSpawn, nullptr);
}

void j3lib_surface_lost(void) {
    if (!g_ready) return;
    Scope sc;
    ImGui_ImplOpenGL3_Shutdown();
    ImGui::DestroyContext(g_ctx);
    g_ctx = nullptr;
    g_ready = false;
}

void j3lib_shutdown(void) {
    if (!g_ready) return;
    ImGuiContext* prev = ImGui::GetCurrentContext();
    ImGui::SetCurrentContext(g_ctx);
    ImGui_ImplOpenGL3_Shutdown();
    ImGui::DestroyContext(g_ctx);
    g_ctx = nullptr;
    g_ready = false;
    if (prev != g_ctx) ImGui::SetCurrentContext(prev);
}

const char* j3lib_version(void) {
    static char buf[96];
    snprintf(buf, sizeof buf, "{\"imgui\":\"%s\",\"num\":%d,\"abi\":\"%s\"}",
             IMGUI_VERSION, IMGUI_VERSION_NUM, ABI());
    return buf;
}

} // extern "C"
