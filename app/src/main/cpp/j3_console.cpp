/* J3NSONTOP INDUSTRIES - j3_console.cpp
 *
 * The native console: Dear ImGui drawn straight onto a GLSurfaceView through
 * GLES3, sitting alongside the WebView rather than inside it.
 *
 * There is no imgui_impl_android here on purpose. That backend is written for
 * NativeActivity and reads AInputEvent, but this app is a normal Activity with
 * a GLSurfaceView, so touches arrive in Java. Feeding them in by hand through
 * AddMousePosEvent/AddMouseButtonEvent is about ten lines and avoids dragging
 * the whole native-glue lifecycle into an app that does not need it.
 */
#include <jni.h>
#include <android/log.h>
#include <GLES3/gl3.h>
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <string>
#include <vector>

#include "imgui.h"
#include "backends/imgui_impl_opengl3.h"
#include "j3_prefabs.h"
#include "j3_prefabs.h"
#include "j3_prefabs.h"
#include "j3_prefabs.h"
#include "j3_prefabs.h"
#include "j3_prefabs.h"
#include "j3_prefabs.h"
#include "j3_prefabs.h"

#define LOG_TAG "J3Console"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

bool  g_ready      = false;
float g_density    = 3.0f;
int   g_width      = 0, g_height = 0;
std::string g_info = "";

// live plots
float g_fps[120]   = {0};
int   g_fpsAt      = 0;
float g_frameMs[120] = {0};
int   g_frameAt    = 0;

// toys
float g_destruction = 66.0f;
float g_glitch      = 0.35f;
bool  g_showDemo    = false;
bool  g_scanlines   = true;
int   g_target      = 0;
float g_accent[3]   = { 0.486f, 1.0f, 0.0f };   // #7CFF00
char  g_payload[128] = "J3NSONTOP";
double g_uptime     = 0.0;

/* The console has no game behind it, so it plays the part of the host: it
 * registers a sample set of prefabs and installs a spawn callback that just
 * drops a token into a little scratch scene. In a real embed the host does
 * exactly this — registers its own prefabs and spawns for real. */
struct SceneToken { float x, y, r; ImU32 col; float born; };
std::vector<SceneToken> g_scene;

int demoSpawn(const char* id, const J3SpawnArgs* args, void* /*user*/) {
    ImU32 col = IM_COL32(124, 255, 0, 255);
    if (strstr(id, "cyan")) col = IM_COL32(0, 229, 255, 255);
    else if (strstr(id, "mag")) col = IM_COL32(255, 0, 168, 255);
    else if (strstr(id, "amber")) col = IM_COL32(255, 196, 0, 255);
    int n = args && args->count > 0 ? args->count : 1;
    if (n > 50) n = 50;
    for (int i = 0; i < n; i++) {
        SceneToken t;
        t.x = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.y = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.r = (args ? args->scale : 1.0f) * (6.0f + rand() % 8);
        t.col = col;
        t.born = (float)g_uptime;
        g_scene.push_back(t);
    }
    if (g_scene.size() > 400) g_scene.erase(g_scene.begin(), g_scene.begin() + (g_scene.size() - 400));
    return 1;   // success
}

void registerDemoPrefabs() {
    j3_prefabs_clear();
    uint32_t all  = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_DISTANCE)|(1<<J3_PARAM_SCALE)|(1<<J3_PARAM_YAW);
    uint32_t some = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_SCALE);
    uint32_t few  = (1<<J3_PARAM_COUNT);
    j3_prefabs_add("prop.crate",       "Wooden Crate",   "Props",     "container box loot", "#", some);
    j3_prefabs_add("prop.barrel",      "Barrel",         "Props",     "container explosive","O", some);
    j3_prefabs_add("prop.amber.torch", "Torch",          "Props",     "light fire amber",   "!", few);
    j3_prefabs_add("npc.cyan.drone",   "Scout Drone",    "NPCs",      "enemy flying cyan",  "^", all);
    j3_prefabs_add("npc.turret",       "Turret",         "NPCs",      "enemy static",       "T", some);
    j3_prefabs_add("veh.buggy",        "Buggy",          "Vehicles",  "car fast",           "=", all);
    j3_prefabs_add("veh.mag.chopper",  "Chopper",        "Vehicles",  "air fast mag",       "Y", all);
    j3_prefabs_add("fx.mag.blast",     "Blast FX",       "Effects",   "particle mag boom",  "*", few);
    j3_prefabs_add("fx.cyan.portal",   "Portal FX",      "Effects",   "particle cyan",      "0", few);
    j3_prefabs_add("build.wall",       "Wall Segment",   "Building",  "structure",          "|", some);
    j3_prefabs_add("build.ramp",       "Ramp",           "Building",  "structure",          "/", some);
    j3_prefabs_add("pickup.amber.coin","Coin",           "Pickups",   "loot amber money",   "o", few);
    j3_prefabs_set_spawn_callback(demoSpawn, nullptr);
    j3_prefabs_set_scan_callback([](void*){ registerDemoPrefabs(); }, nullptr);
}

/* The console has no game behind it, so it plays the part of the host: it
 * registers a sample set of prefabs and installs a spawn callback that just
 * drops a token into a little scratch scene. In a real embed the host does
 * exactly this — registers its own prefabs and spawns for real. */
struct SceneToken { float x, y, r; ImU32 col; float born; };
std::vector<SceneToken> g_scene;

int demoSpawn(const char* id, const J3SpawnArgs* args, void* /*user*/) {
    ImU32 col = IM_COL32(124, 255, 0, 255);
    if (strstr(id, "cyan")) col = IM_COL32(0, 229, 255, 255);
    else if (strstr(id, "mag")) col = IM_COL32(255, 0, 168, 255);
    else if (strstr(id, "amber")) col = IM_COL32(255, 196, 0, 255);
    int n = args && args->count > 0 ? args->count : 1;
    if (n > 50) n = 50;
    for (int i = 0; i < n; i++) {
        SceneToken t;
        t.x = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.y = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.r = (args ? args->scale : 1.0f) * (6.0f + rand() % 8);
        t.col = col;
        t.born = (float)g_uptime;
        g_scene.push_back(t);
    }
    if (g_scene.size() > 400) g_scene.erase(g_scene.begin(), g_scene.begin() + (g_scene.size() - 400));
    return 1;   // success
}

void registerDemoPrefabs() {
    j3_prefabs_clear();
    uint32_t all  = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_DISTANCE)|(1<<J3_PARAM_SCALE)|(1<<J3_PARAM_YAW);
    uint32_t some = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_SCALE);
    uint32_t few  = (1<<J3_PARAM_COUNT);
    j3_prefabs_add("prop.crate",       "Wooden Crate",   "Props",     "container box loot", "#", some);
    j3_prefabs_add("prop.barrel",      "Barrel",         "Props",     "container explosive","O", some);
    j3_prefabs_add("prop.amber.torch", "Torch",          "Props",     "light fire amber",   "!", few);
    j3_prefabs_add("npc.cyan.drone",   "Scout Drone",    "NPCs",      "enemy flying cyan",  "^", all);
    j3_prefabs_add("npc.turret",       "Turret",         "NPCs",      "enemy static",       "T", some);
    j3_prefabs_add("veh.buggy",        "Buggy",          "Vehicles",  "car fast",           "=", all);
    j3_prefabs_add("veh.mag.chopper",  "Chopper",        "Vehicles",  "air fast mag",       "Y", all);
    j3_prefabs_add("fx.mag.blast",     "Blast FX",       "Effects",   "particle mag boom",  "*", few);
    j3_prefabs_add("fx.cyan.portal",   "Portal FX",      "Effects",   "particle cyan",      "0", few);
    j3_prefabs_add("build.wall",       "Wall Segment",   "Building",  "structure",          "|", some);
    j3_prefabs_add("build.ramp",       "Ramp",           "Building",  "structure",          "/", some);
    j3_prefabs_add("pickup.amber.coin","Coin",           "Pickups",   "loot amber money",   "o", few);
    j3_prefabs_set_spawn_callback(demoSpawn, nullptr);
    j3_prefabs_set_scan_callback([](void*){ registerDemoPrefabs(); }, nullptr);
}

/* The console has no game behind it, so it plays the part of the host: it
 * registers a sample set of prefabs and installs a spawn callback that just
 * drops a token into a little scratch scene. In a real embed the host does
 * exactly this — registers its own prefabs and spawns for real. */
struct SceneToken { float x, y, r; ImU32 col; float born; };
std::vector<SceneToken> g_scene;

int demoSpawn(const char* id, const J3SpawnArgs* args, void* /*user*/) {
    ImU32 col = IM_COL32(124, 255, 0, 255);
    if (strstr(id, "cyan")) col = IM_COL32(0, 229, 255, 255);
    else if (strstr(id, "mag")) col = IM_COL32(255, 0, 168, 255);
    else if (strstr(id, "amber")) col = IM_COL32(255, 196, 0, 255);
    int n = args && args->count > 0 ? args->count : 1;
    if (n > 50) n = 50;
    for (int i = 0; i < n; i++) {
        SceneToken t;
        t.x = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.y = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.r = (args ? args->scale : 1.0f) * (6.0f + rand() % 8);
        t.col = col;
        t.born = (float)g_uptime;
        g_scene.push_back(t);
    }
    if (g_scene.size() > 400) g_scene.erase(g_scene.begin(), g_scene.begin() + (g_scene.size() - 400));
    return 1;   // success
}

void registerDemoPrefabs() {
    j3_prefabs_clear();
    uint32_t all  = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_DISTANCE)|(1<<J3_PARAM_SCALE)|(1<<J3_PARAM_YAW);
    uint32_t some = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_SCALE);
    uint32_t few  = (1<<J3_PARAM_COUNT);
    j3_prefabs_add("prop.crate",       "Wooden Crate",   "Props",     "container box loot", "#", some);
    j3_prefabs_add("prop.barrel",      "Barrel",         "Props",     "container explosive","O", some);
    j3_prefabs_add("prop.amber.torch", "Torch",          "Props",     "light fire amber",   "!", few);
    j3_prefabs_add("npc.cyan.drone",   "Scout Drone",    "NPCs",      "enemy flying cyan",  "^", all);
    j3_prefabs_add("npc.turret",       "Turret",         "NPCs",      "enemy static",       "T", some);
    j3_prefabs_add("veh.buggy",        "Buggy",          "Vehicles",  "car fast",           "=", all);
    j3_prefabs_add("veh.mag.chopper",  "Chopper",        "Vehicles",  "air fast mag",       "Y", all);
    j3_prefabs_add("fx.mag.blast",     "Blast FX",       "Effects",   "particle mag boom",  "*", few);
    j3_prefabs_add("fx.cyan.portal",   "Portal FX",      "Effects",   "particle cyan",      "0", few);
    j3_prefabs_add("build.wall",       "Wall Segment",   "Building",  "structure",          "|", some);
    j3_prefabs_add("build.ramp",       "Ramp",           "Building",  "structure",          "/", some);
    j3_prefabs_add("pickup.amber.coin","Coin",           "Pickups",   "loot amber money",   "o", few);
    j3_prefabs_set_spawn_callback(demoSpawn, nullptr);
    j3_prefabs_set_scan_callback([](void*){ registerDemoPrefabs(); }, nullptr);
}

/* The console has no game behind it, so it plays the part of the host: it
 * registers a sample set of prefabs and installs a spawn callback that just
 * drops a token into a little scratch scene. In a real embed the host does
 * exactly this — registers its own prefabs and spawns for real. */
struct SceneToken { float x, y, r; ImU32 col; float born; };
std::vector<SceneToken> g_scene;

int demoSpawn(const char* id, const J3SpawnArgs* args, void* /*user*/) {
    ImU32 col = IM_COL32(124, 255, 0, 255);
    if (strstr(id, "cyan")) col = IM_COL32(0, 229, 255, 255);
    else if (strstr(id, "mag")) col = IM_COL32(255, 0, 168, 255);
    else if (strstr(id, "amber")) col = IM_COL32(255, 196, 0, 255);
    int n = args && args->count > 0 ? args->count : 1;
    if (n > 50) n = 50;
    for (int i = 0; i < n; i++) {
        SceneToken t;
        t.x = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.y = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.r = (args ? args->scale : 1.0f) * (6.0f + rand() % 8);
        t.col = col;
        t.born = (float)g_uptime;
        g_scene.push_back(t);
    }
    if (g_scene.size() > 400) g_scene.erase(g_scene.begin(), g_scene.begin() + (g_scene.size() - 400));
    return 1;   // success
}

void registerDemoPrefabs() {
    j3_prefabs_clear();
    uint32_t all  = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_DISTANCE)|(1<<J3_PARAM_SCALE)|(1<<J3_PARAM_YAW);
    uint32_t some = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_SCALE);
    uint32_t few  = (1<<J3_PARAM_COUNT);
    j3_prefabs_add("prop.crate",       "Wooden Crate",   "Props",     "container box loot", "#", some);
    j3_prefabs_add("prop.barrel",      "Barrel",         "Props",     "container explosive","O", some);
    j3_prefabs_add("prop.amber.torch", "Torch",          "Props",     "light fire amber",   "!", few);
    j3_prefabs_add("npc.cyan.drone",   "Scout Drone",    "NPCs",      "enemy flying cyan",  "^", all);
    j3_prefabs_add("npc.turret",       "Turret",         "NPCs",      "enemy static",       "T", some);
    j3_prefabs_add("veh.buggy",        "Buggy",          "Vehicles",  "car fast",           "=", all);
    j3_prefabs_add("veh.mag.chopper",  "Chopper",        "Vehicles",  "air fast mag",       "Y", all);
    j3_prefabs_add("fx.mag.blast",     "Blast FX",       "Effects",   "particle mag boom",  "*", few);
    j3_prefabs_add("fx.cyan.portal",   "Portal FX",      "Effects",   "particle cyan",      "0", few);
    j3_prefabs_add("build.wall",       "Wall Segment",   "Building",  "structure",          "|", some);
    j3_prefabs_add("build.ramp",       "Ramp",           "Building",  "structure",          "/", some);
    j3_prefabs_add("pickup.amber.coin","Coin",           "Pickups",   "loot amber money",   "o", few);
    j3_prefabs_set_spawn_callback(demoSpawn, nullptr);
    j3_prefabs_set_scan_callback([](void*){ registerDemoPrefabs(); }, nullptr);
}

/* The console has no game behind it, so it plays the part of the host: it
 * registers a sample set of prefabs and installs a spawn callback that just
 * drops a token into a little scratch scene. In a real embed the host does
 * exactly this — registers its own prefabs and spawns for real. */
struct SceneToken { float x, y, r; ImU32 col; float born; };
std::vector<SceneToken> g_scene;

int demoSpawn(const char* id, const J3SpawnArgs* args, void* /*user*/) {
    ImU32 col = IM_COL32(124, 255, 0, 255);
    if (strstr(id, "cyan")) col = IM_COL32(0, 229, 255, 255);
    else if (strstr(id, "mag")) col = IM_COL32(255, 0, 168, 255);
    else if (strstr(id, "amber")) col = IM_COL32(255, 196, 0, 255);
    int n = args && args->count > 0 ? args->count : 1;
    if (n > 50) n = 50;
    for (int i = 0; i < n; i++) {
        SceneToken t;
        t.x = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.y = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.r = (args ? args->scale : 1.0f) * (6.0f + rand() % 8);
        t.col = col;
        t.born = (float)g_uptime;
        g_scene.push_back(t);
    }
    if (g_scene.size() > 400) g_scene.erase(g_scene.begin(), g_scene.begin() + (g_scene.size() - 400));
    return 1;   // success
}

void registerDemoPrefabs() {
    j3_prefabs_clear();
    uint32_t all  = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_DISTANCE)|(1<<J3_PARAM_SCALE)|(1<<J3_PARAM_YAW);
    uint32_t some = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_SCALE);
    uint32_t few  = (1<<J3_PARAM_COUNT);
    j3_prefabs_add("prop.crate",       "Wooden Crate",   "Props",     "container box loot", "#", some);
    j3_prefabs_add("prop.barrel",      "Barrel",         "Props",     "container explosive","O", some);
    j3_prefabs_add("prop.amber.torch", "Torch",          "Props",     "light fire amber",   "!", few);
    j3_prefabs_add("npc.cyan.drone",   "Scout Drone",    "NPCs",      "enemy flying cyan",  "^", all);
    j3_prefabs_add("npc.turret",       "Turret",         "NPCs",      "enemy static",       "T", some);
    j3_prefabs_add("veh.buggy",        "Buggy",          "Vehicles",  "car fast",           "=", all);
    j3_prefabs_add("veh.mag.chopper",  "Chopper",        "Vehicles",  "air fast mag",       "Y", all);
    j3_prefabs_add("fx.mag.blast",     "Blast FX",       "Effects",   "particle mag boom",  "*", few);
    j3_prefabs_add("fx.cyan.portal",   "Portal FX",      "Effects",   "particle cyan",      "0", few);
    j3_prefabs_add("build.wall",       "Wall Segment",   "Building",  "structure",          "|", some);
    j3_prefabs_add("build.ramp",       "Ramp",           "Building",  "structure",          "/", some);
    j3_prefabs_add("pickup.amber.coin","Coin",           "Pickups",   "loot amber money",   "o", few);
    j3_prefabs_set_spawn_callback(demoSpawn, nullptr);
    j3_prefabs_set_scan_callback([](void*){ registerDemoPrefabs(); }, nullptr);
}

/* The console has no game behind it, so it plays the part of the host: it
 * registers a sample set of prefabs and installs a spawn callback that just
 * drops a token into a little scratch scene. In a real embed the host does
 * exactly this — registers its own prefabs and spawns for real. */
struct SceneToken { float x, y, r; ImU32 col; float born; };
std::vector<SceneToken> g_scene;

int demoSpawn(const char* id, const J3SpawnArgs* args, void* /*user*/) {
    ImU32 col = IM_COL32(124, 255, 0, 255);
    if (strstr(id, "cyan")) col = IM_COL32(0, 229, 255, 255);
    else if (strstr(id, "mag")) col = IM_COL32(255, 0, 168, 255);
    else if (strstr(id, "amber")) col = IM_COL32(255, 196, 0, 255);
    int n = args && args->count > 0 ? args->count : 1;
    if (n > 50) n = 50;
    for (int i = 0; i < n; i++) {
        SceneToken t;
        t.x = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.y = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.r = (args ? args->scale : 1.0f) * (6.0f + rand() % 8);
        t.col = col;
        t.born = (float)g_uptime;
        g_scene.push_back(t);
    }
    if (g_scene.size() > 400) g_scene.erase(g_scene.begin(), g_scene.begin() + (g_scene.size() - 400));
    return 1;   // success
}

void registerDemoPrefabs() {
    j3_prefabs_clear();
    uint32_t all  = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_DISTANCE)|(1<<J3_PARAM_SCALE)|(1<<J3_PARAM_YAW);
    uint32_t some = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_SCALE);
    uint32_t few  = (1<<J3_PARAM_COUNT);
    j3_prefabs_add("prop.crate",       "Wooden Crate",   "Props",     "container box loot", "#", some);
    j3_prefabs_add("prop.barrel",      "Barrel",         "Props",     "container explosive","O", some);
    j3_prefabs_add("prop.amber.torch", "Torch",          "Props",     "light fire amber",   "!", few);
    j3_prefabs_add("npc.cyan.drone",   "Scout Drone",    "NPCs",      "enemy flying cyan",  "^", all);
    j3_prefabs_add("npc.turret",       "Turret",         "NPCs",      "enemy static",       "T", some);
    j3_prefabs_add("veh.buggy",        "Buggy",          "Vehicles",  "car fast",           "=", all);
    j3_prefabs_add("veh.mag.chopper",  "Chopper",        "Vehicles",  "air fast mag",       "Y", all);
    j3_prefabs_add("fx.mag.blast",     "Blast FX",       "Effects",   "particle mag boom",  "*", few);
    j3_prefabs_add("fx.cyan.portal",   "Portal FX",      "Effects",   "particle cyan",      "0", few);
    j3_prefabs_add("build.wall",       "Wall Segment",   "Building",  "structure",          "|", some);
    j3_prefabs_add("build.ramp",       "Ramp",           "Building",  "structure",          "/", some);
    j3_prefabs_add("pickup.amber.coin","Coin",           "Pickups",   "loot amber money",   "o", few);
    j3_prefabs_set_spawn_callback(demoSpawn, nullptr);
    j3_prefabs_set_scan_callback([](void*){ registerDemoPrefabs(); }, nullptr);
}

/* The console has no game behind it, so it plays the part of the host: it
 * registers a sample set of prefabs and installs a spawn callback that just
 * drops a token into a little scratch scene. In a real embed the host does
 * exactly this — registers its own prefabs and spawns for real. */
struct SceneToken { float x, y, r; ImU32 col; float born; };
std::vector<SceneToken> g_scene;

int demoSpawn(const char* id, const J3SpawnArgs* args, void* /*user*/) {
    ImU32 col = IM_COL32(124, 255, 0, 255);
    if (strstr(id, "cyan")) col = IM_COL32(0, 229, 255, 255);
    else if (strstr(id, "mag")) col = IM_COL32(255, 0, 168, 255);
    else if (strstr(id, "amber")) col = IM_COL32(255, 196, 0, 255);
    int n = args && args->count > 0 ? args->count : 1;
    if (n > 50) n = 50;
    for (int i = 0; i < n; i++) {
        SceneToken t;
        t.x = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.y = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.r = (args ? args->scale : 1.0f) * (6.0f + rand() % 8);
        t.col = col;
        t.born = (float)g_uptime;
        g_scene.push_back(t);
    }
    if (g_scene.size() > 400) g_scene.erase(g_scene.begin(), g_scene.begin() + (g_scene.size() - 400));
    return 1;   // success
}

void registerDemoPrefabs() {
    j3_prefabs_clear();
    uint32_t all  = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_DISTANCE)|(1<<J3_PARAM_SCALE)|(1<<J3_PARAM_YAW);
    uint32_t some = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_SCALE);
    uint32_t few  = (1<<J3_PARAM_COUNT);
    j3_prefabs_add("prop.crate",       "Wooden Crate",   "Props",     "container box loot", "#", some);
    j3_prefabs_add("prop.barrel",      "Barrel",         "Props",     "container explosive","O", some);
    j3_prefabs_add("prop.amber.torch", "Torch",          "Props",     "light fire amber",   "!", few);
    j3_prefabs_add("npc.cyan.drone",   "Scout Drone",    "NPCs",      "enemy flying cyan",  "^", all);
    j3_prefabs_add("npc.turret",       "Turret",         "NPCs",      "enemy static",       "T", some);
    j3_prefabs_add("veh.buggy",        "Buggy",          "Vehicles",  "car fast",           "=", all);
    j3_prefabs_add("veh.mag.chopper",  "Chopper",        "Vehicles",  "air fast mag",       "Y", all);
    j3_prefabs_add("fx.mag.blast",     "Blast FX",       "Effects",   "particle mag boom",  "*", few);
    j3_prefabs_add("fx.cyan.portal",   "Portal FX",      "Effects",   "particle cyan",      "0", few);
    j3_prefabs_add("build.wall",       "Wall Segment",   "Building",  "structure",          "|", some);
    j3_prefabs_add("build.ramp",       "Ramp",           "Building",  "structure",          "/", some);
    j3_prefabs_add("pickup.amber.coin","Coin",           "Pickups",   "loot amber money",   "o", few);
    j3_prefabs_set_spawn_callback(demoSpawn, nullptr);
    j3_prefabs_set_scan_callback([](void*){ registerDemoPrefabs(); }, nullptr);
}

/* The console has no game behind it, so it plays the part of the host: it
 * registers a sample set of prefabs and installs a spawn callback that just
 * drops a token into a little scratch scene. In a real embed the host does
 * exactly this — registers its own prefabs and spawns for real. */
struct SceneToken { float x, y, r; ImU32 col; float born; };
std::vector<SceneToken> g_scene;

int demoSpawn(const char* id, const J3SpawnArgs* args, void* /*user*/) {
    ImU32 col = IM_COL32(124, 255, 0, 255);
    if (strstr(id, "cyan")) col = IM_COL32(0, 229, 255, 255);
    else if (strstr(id, "mag")) col = IM_COL32(255, 0, 168, 255);
    else if (strstr(id, "amber")) col = IM_COL32(255, 196, 0, 255);
    int n = args && args->count > 0 ? args->count : 1;
    if (n > 50) n = 50;
    for (int i = 0; i < n; i++) {
        SceneToken t;
        t.x = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.y = 0.1f + (float)(rand() % 800) / 1000.0f;
        t.r = (args ? args->scale : 1.0f) * (6.0f + rand() % 8);
        t.col = col;
        t.born = (float)g_uptime;
        g_scene.push_back(t);
    }
    if (g_scene.size() > 400) g_scene.erase(g_scene.begin(), g_scene.begin() + (g_scene.size() - 400));
    return 1;   // success
}

void registerDemoPrefabs() {
    j3_prefabs_clear();
    uint32_t all  = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_DISTANCE)|(1<<J3_PARAM_SCALE)|(1<<J3_PARAM_YAW);
    uint32_t some = (1<<J3_PARAM_COUNT)|(1<<J3_PARAM_SCALE);
    uint32_t few  = (1<<J3_PARAM_COUNT);
    j3_prefabs_add("prop.crate",       "Wooden Crate",   "Props",     "container box loot", "#", some);
    j3_prefabs_add("prop.barrel",      "Barrel",         "Props",     "container explosive","O", some);
    j3_prefabs_add("prop.amber.torch", "Torch",          "Props",     "light fire amber",   "!", few);
    j3_prefabs_add("npc.cyan.drone",   "Scout Drone",    "NPCs",      "enemy flying cyan",  "^", all);
    j3_prefabs_add("npc.turret",       "Turret",         "NPCs",      "enemy static",       "T", some);
    j3_prefabs_add("veh.buggy",        "Buggy",          "Vehicles",  "car fast",           "=", all);
    j3_prefabs_add("veh.mag.chopper",  "Chopper",        "Vehicles",  "air fast mag",       "Y", all);
    j3_prefabs_add("fx.mag.blast",     "Blast FX",       "Effects",   "particle mag boom",  "*", few);
    j3_prefabs_add("fx.cyan.portal",   "Portal FX",      "Effects",   "particle cyan",      "0", few);
    j3_prefabs_add("build.wall",       "Wall Segment",   "Building",  "structure",          "|", some);
    j3_prefabs_add("build.ramp",       "Ramp",           "Building",  "structure",          "/", some);
    j3_prefabs_add("pickup.amber.coin","Coin",           "Pickups",   "loot amber money",   "o", few);
    j3_prefabs_set_spawn_callback(demoSpawn, nullptr);
    j3_prefabs_set_scan_callback([](void*){ registerDemoPrefabs(); }, nullptr);
}

void applyBrandStyle(float density) {
    ImGuiStyle& s = ImGui::GetStyle();
    ImGui::StyleColorsDark();

    s.WindowRounding    = 10.0f;
    s.FrameRounding     = 8.0f;
    s.GrabRounding      = 8.0f;
    s.ScrollbarRounding = 8.0f;
    s.WindowBorderSize  = 1.0f;
    s.FrameBorderSize   = 1.0f;
    s.WindowPadding     = ImVec2(14, 14);
    s.FramePadding      = ImVec2(12, 9);
    s.ItemSpacing       = ImVec2(10, 10);

    ImVec4* c = s.Colors;
    const ImVec4 acid  = ImVec4(0.486f, 1.000f, 0.000f, 1.00f);
    const ImVec4 ink   = ImVec4(0.020f, 0.027f, 0.039f, 0.96f);
    const ImVec4 panel = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);

    c[ImGuiCol_WindowBg]        = ink;
    c[ImGuiCol_ChildBg]         = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_PopupBg]         = ink;
    c[ImGuiCol_Border]          = ImVec4(0.486f, 1.0f, 0.0f, 0.22f);
    c[ImGuiCol_FrameBg]         = panel;
    c[ImGuiCol_FrameBgHovered]  = ImVec4(0.486f, 1.0f, 0.0f, 0.14f);
    c[ImGuiCol_FrameBgActive]   = ImVec4(0.486f, 1.0f, 0.0f, 0.24f);
    c[ImGuiCol_TitleBg]         = panel;
    c[ImGuiCol_TitleBgActive]   = ImVec4(0.486f, 1.0f, 0.0f, 0.16f);
    c[ImGuiCol_Text]            = ImVec4(0.914f, 1.000f, 0.949f, 1.00f);
    c[ImGuiCol_TextDisabled]    = ImVec4(0.557f, 0.655f, 0.604f, 1.00f);
    c[ImGuiCol_Button]          = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_ButtonHovered]   = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_ButtonActive]    = acid;
    c[ImGuiCol_SliderGrab]      = acid;
    c[ImGuiCol_SliderGrabActive]= ImVec4(1.0f, 0.0f, 0.659f, 1.00f);
    c[ImGuiCol_CheckMark]       = acid;
    c[ImGuiCol_Header]          = ImVec4(0.486f, 1.0f, 0.0f, 0.16f);
    c[ImGuiCol_HeaderHovered]   = ImVec4(0.486f, 1.0f, 0.0f, 0.26f);
    c[ImGuiCol_HeaderActive]    = ImVec4(0.486f, 1.0f, 0.0f, 0.36f);
    c[ImGuiCol_Separator]       = ImVec4(0.486f, 1.0f, 0.0f, 0.22f);
    // StyleColorsDark leaves the tab bar its default blue, which is the one
    // part of the console that still looked like stock ImGui.
    c[ImGuiCol_Tab]                     = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);
    c[ImGuiCol_TabHovered]              = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_TabSelected]             = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);
    c[ImGuiCol_TabSelectedOverline]     = acid;
    c[ImGuiCol_TabDimmed]               = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_TabDimmedSelected]       = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.486f, 1.0f, 0.0f, 0.40f);
    // StyleColorsDark leaves the tab bar its default blue, which is the one
    // part of the console that still looked like stock ImGui.
    c[ImGuiCol_Tab]                     = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);
    c[ImGuiCol_TabHovered]              = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_TabSelected]             = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);
    c[ImGuiCol_TabSelectedOverline]     = acid;
    c[ImGuiCol_TabDimmed]               = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_TabDimmedSelected]       = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.486f, 1.0f, 0.0f, 0.40f);
    // StyleColorsDark leaves the tab bar its default blue, which is the one
    // part of the console that still looked like stock ImGui.
    c[ImGuiCol_Tab]                     = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);
    c[ImGuiCol_TabHovered]              = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_TabSelected]             = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);
    c[ImGuiCol_TabSelectedOverline]     = acid;
    c[ImGuiCol_TabDimmed]               = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_TabDimmedSelected]       = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.486f, 1.0f, 0.0f, 0.40f);
    // StyleColorsDark leaves the tab bar its default blue, which is the one
    // part of the console that still looked like stock ImGui.
    c[ImGuiCol_Tab]                     = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);
    c[ImGuiCol_TabHovered]              = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_TabSelected]             = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);
    c[ImGuiCol_TabSelectedOverline]     = acid;
    c[ImGuiCol_TabDimmed]               = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_TabDimmedSelected]       = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.486f, 1.0f, 0.0f, 0.40f);
    // StyleColorsDark leaves the tab bar its default blue, which is the one
    // part of the console that still looked like stock ImGui.
    c[ImGuiCol_Tab]                     = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);
    c[ImGuiCol_TabHovered]              = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_TabSelected]             = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);
    c[ImGuiCol_TabSelectedOverline]     = acid;
    c[ImGuiCol_TabDimmed]               = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_TabDimmedSelected]       = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.486f, 1.0f, 0.0f, 0.40f);
    // StyleColorsDark leaves the tab bar its default blue, which is the one
    // part of the console that still looked like stock ImGui.
    c[ImGuiCol_Tab]                     = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);
    c[ImGuiCol_TabHovered]              = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_TabSelected]             = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);
    c[ImGuiCol_TabSelectedOverline]     = acid;
    c[ImGuiCol_TabDimmed]               = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_TabDimmedSelected]       = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.486f, 1.0f, 0.0f, 0.40f);
    // StyleColorsDark leaves the tab bar its default blue, which is the one
    // part of the console that still looked like stock ImGui.
    c[ImGuiCol_Tab]                     = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);
    c[ImGuiCol_TabHovered]              = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_TabSelected]             = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);
    c[ImGuiCol_TabSelectedOverline]     = acid;
    c[ImGuiCol_TabDimmed]               = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_TabDimmedSelected]       = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.486f, 1.0f, 0.0f, 0.40f);
    // StyleColorsDark leaves the tab bar its default blue, which is the one
    // part of the console that still looked like stock ImGui.
    c[ImGuiCol_Tab]                     = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);
    c[ImGuiCol_TabHovered]              = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_TabSelected]             = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);
    c[ImGuiCol_TabSelectedOverline]     = acid;
    c[ImGuiCol_TabDimmed]               = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_TabDimmedSelected]       = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.486f, 1.0f, 0.0f, 0.40f);
    // StyleColorsDark leaves the tab bar its default blue, which is the one
    // part of the console that still looked like stock ImGui.
    c[ImGuiCol_Tab]                     = ImVec4(0.043f, 0.063f, 0.082f, 1.00f);
    c[ImGuiCol_TabHovered]              = ImVec4(0.486f, 1.0f, 0.0f, 0.30f);
    c[ImGuiCol_TabSelected]             = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);
    c[ImGuiCol_TabSelectedOverline]     = acid;
    c[ImGuiCol_TabDimmed]               = ImVec4(0.031f, 0.047f, 0.063f, 1.00f);
    c[ImGuiCol_TabDimmedSelected]       = ImVec4(0.486f, 1.0f, 0.0f, 0.12f);
    c[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.486f, 1.0f, 0.0f, 0.40f);
    c[ImGuiCol_PlotLines]       = acid;
    c[ImGuiCol_PlotHistogram]   = ImVec4(0.0f, 0.898f, 1.0f, 1.00f);
    c[ImGuiCol_ResizeGrip]      = ImVec4(0.486f, 1.0f, 0.0f, 0.20f);

    // A phone at 3x needs everything scaled or the widgets are thumbnail-sized.
    s.ScaleAllSizes(density);

    // 1.92 moved io.FontGlobalScale here as part of the dynamic-font rework,
    // and with IMGUI_DISABLE_OBSOLETE_FUNCTIONS the old field is gone entirely.
    s.FontScaleMain = density * 0.85f;   // the built-in font is 13px
}

void drawConsole(float dt) {
    ImGuiIO& io = ImGui::GetIO();
    g_uptime += dt;

    float fps = dt > 0.0f ? 1.0f / dt : 0.0f;
    g_fps[g_fpsAt] = fps;
    g_fpsAt = (g_fpsAt + 1) % IM_ARRAYSIZE(g_fps);
    g_frameMs[g_frameAt] = dt * 1000.0f;
    g_frameAt = (g_frameAt + 1) % IM_ARRAYSIZE(g_frameMs);

    const float pad = 10.0f * g_density;
    ImGui::SetNextWindowPos(ImVec2(pad, pad), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(io.DisplaySize.x - pad * 2,
                                    io.DisplaySize.y - pad * 2), ImGuiCond_FirstUseEver);

    if (ImGui::Begin("J3NSONTOP // NATIVE CONSOLE")) {

        ImGui::TextColored(ImVec4(g_accent[0], g_accent[1], g_accent[2], 1.0f),
                           "FUN DESTRUCTION DIVISION");
        ImGui::SameLine();
        ImGui::TextDisabled("| native");
        ImGui::Separator();

        if (ImGui::BeginTabBar("##tabs")) {

            /* ---------------------------------------------------- telemetry */
            if (ImGui::BeginTabItem("Telemetry")) {
                char overlay[48];
                snprintf(overlay, sizeof overlay, "%.0f FPS", fps);
                ImGui::PlotLines("##fps", g_fps, IM_ARRAYSIZE(g_fps), g_fpsAt, overlay,
                                 0.0f, 120.0f, ImVec2(-1, 70 * g_density));

                snprintf(overlay, sizeof overlay, "%.2f ms/frame", dt * 1000.0f);
                ImGui::PlotHistogram("##ms", g_frameMs, IM_ARRAYSIZE(g_frameMs), g_frameAt, overlay,
                                     0.0f, 40.0f, ImVec2(-1, 55 * g_density));

                ImGui::Separator();
                ImGui::Text("Surface   %d x %d px", g_width, g_height);
                ImGui::Text("Density   %.2fx", g_density);
                ImGui::Text("Uptime    %.1f s", g_uptime);
                ImGui::Text("Vertices  %d", ImGui::GetIO().MetricsRenderVertices);
                // Driver strings run long and were being clipped off-window.
                ImGui::TextWrapped("Renderer  %s", (const char*)glGetString(GL_RENDERER));
                ImGui::TextWrapped("GL        %s", (const char*)glGetString(GL_VERSION));

                if (!g_info.empty()) {
                    ImGui::Separator();
                    ImGui::TextUnformatted(g_info.c_str());
                }
                ImGui::EndTabItem();
            }

            /* -------------------------------------------------- destruction */
            if (ImGui::BeginTabItem("Destruction")) {
                ImGui::TextDisabled("Entirely for show. Nothing here touches another app.");
                ImGui::Spacing();

                ImGui::SliderFloat("Destruction", &g_destruction, 0.0f, 100.0f, "%.0f%%");
                ImGui::SliderFloat("Glitch",      &g_glitch, 0.0f, 1.0f, "%.2f");

                const char* targets[] = { "bad modders", "hackers", "scam bots", "bad guys" };
                ImGui::Combo("Target", &g_target, targets, IM_ARRAYSIZE(targets));
                ImGui::InputText("Payload", g_payload, IM_ARRAYSIZE(g_payload));

                ImGui::Spacing();
                if (ImGui::Button("ARM", ImVec2(-1, 46 * g_density))) g_destruction = 100.0f;

                ImGui::Spacing();
                // A pure-decoration meter, animated off the slider value.
                ImGui::Text("STATUS");
                float t = (float)g_uptime;
                for (int row = 0; row < 3; row++) {
                    char bar[41];
                    int filled = (int)(g_destruction / 100.0f * 40.0f);
                    for (int i = 0; i < 40; i++) {
                        bool on = i < filled;
                        if (on && g_glitch > 0.0f) {
                            float n = sinf(t * 9.0f + i * 0.7f + row * 2.1f);
                            if (n > 1.0f - g_glitch) on = false;
                        }
                        bar[i] = on ? '#' : '.';
                    }
                    bar[40] = '\0';
                    ImGui::TextColored(ImVec4(g_accent[0], g_accent[1], g_accent[2], 1.0f), "%s", bar);
                }
                ImGui::Text("%s // %s", g_payload, targets[g_target]);
                ImGui::EndTabItem();
            }

            /* ------------------------------------------------------ prefabs */
            if (ImGui::BeginTabItem("Prefabs")) {
                ImGui::TextDisabled("Demo host: the console registers sample prefabs and spawns tokens into the scratch scene below. A real game registers its own and spawns for real.");
                ImGui::Spacing();

                // a little scene the demo spawn callback draws into
                ImVec2 p0 = ImGui::GetCursorScreenPos();
                float sceneW = ImGui::GetContentRegionAvail().x;
                float sceneH = 70 * g_density;
                ImDrawList* dl = ImGui::GetWindowDrawList();
                dl->AddRectFilled(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(4, 8, 12, 255), 8);
                dl->AddRect(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(124, 255, 0, 60), 8);
                for (auto& t : g_scene) {
                    float age = (float)g_uptime - t.born;
                    float a = age < 0.3f ? age / 0.3f : 1.0f;               // pop-in
                    ImU32 c = (t.col & 0x00ffffff) | ((ImU32)(200 * a) << 24);
                    dl->AddCircleFilled(ImVec2(p0.x + t.x * sceneW, p0.y + t.y * sceneH), t.r * g_density * 0.5f, c);
                }
                ImGui::Dummy(ImVec2(sceneW, sceneH));
                if (!g_scene.empty()) {
                    ImGui::SameLine(0, 0);
                    if (ImGui::SmallButton("clear scene")) g_scene.clear();
                }

                j3_prefabs_draw_body();
                ImGui::EndTabItem();
            }

            /* ------------------------------------------------------ prefabs */
            if (ImGui::BeginTabItem("Prefabs")) {
                ImGui::TextDisabled("Demo host: the console registers sample prefabs and spawns tokens into the scratch scene below. A real game registers its own and spawns for real.");
                ImGui::Spacing();

                // a little scene the demo spawn callback draws into
                ImVec2 p0 = ImGui::GetCursorScreenPos();
                float sceneW = ImGui::GetContentRegionAvail().x;
                float sceneH = 70 * g_density;
                ImDrawList* dl = ImGui::GetWindowDrawList();
                dl->AddRectFilled(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(4, 8, 12, 255), 8);
                dl->AddRect(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(124, 255, 0, 60), 8);
                for (auto& t : g_scene) {
                    float age = (float)g_uptime - t.born;
                    float a = age < 0.3f ? age / 0.3f : 1.0f;               // pop-in
                    ImU32 c = (t.col & 0x00ffffff) | ((ImU32)(200 * a) << 24);
                    dl->AddCircleFilled(ImVec2(p0.x + t.x * sceneW, p0.y + t.y * sceneH), t.r * g_density * 0.5f, c);
                }
                ImGui::Dummy(ImVec2(sceneW, sceneH));
                if (!g_scene.empty()) {
                    ImGui::SameLine(0, 0);
                    if (ImGui::SmallButton("clear scene")) g_scene.clear();
                }

                j3_prefabs_draw_body();
                ImGui::EndTabItem();
            }

            /* ------------------------------------------------------ prefabs */
            if (ImGui::BeginTabItem("Prefabs")) {
                ImGui::TextDisabled("Demo host: the console registers sample prefabs and spawns tokens into the scratch scene below. A real game registers its own and spawns for real.");
                ImGui::Spacing();

                // a little scene the demo spawn callback draws into
                ImVec2 p0 = ImGui::GetCursorScreenPos();
                float sceneW = ImGui::GetContentRegionAvail().x;
                float sceneH = 70 * g_density;
                ImDrawList* dl = ImGui::GetWindowDrawList();
                dl->AddRectFilled(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(4, 8, 12, 255), 8);
                dl->AddRect(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(124, 255, 0, 60), 8);
                for (auto& t : g_scene) {
                    float age = (float)g_uptime - t.born;
                    float a = age < 0.3f ? age / 0.3f : 1.0f;               // pop-in
                    ImU32 c = (t.col & 0x00ffffff) | ((ImU32)(200 * a) << 24);
                    dl->AddCircleFilled(ImVec2(p0.x + t.x * sceneW, p0.y + t.y * sceneH), t.r * g_density * 0.5f, c);
                }
                ImGui::Dummy(ImVec2(sceneW, sceneH));
                if (!g_scene.empty()) {
                    ImGui::SameLine(0, 0);
                    if (ImGui::SmallButton("clear scene")) g_scene.clear();
                }

                j3_prefabs_draw_body();
                ImGui::EndTabItem();
            }

            /* ------------------------------------------------------ prefabs */
            if (ImGui::BeginTabItem("Prefabs")) {
                ImGui::TextDisabled("Demo host: the console registers sample prefabs and spawns tokens into the scratch scene below. A real game registers its own and spawns for real.");
                ImGui::Spacing();

                // a little scene the demo spawn callback draws into
                ImVec2 p0 = ImGui::GetCursorScreenPos();
                float sceneW = ImGui::GetContentRegionAvail().x;
                float sceneH = 70 * g_density;
                ImDrawList* dl = ImGui::GetWindowDrawList();
                dl->AddRectFilled(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(4, 8, 12, 255), 8);
                dl->AddRect(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(124, 255, 0, 60), 8);
                for (auto& t : g_scene) {
                    float age = (float)g_uptime - t.born;
                    float a = age < 0.3f ? age / 0.3f : 1.0f;               // pop-in
                    ImU32 c = (t.col & 0x00ffffff) | ((ImU32)(200 * a) << 24);
                    dl->AddCircleFilled(ImVec2(p0.x + t.x * sceneW, p0.y + t.y * sceneH), t.r * g_density * 0.5f, c);
                }
                ImGui::Dummy(ImVec2(sceneW, sceneH));
                if (!g_scene.empty()) {
                    ImGui::SameLine(0, 0);
                    if (ImGui::SmallButton("clear scene")) g_scene.clear();
                }

                j3_prefabs_draw_body();
                ImGui::EndTabItem();
            }

            /* ------------------------------------------------------ prefabs */
            if (ImGui::BeginTabItem("Prefabs")) {
                ImGui::TextDisabled("Demo host: the console registers sample prefabs and spawns tokens into the scratch scene below. A real game registers its own and spawns for real.");
                ImGui::Spacing();

                // a little scene the demo spawn callback draws into
                ImVec2 p0 = ImGui::GetCursorScreenPos();
                float sceneW = ImGui::GetContentRegionAvail().x;
                float sceneH = 70 * g_density;
                ImDrawList* dl = ImGui::GetWindowDrawList();
                dl->AddRectFilled(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(4, 8, 12, 255), 8);
                dl->AddRect(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(124, 255, 0, 60), 8);
                for (auto& t : g_scene) {
                    float age = (float)g_uptime - t.born;
                    float a = age < 0.3f ? age / 0.3f : 1.0f;               // pop-in
                    ImU32 c = (t.col & 0x00ffffff) | ((ImU32)(200 * a) << 24);
                    dl->AddCircleFilled(ImVec2(p0.x + t.x * sceneW, p0.y + t.y * sceneH), t.r * g_density * 0.5f, c);
                }
                ImGui::Dummy(ImVec2(sceneW, sceneH));
                if (!g_scene.empty()) {
                    ImGui::SameLine(0, 0);
                    if (ImGui::SmallButton("clear scene")) g_scene.clear();
                }

                j3_prefabs_draw_body();
                ImGui::EndTabItem();
            }

            /* ------------------------------------------------------ prefabs */
            if (ImGui::BeginTabItem("Prefabs")) {
                ImGui::TextDisabled("Demo host: the console registers sample prefabs and spawns tokens into the scratch scene below. A real game registers its own and spawns for real.");
                ImGui::Spacing();

                // a little scene the demo spawn callback draws into
                ImVec2 p0 = ImGui::GetCursorScreenPos();
                float sceneW = ImGui::GetContentRegionAvail().x;
                float sceneH = 70 * g_density;
                ImDrawList* dl = ImGui::GetWindowDrawList();
                dl->AddRectFilled(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(4, 8, 12, 255), 8);
                dl->AddRect(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(124, 255, 0, 60), 8);
                for (auto& t : g_scene) {
                    float age = (float)g_uptime - t.born;
                    float a = age < 0.3f ? age / 0.3f : 1.0f;               // pop-in
                    ImU32 c = (t.col & 0x00ffffff) | ((ImU32)(200 * a) << 24);
                    dl->AddCircleFilled(ImVec2(p0.x + t.x * sceneW, p0.y + t.y * sceneH), t.r * g_density * 0.5f, c);
                }
                ImGui::Dummy(ImVec2(sceneW, sceneH));
                if (!g_scene.empty()) {
                    ImGui::SameLine(0, 0);
                    if (ImGui::SmallButton("clear scene")) g_scene.clear();
                }

                j3_prefabs_draw_body();
                ImGui::EndTabItem();
            }

            /* ------------------------------------------------------ prefabs */
            if (ImGui::BeginTabItem("Prefabs")) {
                ImGui::TextDisabled("Demo host: the console registers sample prefabs and spawns tokens into the scratch scene below. A real game registers its own and spawns for real.");
                ImGui::Spacing();

                // a little scene the demo spawn callback draws into
                ImVec2 p0 = ImGui::GetCursorScreenPos();
                float sceneW = ImGui::GetContentRegionAvail().x;
                float sceneH = 70 * g_density;
                ImDrawList* dl = ImGui::GetWindowDrawList();
                dl->AddRectFilled(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(4, 8, 12, 255), 8);
                dl->AddRect(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(124, 255, 0, 60), 8);
                for (auto& t : g_scene) {
                    float age = (float)g_uptime - t.born;
                    float a = age < 0.3f ? age / 0.3f : 1.0f;               // pop-in
                    ImU32 c = (t.col & 0x00ffffff) | ((ImU32)(200 * a) << 24);
                    dl->AddCircleFilled(ImVec2(p0.x + t.x * sceneW, p0.y + t.y * sceneH), t.r * g_density * 0.5f, c);
                }
                ImGui::Dummy(ImVec2(sceneW, sceneH));
                if (!g_scene.empty()) {
                    ImGui::SameLine(0, 0);
                    if (ImGui::SmallButton("clear scene")) g_scene.clear();
                }

                j3_prefabs_draw_body();
                ImGui::EndTabItem();
            }

            /* ------------------------------------------------------ prefabs */
            if (ImGui::BeginTabItem("Prefabs")) {
                ImGui::TextDisabled("Demo host: the console registers sample prefabs and spawns tokens into the scratch scene below. A real game registers its own and spawns for real.");
                ImGui::Spacing();

                // a little scene the demo spawn callback draws into
                ImVec2 p0 = ImGui::GetCursorScreenPos();
                float sceneW = ImGui::GetContentRegionAvail().x;
                float sceneH = 70 * g_density;
                ImDrawList* dl = ImGui::GetWindowDrawList();
                dl->AddRectFilled(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(4, 8, 12, 255), 8);
                dl->AddRect(p0, ImVec2(p0.x + sceneW, p0.y + sceneH), IM_COL32(124, 255, 0, 60), 8);
                for (auto& t : g_scene) {
                    float age = (float)g_uptime - t.born;
                    float a = age < 0.3f ? age / 0.3f : 1.0f;               // pop-in
                    ImU32 c = (t.col & 0x00ffffff) | ((ImU32)(200 * a) << 24);
                    dl->AddCircleFilled(ImVec2(p0.x + t.x * sceneW, p0.y + t.y * sceneH), t.r * g_density * 0.5f, c);
                }
                ImGui::Dummy(ImVec2(sceneW, sceneH));
                if (!g_scene.empty()) {
                    ImGui::SameLine(0, 0);
                    if (ImGui::SmallButton("clear scene")) g_scene.clear();
                }

                j3_prefabs_draw_body();
                ImGui::EndTabItem();
            }

            /* ------------------------------------------------------- style */
            if (ImGui::BeginTabItem("Style")) {
                ImGui::ColorEdit3("Accent", g_accent);
                ImGui::Checkbox("Scanlines", &g_scanlines);
                ImGui::Checkbox("Dear ImGui demo window", &g_showDemo);
                ImGui::Spacing();
                ImGui::TextDisabled("Dear ImGui %s", IMGUI_VERSION);
                ImGui::TextDisabled("MIT licence - see third_party/imgui/LICENSE.txt");
                ImGui::EndTabItem();
            }

            ImGui::EndTabBar();
        }
    }
    ImGui::End();

    if (g_showDemo) ImGui::ShowDemoWindow(&g_showDemo);
}

/* Drawn as geometry rather than a shader so it costs one draw call and needs
 * no framebuffer tricks; it only has to echo the WebView's CRT look. */
void drawScanlines() {
    if (!g_scanlines) return;
    ImDrawList* dl = ImGui::GetBackgroundDrawList();
    const ImU32 col = IM_COL32(0, 0, 0, 46);
    for (float y = 0; y < (float)g_height; y += 3.0f * g_density) {
        dl->AddLine(ImVec2(0, y), ImVec2((float)g_width, y), col, 1.0f * g_density);
    }
}

} // namespace

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_j3nsontop_industries_ConsoleView_nativeInit(JNIEnv*, jclass, jfloat density) {
    if (g_ready) return JNI_TRUE;

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;                 // no settings file on device
    io.LogFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    g_density = density > 0.5f ? density : 1.0f;
    applyBrandStyle(g_density);

    j3_prefabs_init();
    registerDemoPrefabs();

    if (!ImGui_ImplOpenGL3_Init("#version 300 es")) {
        LOGE("ImGui_ImplOpenGL3_Init failed");
        ImGui::DestroyContext();
        return JNI_FALSE;
    }

    g_ready = true;
    LOGI("console up: ImGui %s, density %.2f", IMGUI_VERSION, g_density);
    return JNI_TRUE;
}

JNIEXPORT void JNICALL
Java_com_j3nsontop_industries_ConsoleView_nativeResize(JNIEnv*, jclass, jint w, jint h) {
    g_width = w; g_height = h;
    if (g_ready) ImGui::GetIO().DisplaySize = ImVec2((float)w, (float)h);
}

JNIEXPORT void JNICALL
Java_com_j3nsontop_industries_ConsoleView_nativeFrame(JNIEnv*, jclass, jfloat dt) {
    if (!g_ready || g_width <= 0 || g_height <= 0) return;

    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2((float)g_width, (float)g_height);
    io.DeltaTime = dt > 0.0f ? dt : 1.0f / 60.0f;

    ImGui_ImplOpenGL3_NewFrame();
    ImGui::NewFrame();

    drawScanlines();
    drawConsole(dt);

    ImGui::Render();

    glViewport(0, 0, g_width, g_height);
    glClearColor(0.020f, 0.027f, 0.039f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}

/* action: 0 down, 1 move, 2 up. ImGui is mouse-driven, so a single finger is
 * reported as the left button. */
JNIEXPORT void JNICALL
Java_com_j3nsontop_industries_ConsoleView_nativeTouch(JNIEnv*, jclass,
                                                      jint action, jfloat x, jfloat y) {
    if (!g_ready) return;
    ImGuiIO& io = ImGui::GetIO();
    io.AddMousePosEvent(x, y);
    if (action == 0)      io.AddMouseButtonEvent(0, true);
    else if (action == 2) io.AddMouseButtonEvent(0, false);
}

JNIEXPORT void JNICALL
Java_com_j3nsontop_industries_ConsoleView_nativeSetInfo(JNIEnv* env, jclass, jstring s) {
    if (!s) { g_info.clear(); return; }
    const char* c = env->GetStringUTFChars(s, nullptr);
    g_info = c ? c : "";
    env->ReleaseStringUTFChars(s, c);
}

JNIEXPORT void JNICALL
Java_com_j3nsontop_industries_ConsoleView_nativeShutdown(JNIEnv*, jclass) {
    if (!g_ready) return;
    ImGui_ImplOpenGL3_Shutdown();
    ImGui::DestroyContext();
    g_ready = false;
}

/* The GL context is gone after a pause/resume, so the backend's device objects
 * have to be dropped without touching the (now invalid) GL state. */
JNIEXPORT void JNICALL
Java_com_j3nsontop_industries_ConsoleView_nativeSurfaceLost(JNIEnv*, jclass) {
    if (!g_ready) return;
    ImGui_ImplOpenGL3_Shutdown();
    ImGui::DestroyContext();
    g_ready = false;
}

JNIEXPORT jstring JNICALL
Java_com_j3nsontop_industries_ConsoleView_nativeVersion(JNIEnv* env, jclass) {
    std::string s = std::string("{\"imgui\":\"") + IMGUI_VERSION + "\",\"num\":" +
                    std::to_string(IMGUI_VERSION_NUM) + "}";
    return env->NewStringUTF(s.c_str());
}

} // extern "C"
