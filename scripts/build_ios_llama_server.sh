#!/usr/bin/env bash
# Build llama.cpp `llama-server` as a static library for the iOS app (runs in
# process: iOS apps cannot spawn executables). macOS + Xcode only; CI runs it
# in .github/workflows/mobile-ios.yml.
#
# Usage: scripts/build_ios_llama_server.sh
# Output: mobile/plugin/ios/LlamaServer.xcframework (iphoneos arm64, gitignored)
#
# Metal is compiled in with the shader library embedded; it only engages on
# Apple7+ GPUs (A14 and newer), older iPhones run the NEON CPU kernels.

set -euo pipefail


# ─── Pins ─────────────────────────────────────────────────────────────────────

# Keep in step with scripts/build_android_llama_server.sh and the desktop sidecar
TAG=b11818
SRC_URL="https://github.com/ggml-org/llama.cpp/archive/refs/tags/${TAG}.tar.gz"
SRC_SHA256=ff5da88921b020b9ba62b3be2a1602872c9d72e1db9acf84a8da792b4837608f

# Capacitor pins the app's minimum to a major version (CapApp-SPM: .v16)
IOS_MIN=16.0


# ─── Paths ────────────────────────────────────────────────────────────────────

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
WORK="${ROOT}/vendor/ios/.cache"
SRC="${WORK}/llama.cpp-${TAG}"
BUILD="${WORK}/build-iphoneos"
SHIM="${ROOT}/mobile/plugin/ios/LlamaServerShim"
OUT="${ROOT}/mobile/plugin/ios/LlamaServer.xcframework"
JOBS="${JOBS:-$( sysctl -n hw.ncpu )}"

mkdir -p "${WORK}"


# ─── Source ───────────────────────────────────────────────────────────────────

tarball="${WORK}/llama.cpp-${TAG}.tar.gz"
[[ -f "${tarball}" ]] || curl -fsSL --retry 3 -o "${tarball}" "${SRC_URL}"
echo "${SRC_SHA256}  ${tarball}" | shasum -a 256 -c --quiet - || { echo "sha256 mismatch: ${tarball}"; rm -f "${tarball}"; exit 1; }
[[ -d "${SRC}" ]] || tar xzf "${tarball}" -C "${WORK}"

# In process, one run's `shutdown_handler` (a [&] lambda over its stack) would
# outlive it; reset it on entry so a stop before the next model loads is a no-op
server_cpp="${SRC}/tools/server/server.cpp"
grep -q 'gratis:' "${server_cpp}" || sed -i '' \
    '/^int llama_server(int argc, char \*\* argv) {$/a\
    shutdown_handler = nullptr; // gratis: no stale handler across in-process runs
' "${server_cpp}"
grep -q 'gratis:' "${server_cpp}" || { echo "server.cpp patch failed (upstream changed?)"; exit 1; }


# ─── Build ────────────────────────────────────────────────────────────────────

cmake -S "${SRC}" -B "${BUILD}" -G Ninja \
    -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_SYSROOT=iphoneos \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="${IOS_MIN}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_OPENMP=OFF \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=ON \
    -DGGML_BLAS=OFF \
    -DLLAMA_OPENSSL=OFF \
    -DLLAMA_SUBPROCESS=OFF \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_UI=OFF \
    -DLLAMA_USE_PREBUILT_UI=OFF

cmake --build "${BUILD}" -j "${JOBS}" --target llama-server-impl

# C shim so Swift can call the C++ entry points
sdk="$( xcrun --sdk iphoneos --show-sdk-path )"
xcrun --sdk iphoneos clang++ -std=c++17 -O2 -arch arm64 -isysroot "${sdk}" -miphoneos-version-min="${IOS_MIN}" \
    -c "${SHIM}/gratis_llama_server.cpp" -o "${BUILD}/gratis_llama_server.o"


# ─── Package ──────────────────────────────────────────────────────────────────

# One static archive: shim + server + common + llama + mtmd + every ggml backend
archives=( $( find "${BUILD}" -name '*.a' -not -path '*/CMakeFiles/*' ) )
xcrun libtool -static -o "${BUILD}/libllama-server.a" "${BUILD}/gratis_llama_server.o" "${archives[@]}"

headers="${BUILD}/headers"
rm -rf "${headers}" "${OUT}"
mkdir -p "${headers}"
cp "${SHIM}/gratis_llama_server.h" "${SHIM}/module.modulemap" "${headers}/"

xcodebuild -create-xcframework -library "${BUILD}/libllama-server.a" -headers "${headers}" -output "${OUT}"

echo
echo "llama.cpp ${TAG} -> ${OUT}"
du -sh "${OUT}"
