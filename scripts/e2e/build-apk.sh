#!/usr/bin/env bash
# Builds the debug APK for the emulator and installs it (docs/testes.md, Maestro section).
#
#   bash scripts/e2e/build-apk.sh           # build, keep the APK in $E2E_OUT
#   bash scripts/e2e/build-apk.sh install   # same, then adb install -r
#
# Only needed when the native side changes (a native dependency, app.config.js,
# a config plugin); JS changes ride on Metro. Needs about 5 GB free in C:.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

cd "$E2E_MOBILE_ROOT"
mkdir -p "$E2E_OUT"

# `expo prebuild` rewrites package.json (scripts.android becomes
# "expo run:android" and an "ios" script appears): put the file back as it was.
backup="$(mktemp)"
cp package.json "$backup"
restore() {
  cp "$backup" package.json
  rm -f "$backup"
}
trap restore EXIT

npx expo prebuild --platform android --no-install
restore
trap - EXIT

# The emulator is x86_64: one ABI is a fraction of the build. A capped heap
# and worker count leave room for the editor and Docker on this machine.
(
  cd android
  ./gradlew assembleDebug --max-workers=6 \
    -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=768m" \
    -PreactNativeArchitectures=x86_64
  ./gradlew --stop >/dev/null 2>&1 || true
)

cp android/app/build/outputs/apk/debug/app-debug.apk "$E2E_OUT/app-debug.apk"

# android/ is generated (ignored by git) and, left on disk, breaks
# android-manifest.test.ts, which expects the config plugins to run clean.
rm -rf android
echo "APK em $E2E_OUT/app-debug.apk"

if [ "${1:-}" = "install" ]; then
  "$ADB" install -r "$E2E_OUT/app-debug.apk"
fi
