#!/usr/bin/env bash
# The Android emulator for the Maestro suite (docs/testes.md, Maestro section).
#
#   bash scripts/e2e/emulator.sh start   # headless boot, foreground (Ctrl+C or `stop`)
#   bash scripts/e2e/emulator.sh wait    # blocks until booted, then prepares the device
#   bash scripts/e2e/emulator.sh stop
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

case "${1:-}" in
  start)
    # -no-snapshot: every run boots clean, so no session, queue or airplane
    # mode survives from the previous one. swiftshader: no host GPU needed,
    # and the virtual-scene back camera still renders a picture.
    exec "$EMULATOR" -avd "$E2E_AVD" -no-window -no-audio -no-boot-anim \
      -no-snapshot -gpu swiftshader_indirect -camera-back virtualscene
    ;;

  wait)
    "$ADB" wait-for-device
    until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      sleep 2
    done

    # Animations off: Maestro waits for the screen to settle, and a settling
    # animation is the usual source of a flaky tap.
    for key in window_animation_scale transition_animation_scale animator_duration_scale; do
      "$ADB" shell settings put global "$key" 0
    done

    # Metro over the adb tunnel, not over the emulator's network: airplane
    # mode in the offline flow cuts 10.0.2.2 (the API) but not this.
    "$ADB" reverse "tcp:$E2E_METRO_PORT" "tcp:$E2E_METRO_PORT" >/dev/null

    # A position near the seeded addresses (Avenida Paulista).
    "$ADB" emu geo fix -46.6565 -23.5614 >/dev/null || true

    "$ADB" shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true
    echo "Emulador pronto."
    ;;

  stop)
    "$ADB" emu kill >/dev/null 2>&1 || true
    echo "Emulador parado."
    ;;

  *)
    echo "uso: emulator.sh start|wait|stop" >&2
    exit 2
    ;;
esac
