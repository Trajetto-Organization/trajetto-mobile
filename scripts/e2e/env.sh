# Shared settings for the Maestro E2E scripts (docs/testes.md, Maestro section). Sourced, not run.
#
# Everything here is a throwaway: a database of its own on the DISPOSABLE
# Postgres (port 54321), an API process on 3335 and Metro on 8081. The web
# E2E uses load_test on 3334 at the same time, and the developer's stack
# (3333, 5432) is never touched.

E2E_MOBILE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_API_ROOT="${E2E_API_ROOT:-$E2E_MOBILE_ROOT/../trajetto-api}"

E2E_DB_NAME="${E2E_DB_NAME:-mobile_e2e}"
E2E_PG_CONTAINER="${E2E_PG_CONTAINER:-trajetto-itest-pg}"
E2E_PG_PORT="${E2E_PG_PORT:-54321}"
E2E_REDIS_CONTAINER="${E2E_REDIS_CONTAINER:-trajetto-test-redis}"
E2E_REDIS_PORT="${E2E_REDIS_PORT:-63790}"

E2E_API_PORT="${E2E_API_PORT:-3335}"
E2E_METRO_PORT="${E2E_METRO_PORT:-8081}"

# 10.0.2.2 is the host's loopback as the Android emulator sees it.
E2E_API_URL="${E2E_API_URL:-http://10.0.2.2:$E2E_API_PORT}"

E2E_AVD="${E2E_AVD:-Medium_Phone_API_36.1}"
E2E_APP_ID="com.trajetto.fleetmanager"

export ANDROID_HOME="${ANDROID_HOME:-/c/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [ -z "${JAVA_HOME:-}" ]; then
  for jdk in "/c/Program Files/Microsoft"/jdk-17*; do
    [ -d "$jdk" ] && export JAVA_HOME="$jdk"
  done
fi

ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"

# Maestro phones home on every run otherwise.
export MAESTRO_CLI_NO_ANALYTICS=1

# Fixture credentials (tests/load/seed.ts, LOAD_MOBILE_E2E=1). Throwaway
# database, documented test password.
E2E_DRIVER_EMAIL="${E2E_DRIVER_EMAIL:-motorista.e2e@trajetto.test}"
E2E_NOFLEET_EMAIL="${E2E_NOFLEET_EMAIL:-motorista.semfrota@trajetto.test}"
E2E_TWOFA_EMAIL="${E2E_TWOFA_EMAIL:-motorista.2fa@trajetto.test}"
E2E_DRIVER_PASSWORD="${E2E_DRIVER_PASSWORD:-Motorista@E2E2026}"

# Outside the repository: screenshots, logs and JUnit of a run.
E2E_OUT="${E2E_OUT:-${TMPDIR:-/tmp}/trajetto-mobile-e2e}"

# The disposable Postgres password, read from the container (never printed).
e2e_pg_password() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$E2E_PG_CONTAINER" |
    sed -n 's/^POSTGRES_PASSWORD=//p'
}

e2e_database_url() {
  echo "postgresql://trajetto:$(e2e_pg_password)@localhost:$E2E_PG_PORT/$E2E_DB_NAME?schema=public"
}

# Windows PID listening on a TCP port (Git Bash on Windows), empty when none.
e2e_pid_on_port() {
  netstat -ano 2>/dev/null | tr -d '\r' |
    awk -v port=":$1" '$2 ~ port"$" && $4 == "LISTENING" { print $5; exit }'
}
