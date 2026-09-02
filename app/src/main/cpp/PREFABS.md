# J3 Prefab Spawner — embedding guide

A Dear ImGui panel that lists prefabs a game registers and spawns the one you
pick by calling back into the game. Engine-agnostic: it never reaches into a
game itself, it works *with* one through an interface the game opens.

```
    host  --register-->  panel        the game tells the panel what exists
    panel --spawn cb-->  host          the panel asks the game to spawn one
```

The panel owns no game state, pokes no memory, and cannot spawn anything the
host has not registered — or spawn at all until the host installs a spawn
callback. That is the whole design: a modding SDK you build into a game you
control, not something bolted onto one you don't.

**Scope.** This is for a game you own, a game you're making, or a single-player
game you're modding for yourself — the same category as a level editor's object
palette or an admin command. It is deliberately *not* an injector for gaining
an advantage over other real players in an online game; it has no hooks, no
scanner, and no way to attach itself to a process. If that's what you were
after, this isn't it, and I won't build that part.

## Files

```
j3_prefabs.h     the C ABI you build against
j3_prefabs.cpp   the registry + ImGui browser (needs Dear ImGui on the include path)
```

Add `j3_prefabs.cpp` to your build alongside the ImGui sources. That's it — no
extra dependencies beyond ImGui itself.

## The five calls you actually need

```c
#include "j3_prefabs.h"

// 1. once, at startup
j3_prefabs_init();

// 2. tell the panel what your game can spawn
j3_prefabs_add("enemy.grunt", "Grunt", "Enemies", "melee weak", "G",
               (1u<<J3_PARAM_COUNT) | (1u<<J3_PARAM_DISTANCE));
j3_prefabs_add("veh.jeep", "Jeep", "Vehicles", "fast", "J",
               (1u<<J3_PARAM_COUNT) | (1u<<J3_PARAM_SCALE) | (1u<<J3_PARAM_YAW));
// ... one line per prefab

// 3. tell the panel how to spawn (this is YOUR code — the only thing that
//    knows how to make an object appear in your game)
int my_spawn(const char* id, const J3SpawnArgs* a, void* user) {
    MyGame* game = (MyGame*)user;
    for (int i = 0; i < a->count; i++)
        game->Spawn(id, a->distance, a->scale, a->yaw);
    return 1;                       // nonzero = success, shows green in the log
}
j3_prefabs_set_spawn_callback(my_spawn, myGamePointer);

// 4. every frame, between ImGui::NewFrame() and ImGui::Render()
j3_prefabs_draw();                  // its own window
// or, inside a tab/window you already have:
j3_prefabs_draw_body();

// 5. at shutdown
j3_prefabs_shutdown();
```

## "Scanning" for prefabs

The panel does not scavenge anything — *the game decides what a scan turns up*.
Register a scan callback and the Rescan button calls it; you repopulate the
registry with whatever your game currently knows about:

```c
void my_scan(void* user) {
    j3_prefabs_clear();
    MyGame* game = (MyGame*)user;
    for (auto& def : game->PrefabDefinitions())      // your game's own list
        j3_prefabs_add(def.id, def.name, def.category, def.tags, def.glyph, def.mask);
}
j3_prefabs_set_scan_callback(my_scan, myGamePointer);
```

Where `PrefabDefinitions()` comes from is engine-specific and is yours to
provide: a Unity `Resources.LoadAll<GameObject>` list, an Unreal asset registry
query, a folder of your own prefab files, a hardcoded table. The panel never
assumes.

## From Unity (C# / P/Invoke)

The C ABI is callable from C# with `DllImport`. Compile `j3_prefabs.cpp` (plus
ImGui and a rendering backend) into a native plugin, then:

```csharp
[DllImport("j3native")] static extern void j3_prefabs_init();
[DllImport("j3native")] static extern void j3_prefabs_add(
    string id, string name, string cat, string tags, string glyph, uint mask);

delegate int SpawnFn(string id, ref J3SpawnArgs args, IntPtr user);
[DllImport("j3native")] static extern void j3_prefabs_set_spawn_callback(SpawnFn fn, IntPtr user);
```

Your `SpawnFn` calls `Instantiate(prefab, ...)` for a prefab you own. That's
ordinary Unity modding of your own project.

## The parameter mask

`param_mask` is a bitfield of `(1 << J3ParamKind)` — only the knobs that make
sense for a given prefab get a slider:

| kind             | slider     | typical use                    |
|------------------|------------|--------------------------------|
| `J3_PARAM_COUNT` | Count 1–50 | how many to spawn              |
| `J3_PARAM_DISTANCE` | Distance | how far in front of the origin |
| `J3_PARAM_SCALE` | Scale      | size multiplier                |
| `J3_PARAM_YAW`   | Yaw        | facing                         |

A decoration might expose only `COUNT`; a vehicle all four. The host reads them
back from `J3SpawnArgs` in the spawn callback and applies whatever it wants.

## Live demo

The native console (`j3_console.cpp`) is itself a host: `registerDemoPrefabs()`
registers a sample set and installs a `demoSpawn` callback that drops coloured
tokens into a scratch scene. Open the app → Intel → **Open native console** →
**Prefabs** tab to see the exact flow a real game would drive. That demo host is
~40 lines; a real one is the same shape with your `Instantiate` in place of the
token drop.
