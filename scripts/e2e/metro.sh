#!/usr/bin/env bash
# Metro for the debug build (docs/testes.md, Maestro section), foreground.
#
# Why a debug build and Metro rather than a self-contained release APK: a
# release bundle refuses a local, plain-HTTP API on purpose
# (utils/api-url-rules.ts), and the suite talks to the API on the host.
# The URL is inlined at bundle time, so it is set here and not in .env.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

cd "$E2E_MOBILE_ROOT"

export EXPO_PUBLIC_API_URL="$E2E_API_URL"
export EXPO_PUBLIC_WEB_APPLICATION_URL="${EXPO_PUBLIC_WEB_APPLICATION_URL:-http://10.0.2.2:3000/login}"
export EXPO_NO_TELEMETRY=1
# Not CI=1: it would also switch off file watching, and a fix to the app
# would then need a Metro restart. Without a TTY Expo does not prompt anyway.

# --clear: a cache from a run against another API would keep the old URL.
exec npx expo start --dev-client --port "$E2E_METRO_PORT" --clear
