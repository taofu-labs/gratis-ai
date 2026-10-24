#!/usr/bin/env bash
# Build the web bundle for the apps, build the debug APK and install it on the
# connected phone. Usage: scripts/android_dev.sh [adb-serial]
set -euo pipefail

# Toolchain from scripts/android_toolchain.sh
export ANDROID_HOME="${ANDROID_HOME:-$PWD/vendor/android/sdk}"
export JAVA_HOME="${JAVA_HOME:-$PWD/vendor/android/jdk}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PWD/vendor/android/gradle}"
serial=( ${1:+-s "$1"} )

keystore=vendor/android/debug.keystore
[ -f "$keystore" ] || "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$keystore" -storepass android -keypass android \
    -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -validity 10000 > /dev/null

npm run build:native
( cd mobile/android && ./gradlew assembleDebug -q )
adb "${serial[@]}" install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb "${serial[@]}" shell am start -n com.trueperformancenetwork.gratis/.MainActivity
