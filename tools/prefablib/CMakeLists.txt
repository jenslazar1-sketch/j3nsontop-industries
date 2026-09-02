# J3NSONTOP INDUSTRIES - standalone prefab-spawner library
#
# Builds libj3prefab.so: Dear ImGui + the GLES3 backend + the prefab spawner +
# the j3lib runtime, in one self-contained shared object with a plain C API and
# no JNI. Drop the result into an APK's lib/<abi>/.
#
# Not built by the app's Gradle project on purpose — the app has its own
# libj3native.so. This target reuses the same vendored ImGui and the same
# j3_prefabs.cpp, so the drop-in library and the in-app panel never diverge.
#
# Build (per ABI) with build.sh, or directly:
#   cmake -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake \
#         -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24 \
#         -DCMAKE_BUILD_TYPE=Release -GNinja -S . -B build/arm64-v8a
#   cmake --build build/arm64-v8a
cmake_minimum_required(VERSION 3.22.1)
project(j3prefab CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The app tree holds the vendored ImGui and the shared prefab source.
set(APP ${CMAKE_CURRENT_SOURCE_DIR}/../../app/src/main/cpp)
set(IMGUI ${APP}/third_party/imgui)

add_library(j3prefab SHARED
    j3lib.cpp
    ${APP}/j3_prefabs.cpp
    ${IMGUI}/imgui.cpp
    ${IMGUI}/imgui_draw.cpp
    ${IMGUI}/imgui_tables.cpp
    ${IMGUI}/imgui_widgets.cpp
    ${IMGUI}/backends/imgui_impl_opengl3.cpp
)

target_include_directories(j3prefab PRIVATE ${IMGUI} ${IMGUI}/backends ${APP} ${CMAKE_CURRENT_SOURCE_DIR})

target_compile_definitions(j3prefab PRIVATE
    IMGUI_IMPL_OPENGL_ES3
    IMGUI_DISABLE_FILE_FUNCTIONS
    IMGUI_DISABLE_OBSOLETE_FUNCTIONS
)

# -fvisibility=hidden keeps the binary small; the J3_API attribute in the
# headers re-exports exactly the public API. The version script is belt and
# braces — it also localizes any stray ImGui symbol so the export table stays
# to just the j3lib_*/j3_prefabs_* API.
target_compile_options(j3prefab PRIVATE
    -Oz -fno-exceptions -fno-rtti -fvisibility=hidden -Wall
)

set(EXPORTS ${CMAKE_CURRENT_SOURCE_DIR}/exports.map)
target_link_options(j3prefab PRIVATE
    -Wl,--version-script=${EXPORTS}
    -Wl,--gc-sections
    -Wl,--strip-all
    -Wl,-z,max-page-size=16384
)
set_target_properties(j3prefab PROPERTIES LINK_DEPENDS ${EXPORTS})

find_library(gles3-lib GLESv3)
find_library(log-lib log)
target_link_libraries(j3prefab ${gles3-lib} ${log-lib})
