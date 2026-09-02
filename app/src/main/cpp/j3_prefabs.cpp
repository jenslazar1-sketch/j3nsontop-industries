/* J3NSONTOP INDUSTRIES - j3_prefabs.cpp
 *
 * The prefab-spawner panel. See j3_prefabs.h for the contract and why it is
 * shaped the way it is (a modding SDK the host opens to, not an injector).
 *
 * The whole thing is a registry plus an ImGui view of it. It never spawns
 * anything itself — it calls the host's J3SpawnFn, which is the only code that
 * knows how to make an object appear in that particular game.
 */
#include "j3_prefabs.h"
#include "imgui.h"

#include <string>
#include <vector>
#include <cstring>
#include <cstdio>
#include <cctype>

namespace {

struct Prefab {
    std::string id, name, category, tags, glyph;
    uint32_t    paramMask;
    bool        favorite;
    int         spawned;      // running count from this session
};

struct SpawnEvent {
    std::string label;
    int         count;
    bool        ok;
};

struct State {
    std::vector<Prefab>     prefabs;
    std::vector<SpawnEvent> log;

    J3SpawnFn spawnFn = nullptr;  void* spawnUser = nullptr;
    J3ScanFn  scanFn  = nullptr;  void* scanUser  = nullptr;

    char        search[96] = {0};
    int         selected   = -1;
    int         catFilter  = 0;         // index into `cats`, 0 = All
    bool        favOnly    = false;
    J3SpawnArgs args = { 1, 3.0f, 1.0f, 0.0f };

    int         totalSpawned = 0;
    std::string lastSpawn;

    bool        inited = false;
};

State g;

/* Distinct categories in registration order, "All" first. Rebuilt lazily since
 * the set only changes when the host re-registers, which is rare. */
std::vector<std::string> categories() {
    std::vector<std::string> out;
    out.push_back("All");
    for (auto& p : g.prefabs) {
        const std::string& c = p.category.empty() ? std::string("Uncategorized") : p.category;
        bool seen = false;
        for (auto& e : out) if (e == c) { seen = true; break; }
        if (!seen) out.push_back(c);
    }
    return out;
}

bool icontains(const std::string& hay, const char* needle) {
    if (!needle || !*needle) return true;
    std::string h, n;
    h.reserve(hay.size());
    for (char c : hay) h += (char)tolower((unsigned char)c);
    for (const char* p = needle; *p; ++p) n += (char)tolower((unsigned char)*p);
    return h.find(n) != std::string::npos;
}

void doSpawn(Prefab& p) {
    SpawnEvent ev;
    ev.count = g.args.count < 1 ? 1 : g.args.count;
    char buf[192];
    snprintf(buf, sizeof buf, "%dx %s", ev.count, p.name.c_str());
    ev.label = buf;

    if (g.spawnFn) {
        ev.ok = g.spawnFn(p.id.c_str(), &g.args, g.spawnUser) != 0;
    } else {
        ev.ok = false;   // no host wired up: nothing can actually spawn
    }

    if (ev.ok) {
        p.spawned += ev.count;
        g.totalSpawned += ev.count;
        g.lastSpawn = p.id;
    }
    g.log.insert(g.log.begin(), ev);
    if (g.log.size() > 40) g.log.pop_back();
}

const ImVec4 ACID = ImVec4(0.486f, 1.0f, 0.0f, 1.0f);
const ImVec4 CYAN = ImVec4(0.0f, 0.898f, 1.0f, 1.0f);
const ImVec4 DIM  = ImVec4(0.557f, 0.655f, 0.604f, 1.0f);
const ImVec4 RED  = ImVec4(1.0f, 0.231f, 0.231f, 1.0f);

} // namespace

/* ------------------------------------------------------------ lifecycle */

extern "C" void j3_prefabs_init(void) {
    if (g.inited) return;
    g.inited = true;
    g.prefabs.clear();
    g.log.clear();
    g.totalSpawned = 0;
    g.selected = -1;
    g.lastSpawn.clear();
}

extern "C" void j3_prefabs_shutdown(void) {
    g.prefabs.clear();
    g.log.clear();
    g.spawnFn = nullptr; g.scanFn = nullptr;
    g.inited = false;
}

/* ---------------------------------------------------------- registration */

extern "C" void j3_prefabs_add(const char* id, const char* name,
                               const char* category, const char* tags,
                               const char* glyph, uint32_t param_mask) {
    if (!id || !*id) return;
    for (auto& p : g.prefabs) {
        if (p.id == id) {                      // replace in place, keep counts
            p.name     = name ? name : id;
            p.category = category ? category : "";
            p.tags     = tags ? tags : "";
            p.glyph    = glyph ? glyph : "";
            p.paramMask = param_mask;
            return;
        }
    }
    Prefab p;
    p.id = id;
    p.name = name ? name : id;
    p.category = category ? category : "";
    p.tags = tags ? tags : "";
    p.glyph = glyph ? glyph : "";
    p.paramMask = param_mask;
    p.favorite = false;
    p.spawned = 0;
    g.prefabs.push_back(std::move(p));
}

extern "C" void j3_prefabs_clear(void) {
    g.prefabs.clear();
    g.selected = -1;
}

extern "C" int j3_prefabs_count(void) { return (int)g.prefabs.size(); }

extern "C" void j3_prefabs_set_spawn_callback(J3SpawnFn fn, void* user) {
    g.spawnFn = fn; g.spawnUser = user;
}
extern "C" void j3_prefabs_set_scan_callback(J3ScanFn fn, void* user) {
    g.scanFn = fn; g.scanUser = user;
}

extern "C" int         j3_prefabs_total_spawned(void) { return g.totalSpawned; }
extern "C" const char* j3_prefabs_last_spawn(void)   { return g.lastSpawn.c_str(); }

/* --------------------------------------------------------------- drawing */

extern "C" void j3_prefabs_draw_body(void) {
    if (!ImGui::GetCurrentContext()) return;

    ImGui::TextColored(ACID, "PREFAB SPAWNER");
    ImGui::SameLine();
    ImGui::TextDisabled("| %d registered", (int)g.prefabs.size());

    if (!g.spawnFn) {
        ImGui::PushStyleColor(ImGuiCol_Text, RED);
        ImGui::TextWrapped("No host connected. Spawning is disabled until a game installs a spawn callback — this panel never spawns on its own.");
        ImGui::PopStyleColor();
    }

    // ---- search + rescan
    ImGui::SetNextItemWidth(-90 * ImGui::GetStyle().FontScaleMain);
    ImGui::InputTextWithHint("##search", "search prefabs…", g.search, sizeof g.search);
    ImGui::SameLine();
    if (ImGui::Button("Rescan", ImVec2(-1, 0))) {
        if (g.scanFn) g.scanFn(g.scanUser);   // host repopulates the registry
    }

    // ---- category chips
    auto cats = categories();
    if (g.catFilter >= (int)cats.size()) g.catFilter = 0;
    for (int i = 0; i < (int)cats.size(); i++) {
        if (i) ImGui::SameLine();
        bool on = g.catFilter == i;
        if (on) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.486f, 1.0f, 0.0f, 0.30f));
        if (ImGui::SmallButton(cats[i].c_str())) g.catFilter = i;
        if (on) ImGui::PopStyleColor();
    }
    ImGui::Checkbox("Favorites only", &g.favOnly);
    ImGui::Separator();

    // ---- the list. A fixed, modest height so the detail panel and the spawn
    // button stay on screen without scrolling the whole window.
    float row = ImGui::GetTextLineHeightWithSpacing();
    float listH = row * 6.2f;
    ImGui::BeginChild("##list", ImVec2(0, listH), true);
    int shown = 0;
    for (int i = 0; i < (int)g.prefabs.size(); i++) {
        Prefab& p = g.prefabs[i];
        std::string cat = p.category.empty() ? "Uncategorized" : p.category;
        if (g.catFilter > 0 && cat != cats[g.catFilter]) continue;
        if (g.favOnly && !p.favorite) continue;
        if (!icontains(p.name + " " + p.tags + " " + p.id, g.search)) continue;
        shown++;

        ImGui::PushID(i);
        bool sel = g.selected == i;

        // favorite star
        ImGui::PushStyleColor(ImGuiCol_Text, p.favorite ? ImVec4(1,0.77f,0,1) : DIM);
        if (ImGui::SmallButton(p.favorite ? "*" : "-")) p.favorite = !p.favorite;
        ImGui::PopStyleColor();
        ImGui::SameLine();

        std::string label = (p.glyph.empty() ? "" : p.glyph + "  ") + p.name;
        if (ImGui::Selectable(label.c_str(), sel, ImGuiSelectableFlags_AllowDoubleClick)) {
            g.selected = i;
            if (ImGui::IsMouseDoubleClicked(0) && g.spawnFn) doSpawn(p);
        }
        if (p.spawned > 0) {
            ImGui::SameLine();
            ImGui::TextColored(DIM, "x%d", p.spawned);
        }
        ImGui::PopID();
    }
    if (!shown) ImGui::TextColored(DIM, "nothing matches");
    ImGui::EndChild();

    // ---- detail + spawn
    if (g.selected >= 0 && g.selected < (int)g.prefabs.size()) {
        Prefab& p = g.prefabs[g.selected];
        ImGui::Spacing();
        ImGui::TextColored(CYAN, "%s", p.name.c_str());
        ImGui::TextDisabled("%s", p.id.c_str());
        if (!p.tags.empty()) ImGui::TextWrapped("tags: %s", p.tags.c_str());

        if (p.paramMask & (1u << J3_PARAM_COUNT)) {
            ImGui::SliderInt("Count", &g.args.count, 1, 50);
        }
        if (p.paramMask & (1u << J3_PARAM_DISTANCE)) {
            ImGui::SliderFloat("Distance", &g.args.distance, 0.0f, 30.0f, "%.1f m");
        }
        if (p.paramMask & (1u << J3_PARAM_SCALE)) {
            ImGui::SliderFloat("Scale", &g.args.scale, 0.1f, 8.0f, "%.2fx");
        }
        if (p.paramMask & (1u << J3_PARAM_YAW)) {
            ImGui::SliderFloat("Yaw", &g.args.yaw, -180.0f, 180.0f, "%.0f deg");
        }

        ImGui::BeginDisabled(g.spawnFn == nullptr);
        if (ImGui::Button("SPAWN", ImVec2(-1, 44 * ImGui::GetStyle().FontScaleMain))) doSpawn(p);
        ImGui::EndDisabled();
    } else {
        ImGui::TextColored(DIM, "select a prefab");
    }

    // ---- spawn log
    if (!g.log.empty()) {
        ImGui::Spacing();
        ImGui::TextDisabled("SPAWN LOG  (%d total)", g.totalSpawned);
        ImGui::BeginChild("##log", ImVec2(0, row * 4.5f), true);
        for (auto& ev : g.log) {
            ImGui::TextColored(ev.ok ? ACID : RED, "%s %s",
                               ev.ok ? "+" : "x", ev.label.c_str());
        }
        ImGui::EndChild();
    }
}

extern "C" void j3_prefabs_draw(void) {
    if (!ImGui::GetCurrentContext()) return;
    if (ImGui::Begin("Prefab Spawner")) {
        j3_prefabs_draw_body();
    }
    ImGui::End();
}
