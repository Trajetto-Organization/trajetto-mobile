#!/usr/bin/env bash
# The API the emulator talks to, on its own database (docs/testes.md, Maestro section).
#
#   bash scripts/e2e/api.sh reset   # drop + migrate + seed the mobile_e2e database
#   bash scripts/e2e/api.sh start   # API on :3335 in the foreground (Ctrl+C stops)
#   bash scripts/e2e/api.sh stop    # stops whatever listens on :3335
#   bash scripts/e2e/api.sh two-factor-code EMAIL   # prints a code the API accepts
#
# reset runs before every suite: the flows deliver and start routes, so a
# second run against the same rows would find nothing left to do.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

case "${E2E_DB_NAME}" in
  trajetto-database | postgres | template0 | template1 | load_test)
    echo "Recusado: $E2E_DB_NAME não é o banco do E2E do app." >&2
    exit 2
    ;;
esac

psql_admin() {
  docker exec -i "$E2E_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U trajetto -d postgres -c "$1" >/dev/null
}

cmd="${1:-}"

case "$cmd" in
  reset)
    docker start "$E2E_PG_CONTAINER" "$E2E_REDIS_CONTAINER" >/dev/null
    psql_admin "DROP DATABASE IF EXISTS \"$E2E_DB_NAME\" WITH (FORCE)"
    psql_admin "CREATE DATABASE \"$E2E_DB_NAME\""

    cd "$E2E_API_ROOT"
    DATABASE_URL="$(e2e_database_url)" npx prisma migrate deploy 2>&1 | tail -n 1

    DATABASE_URL="$(e2e_database_url)" LOAD_MOBILE_E2E=1 \
      MOBILE_E2E_EMAIL="$E2E_DRIVER_EMAIL" \
      MOBILE_E2E_NOFLEET_EMAIL="$E2E_NOFLEET_EMAIL" \
      MOBILE_E2E_TWOFA_EMAIL="$E2E_TWOFA_EMAIL" \
      MOBILE_E2E_PASSWORD="$E2E_DRIVER_PASSWORD" \
      npx tsx tests/load/seed.ts
    ;;

  start)
    if [ -n "$(e2e_pid_on_port "$E2E_API_PORT")" ]; then
      echo "A porta $E2E_API_PORT já está em uso." >&2
      exit 1
    fi

    mkdir -p "$E2E_OUT/uploads"
    cd "$E2E_API_ROOT"

    # Process env wins over trajetto-api/.env (dotenv never overrides), so
    # only what differs from the developer's stack is set here. Redis
    # database 5: the rate-limit and socket keys stay apart from the web E2E.
    export NODE_ENV=test
    export PORT="$E2E_API_PORT"
    export DATABASE_URL="$(e2e_database_url)"
    export REDIS_URL="redis://localhost:$E2E_REDIS_PORT/5"
    export REDIS_HOST=localhost REDIS_PORT="$E2E_REDIS_PORT"
    export UPLOAD_STORAGE_TYPE=local
    export UPLOAD_LOCAL_PATH="$E2E_OUT/uploads"
    export API_HTTP_REQUEST="$E2E_API_URL"

    # tsx as a loader in this very process, through node: `exec npx tsx` did
    # not resolve the binary under Git Bash on Windows. reflect-metadata is
    # required up front because src/server.ts imports tsyringe before
    # ./http (which loads the polyfill); the production build gets it from
    # the tsup banner.
    exec node --require reflect-metadata --import tsx src/server.ts
    ;;

  two-factor-code)
    # The API stores only an HMAC of the e-mailed code, and the inbox is an
    # Ethereal one the suite cannot read. So the pending code of this account
    # is swapped for one generated here, stored as a bcrypt hash (the legacy
    # format verifyOneTimeCode still accepts). Expiry, attempt counter and the
    # challenge stay the API's own. Only after a login reached the code step.
    email="${2:?uso: api.sh two-factor-code EMAIL}"
    cd "$E2E_API_ROOT"
    code="$(node -e 'process.stdout.write(String(require("node:crypto").randomInt(100000, 1000000)))')"
    hashed="$(node -e 'require("bcrypt").hash(process.argv[1], 6).then((h) => process.stdout.write(h))' "$code")"
    # psql variables (:'name') quote the values; they only work on stdin.
    updated="$(echo "UPDATE two_factor_token SET token = :'hashed' WHERE email = :'email' AND expires > now();" |
      docker exec -i "$E2E_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U trajetto -d "$E2E_DB_NAME" -At \
        -v hashed="$hashed" -v email="$email")"
    if [ "$updated" != "UPDATE 1" ]; then
      echo "Nenhum código pendente para $email (o login chegou à tela do código?)." >&2
      exit 1
    fi
    echo "$code"
    ;;

  stop)
    pid="$(e2e_pid_on_port "$E2E_API_PORT")"
    if [ -n "$pid" ]; then
      taskkill //PID "$pid" //T //F >/dev/null 2>&1 || kill "$pid" 2>/dev/null || true
      echo "API da porta $E2E_API_PORT parada."
    fi
    ;;

  *)
    echo "uso: api.sh reset|start|stop|two-factor-code EMAIL" >&2
    exit 2
    ;;
esac
