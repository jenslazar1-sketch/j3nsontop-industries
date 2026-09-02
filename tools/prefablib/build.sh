#!/usr/bin/env bash
# Builds libj3prefab.so for every ABI a modder is likely to target and lays the
# results out the way an APK expects: dist/lib/<abi>/libj3prefab.so
#
# Needs the Android NDK + CMake from the SDK. Point ANDROID_NDK at the NDK if it
# is not in the default place.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
NDK="${ANDROID_NDK:-$HOME/AppData/Local/Android/Sdk/ndk/26.1.10909125}"
CMAKE_BIN="${CMAKE_BIN:-$HOME/AppData/Local/Android/Sdk/cmake/3.22.1/bin}"
CMAKE="$CMAKE_BIN/cmake"
NINJA="$CMAKE_BIN/ninja"

ABIS="${ABIS:-arm64-v8a armeabi-v7a x86_64}"
PLATFORM="${PLATFORM:-android-24}"

TOOLCHAIN="$NDK/build/cmake/android.toolchain.cmake"
[ -f "$TOOLCHAIN" ] || { echo "NDK toolchain not found at $TOOLCHAIN"; exit 1; }

rm -rf "$HERE/dist"
mkdir -p "$HERE/dist/lib"

for ABI in $ABIS; do
  echo "=== $ABI ==="
  BUILD="$HERE/build/$ABI"
  "$CMAKE" -G Ninja \
    -DCMAKE_MAKE_PROGRAM="$NINJA" \
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
    -DANDROID_ABI="$ABI" \
    -DANDROID_PLATFORM="$PLATFORM" \
    -DCMAKE_BUILD_TYPE=Release \
    -S "$HERE" -B "$BUILD" >/dev/null
  "$CMAKE" --build "$BUILD" >/dev/null
  mkdir -p "$HERE/dist/lib/$ABI"
  cp "$BUILD/libj3prefab.so" "$HERE/dist/lib/$ABI/libj3prefab.so"
  SIZE=$(stat -c%s "$HERE/dist/lib/$ABI/libj3prefab.so" 2>/dev/null || wc -c < "$HERE/dist/lib/$ABI/libj3prefab.so")
  echo "  -> dist/lib/$ABI/libj3prefab.so  ($SIZE bytes)"
done

cp "$HERE/j3lib.h" "$HERE/dist/"
cp "$HERE/../../app/src/main/cpp/j3_prefabs.h" "$HERE/dist/"
echo "done. headers + libs in $HERE/dist"
