#!/usr/bin/env bash
# Install JDK 21 + Android SDK/NDK into vendor/android/ (gitignored, survives
# container resets). Usage: scripts/android_toolchain.sh
set -euo pipefail

root="$( cd "$( dirname "$0" )/.." && pwd )/vendor/android"
mkdir -p "$root/jdk" "$root/sdk/cmdline-tools"
cd "$root"

if [ ! -x jdk/bin/java ]; then
    curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" | tar xz -C jdk --strip-components=1
fi

if [ ! -d sdk/cmdline-tools/latest ]; then
    curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip -o clt.zip
    unzip -q clt.zip -d sdk/cmdline-tools && mv sdk/cmdline-tools/cmdline-tools sdk/cmdline-tools/latest && rm clt.zip
fi

export JAVA_HOME="$root/jdk"
sdkmanager=( sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root="$root/sdk" )
yes | "${sdkmanager[@]}" --licenses > /dev/null
"${sdkmanager[@]}" "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;28.2.13676358" "cmake;3.31.6" > /dev/null
echo "Toolchain ready in $root"
