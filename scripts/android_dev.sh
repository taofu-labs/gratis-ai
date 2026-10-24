#!/usr/bin/env bash
# Build the web bundle for the apps, build the debug APK and install it on the
# connected phone. Usage: scripts/android_dev.sh [adb-serial]
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
serial=( ${1:+-s "$1"} )

npm run build:native
( cd mobile/android && ./gradlew assembleDebug -q )
adb "${serial[@]}" install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb "${serial[@]}" shell am start -n com.trueperformancenetwork.gratis/.MainActivity
