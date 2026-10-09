#!/usr/bin/env bash
# Runs the Maestro suite against the emulator (docs/testes.md, Maestro section).
#
#   bash scripts/e2e/run.sh [run-name] [maestro test args...]
#   E2E_FROM=03-offline-fila-sincronizacao bash scripts/e2e/run.sh r2
#
# Expects the API (api.sh start), Metro (metro.sh) and the emulator
# (emulator.sh start + wait) already up, and a fresh database (api.sh reset).
# E2E_FROM resumes the suite at a flow, on the session the app already has.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

run_name="${1:-$(date +%Y%m%d-%H%M%S)}"
shift || true

out="$E2E_OUT/$run_name"
mkdir -p "$out"

# Warm Metro before the app asks for the bundle: a cold dev bundle takes
# minutes to serialize on this machine, longer than the dev launcher's read
# timeout, and its "Reload" after that timeout hung the app (ANR).
echo "Aquecendo o bundle do Metro…"
curl -s -m 900 -o /dev/null -w "bundle: HTTP %{http_code}, %{size_download} bytes em %{time_total}s\n" \
  "http://localhost:$E2E_METRO_PORT/node_modules/expo-router/entry.bundle?platform=android&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable"

"$ADB" reverse "tcp:$E2E_METRO_PORT" "tcp:$E2E_METRO_PORT" >/dev/null
"$ADB" shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true

cd "$E2E_MOBILE_ROOT"

# The order lives in config.yaml (flowsOrder).
mapfile -t flows < <(sed -n 's/^ *- \([0-9][0-9][a-z]\{0,1\}-[a-z0-9-]*\)\r\{0,1\}$/\1/p' .maestro/config.yaml)

if [ -n "${E2E_FROM:-}" ]; then
  mapfile -t flows < <(printf '%s\n' "${flows[@]}" | sed -n "/^${E2E_FROM}\$/,\$p")
fi

if [ "${#flows[@]}" -eq 0 ]; then
  echo "Nenhum fluxo encontrado em .maestro/config.yaml." >&2
  exit 2
fi

# One Maestro run per flow, stopping at the first failure: the flows share
# state, and Maestro 2.11 kept running the rest of the folder after a failure
# despite continueOnFailure: false — the offline flow's airplane mode then
# leaked into every flow after it.
status=0
for flow in "${flows[@]}"; do
  echo "== $flow" | tee -a "$out/maestro.txt"

  # The two-factor code step needs a code the suite knows: swapped in right
  # before the flow, once flow 09 made the API issue one (api.sh).
  flow_env=()
  case "$flow" in
    *-dois-fatores-codigo)
      if ! code="$(bash "$E2E_MOBILE_ROOT/scripts/e2e/api.sh" two-factor-code "$E2E_TWOFA_EMAIL")"; then
        status=1
        break
      fi
      # Same length, last digit changed: certainly wrong.
      wrong="${code:0:5}$(( (${code:5:1} + 1) % 10 ))"
      flow_env=(-e TWO_FACTOR_CODE="$code" -e TWO_FACTOR_WRONG_CODE="$wrong")
      ;;
  esac

  if ! "$MAESTRO" test ".maestro/$flow.yaml" \
    --format junit --output "$out/$flow.junit.xml" \
    --test-output-dir "$out" \
    -e DRIVER_EMAIL="$E2E_DRIVER_EMAIL" \
    -e NOFLEET_EMAIL="$E2E_NOFLEET_EMAIL" \
    -e TWOFA_EMAIL="$E2E_TWOFA_EMAIL" \
    ${flow_env[@]+"${flow_env[@]}"} \
    -e DRIVER_PASSWORD="$E2E_DRIVER_PASSWORD" \
    "$@" 2>&1 | tee -a "$out/maestro.txt"; then
    status=1
    break
  fi
done

# Never leave the device offline for the next run.
"$ADB" shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true

echo "Resultado em $out"
exit "$status"
