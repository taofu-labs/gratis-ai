#!/usr/bin/env bash
# Cross-compile llama.cpp `llama-server` for Android arm64-v8a (the APK's sidecar).
#
# Usage:
#   scripts/build_android_llama_server.sh              CPU build  -> vendor/android/jniLibs/arm64-v8a/
#   WITH_OPENCL=1 scripts/build_android_llama_server.sh   + optional Adreno OpenCL backend
#
# Env:
#   ANDROID_NDK   NDK root          (default: newest under vendor/android/sdk/ndk)
#   CMAKE_BIN     cmake binary dir  (default: newest under vendor/android/sdk/cmake, else PATH)
#   JOBS          parallel jobs     (default: nproc)
#
# Output (all `lib*.so` so Android's packager keeps + extracts them from jniLibs):
#   vendor/android/jniLibs/arm64-v8a/  ship (Gradle jniLibs srcDir): libllama-server.so + ggml/llama/mtmd libs + libc++_shared.so
#   vendor/android/tools/arm64-v8a/    not shipped: llama-bench, llama-cli for measuring
#
# Runtime notes:
#   - CPU backend is built in every ARM flavour (armv8.0 -> armv9.2 SME); ggml scores
#     them against the running CPU and dlopen()s the best one. ggml searches the
#     executable's dir (/proc/self/exe) then cwd, so nativeLibraryDir just works.
#   - RUNPATH is $ORIGIN, so libllama.so & co. resolve from the binary's own dir.
#     LD_LIBRARY_PATH=<nativeLibraryDir> is a harmless belt-and-braces extra.

set -euo pipefail


# ─── Pins ─────────────────────────────────────────────────────────────────────

# Keep in step with scripts/fetch_llama_server.js (desktop sidecar)
TAG=b11818
SRC_URL="https://github.com/ggml-org/llama.cpp/archive/refs/tags/${TAG}.tar.gz"
SRC_SHA256=ff5da88921b020b9ba62b3be2a1602872c9d72e1db9acf84a8da792b4837608f

# Optional OpenCL: Khronos headers + ICD loader (link-time only; the device's
# /vendor/lib64/libOpenCL.so is used at runtime, we never ship the loader)
CL_TAG=v2024.10.24
CL_HEADERS_URL="https://github.com/KhronosGroup/OpenCL-Headers/archive/refs/tags/${CL_TAG}.tar.gz"
CL_HEADERS_SHA256=159f2a550592bae49859fee83d372acd152328fdf95c0dcd8b9409f8fad5db93
CL_LOADER_URL="https://github.com/KhronosGroup/OpenCL-ICD-Loader/archive/refs/tags/${CL_TAG}.tar.gz"
CL_LOADER_SHA256=95f2f0cda375b13d2760290df044ebea9c6ff954a7d7faa0867422442c9174dc

ABI=arm64-v8a
API=28          # Android 9: covers ~95% of active devices; >= 26 for AHardwareBuffer & co.


# ─── Paths ────────────────────────────────────────────────────────────────────

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
WORK="${ROOT}/vendor/android/.cache"               # tarballs, sources, build trees (gitignored)
OUT="${ROOT}/vendor/android/jniLibs/${ABI}"
TOOLS_OUT="${ROOT}/vendor/android/tools/${ABI}"

newest() { ls -d "$1"/*/ 2>/dev/null | sort -V | tail -1 | sed 's:/$::'; }

ANDROID_NDK="${ANDROID_NDK:-$( newest "${ROOT}/vendor/android/sdk/ndk" )}"
CMAKE_BIN="${CMAKE_BIN:-$( newest "${ROOT}/vendor/android/sdk/cmake" )/bin}"
export PATH="${CMAKE_BIN}:${PATH}"
JOBS="${JOBS:-$( nproc )}"

TOOLCHAIN="${ANDROID_NDK}/build/cmake/android.toolchain.cmake"
PREBUILT="${ANDROID_NDK}/toolchains/llvm/prebuilt/linux-x86_64"
STRIP="${PREBUILT}/bin/llvm-strip"

[[ -f "${TOOLCHAIN}" ]] || { echo "NDK not found (set ANDROID_NDK)"; exit 1; }
command -v ninja >/dev/null || { echo "ninja not found (set CMAKE_BIN)"; exit 1; }


# ─── Helpers ──────────────────────────────────────────────────────────────────

# fetch <url> <sha256> <dest.tar.gz>: download once, always verify
fetch() {
    local url=$1 sum=$2 dest=$3
    [[ -f "${dest}" ]] || { curl -fsSL --retry 3 -o "${dest}.part" "${url}" && mv "${dest}.part" "${dest}"; }
    echo "${sum}  ${dest}" | sha256sum -c --quiet - || { echo "sha256 mismatch: ${dest}"; rm -f "${dest}"; exit 1; }
}

# Shared NDK cmake flags
ndk_flags=(
    -G Ninja
    -DCMAKE_TOOLCHAIN_FILE="${TOOLCHAIN}"
    -DANDROID_ABI="${ABI}"
    -DANDROID_PLATFORM="android-${API}"
    -DCMAKE_BUILD_TYPE=Release
)


# ─── Source ───────────────────────────────────────────────────────────────────

mkdir -p "${WORK}"
fetch "${SRC_URL}" "${SRC_SHA256}" "${WORK}/llama.cpp-${TAG}.tar.gz"

SRC="${WORK}/llama.cpp-${TAG}"
[[ -d "${SRC}" ]] || tar -xzf "${WORK}/llama.cpp-${TAG}.tar.gz" -C "${WORK}"


# ─── Optional OpenCL SDK (headers + loader to link against) ──────────────────

cl_flags=()
if [[ "${WITH_OPENCL:-0}" == 1 ]]; then

    CL_PREFIX="${WORK}/opencl-sdk"

    if [[ ! -f "${CL_PREFIX}/lib/libOpenCL.so" ]]; then
        fetch "${CL_HEADERS_URL}" "${CL_HEADERS_SHA256}" "${WORK}/opencl-headers.tar.gz"
        fetch "${CL_LOADER_URL}"  "${CL_LOADER_SHA256}"  "${WORK}/opencl-loader.tar.gz"
        tar -xzf "${WORK}/opencl-headers.tar.gz" -C "${WORK}"
        tar -xzf "${WORK}/opencl-loader.tar.gz"  -C "${WORK}"

        cmake -S "${WORK}/OpenCL-Headers-${CL_TAG#v}" -B "${WORK}/build-cl-headers" "${ndk_flags[@]}" \
            -DCMAKE_INSTALL_PREFIX="${CL_PREFIX}" -DBUILD_TESTING=OFF -DOPENCL_HEADERS_BUILD_TESTING=OFF
        cmake --build "${WORK}/build-cl-headers" --target install

        cmake -S "${WORK}/OpenCL-ICD-Loader-${CL_TAG#v}" -B "${WORK}/build-cl-loader" "${ndk_flags[@]}" \
            -DCMAKE_INSTALL_PREFIX="${CL_PREFIX}" -DCMAKE_PREFIX_PATH="${CL_PREFIX}" -DBUILD_TESTING=OFF \
            -DOPENCL_ICD_LOADER_HEADERS_DIR="${CL_PREFIX}/include"
        cmake --build "${WORK}/build-cl-loader" --target install
    fi

    cl_flags=(
        -DGGML_OPENCL=ON
        -DGGML_OPENCL_USE_ADRENO_KERNELS=ON     # Adreno-tuned matmuls (7xx/8xx/X-Elite)
        -DGGML_OPENCL_EMBED_KERNELS=ON          # no .cl files to ship
        -DOpenCL_INCLUDE_DIR="${CL_PREFIX}/include"
        -DOpenCL_LIBRARY="${CL_PREFIX}/lib/libOpenCL.so"
    )
fi


# ─── Build ────────────────────────────────────────────────────────────────────

BUILD="${WORK}/build-${ABI}"

cmake -S "${SRC}" -B "${BUILD}" "${ndk_flags[@]}" \
    -DANDROID_STL=c++_shared \
    -DBUILD_SHARED_LIBS=ON \
    -DGGML_NATIVE=OFF \
    -DGGML_OPENMP=OFF \
    -DGGML_LLAMAFILE=OFF \
    -DGGML_BACKEND_DL=ON \
    -DGGML_CPU_ALL_VARIANTS=ON \
    -DLLAMA_OPENSSL=OFF \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_UI=OFF \
    -DLLAMA_USE_PREBUILT_UI=OFF \
    -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
    -DCMAKE_INSTALL_RPATH='$ORIGIN' \
    "${cl_flags[@]}"

cmake --build "${BUILD}" -j "${JOBS}" --target llama-server llama-bench llama-cli


# ─── Install ──────────────────────────────────────────────────────────────────

rm -rf "${OUT}" "${TOOLS_OUT}" "${ROOT}/vendor/android/${ABI}"   # last one: pre-jniLibs layout
mkdir -p "${OUT}" "${TOOLS_OUT}"

READELF="${PREBUILT}/bin/llvm-readelf"
LIBCXX="${PREBUILT}/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so"

# needed <elf>...: NEEDED closure within build/bin (system libs like libc/libdl are skipped)
needed() {
    local queue=( "$@" ) seen=() lib
    while (( ${#queue[@]} )); do
        for lib in $( "${READELF}" -d "${queue[0]}" | sed -n 's/.*Shared library: \[\(.*\)\]/\1/p' ); do
            [[ -f "${BUILD}/bin/${lib}" && ! " ${seen[*]} " =~ " ${lib} " ]] || continue
            seen+=( "${lib}" ); queue+=( "${BUILD}/bin/${lib}" )
        done
        queue=( "${queue[@]:1}" )
    done
    printf '%s\n' "${seen[@]}"
}

# Ship: server + its linked libs + every CPU variant (dlopen()ed, so not in NEEDED)
for lib in $( needed "${BUILD}/bin/llama-server" ) $( cd "${BUILD}/bin" && ls libggml-cpu-*.so libggml-opencl.so 2>/dev/null ); do
    cp "${BUILD}/bin/${lib}" "${OUT}/"
done
cp "${LIBCXX}" "${OUT}/"

# Android only extracts `lib*.so` from jniLibs, hence the odd name
cp "${BUILD}/bin/llama-server" "${OUT}/libllama-server.so"

# Tools: self-contained dir (own copy of every lib) for adb-pushed measuring
cp "${BUILD}"/bin/lib*.so "${LIBCXX}" "${BUILD}/bin/llama-bench" "${BUILD}/bin/llama-cli" "${BUILD}/bin/llama-server" "${TOOLS_OUT}/"

"${STRIP}" --strip-unneeded "${OUT}"/* "${TOOLS_OUT}"/*

echo
echo "llama.cpp ${TAG} -> ${OUT}"
ls -l "${OUT}" | awk 'NR > 1 { printf "  %8.1f KB  %s\n", $5 / 1024, $9 }'
du -sh --apparent-size "${OUT}" | awk '{ print "  total " $1 }'
