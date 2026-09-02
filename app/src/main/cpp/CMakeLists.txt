# J3NSONTOP INDUSTRIES - native layer
#
# One shared object, two jobs:
#   j3_core.cpp     - the hot loops APK LAB cares about (inflate, hashing).
#                     zlib ships with the NDK, so this is free speed.
#   j3_console.cpp  - the Dear ImGui console, GPU-rendered through GLES3.
cmake_minimum_required(VERSION 3.22.1)
project(j3native CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(IMGUI ${CMAKE_CURRENT_SOURCE_DIR}/third_party/imgui)

add_library(j3native SHARED
    j3_core.cpp
    j3_console.cpp
    ${IMGUI}/imgui.cpp
    ${IMGUI}/imgui_draw.cpp
    ${IMGUI}/imgui_tables.cpp
    ${IMGUI}/imgui_widgets.cpp
    ${IMGUI}/imgui_demo.cpp
    ${IMGUI}/backends/imgui_impl_opengl3.cpp
)

target_include_directories(j3native PRIVATE ${IMGUI} ${IMGUI}/backends)

# The GLES3 loader inside the backend needs to know it is on ES, not desktop GL.
target_compile_definitions(j3native PRIVATE
    IMGUI_IMPL_OPENGL_ES3
    IMGUI_DISABLE_FILE_FUNCTIONS       # no fopen on Android assets
    IMGUI_DISABLE_OBSOLETE_FUNCTIONS
)

# -Oz over -O3: this is UI code, not a render farm, and every kilobyte here is
# multiplied by the number of ABIs shipped in the APK.
target_compile_options(j3native PRIVATE
    -Oz -fno-exceptions -fno-rtti -fvisibility=hidden -Wall
)

find_library(log-lib log)
find_library(gles3-lib GLESv3)
find_library(egl-lib EGL)
find_library(android-lib android)
find_library(z-lib z)

target_link_libraries(j3native
    ${log-lib} ${gles3-lib} ${egl-lib} ${android-lib} ${z-lib}
)