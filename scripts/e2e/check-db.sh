#!/usr/bin/env bash
# What the suite left in the mobile_e2e database, checked after a full run
# (docs/testes.md, Maestro section). The flows prove what the screen says; this proves the API
# kept it, under the right account:
#
#   bash scripts/e2e/check-db.sh
#
# Exits 1 on the first expectation that does not hold.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

sql() {
  docker exec -i "$E2E_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U trajetto -d "$E2E_DB_NAME" -At -c "$1" | tr -d '\r'
}

failures=0

expect() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "ok   $label"
  else
    echo "FALHA $label: esperado '$expected', veio '$actual'" >&2
    failures=$((failures + 1))
  fi
}

company() {
  echo "(SELECT id FROM business WHERE corporate_reason = 'Transportadora $1')"
}

FLEET="$(company 'E2E Frota')"
NOFLEET="$(company 'E2E Sem Frota')"

# 01 + 03: two proofs, each with photo, signature and who received it.
expect "comprovantes da E2E Frota (foto, assinatura, recebedor)" "2"   "$(sql "SELECT count(*) FROM delivery_event WHERE \"businessId\" = $FLEET AND type = 'PROOF'
          AND photo IS NOT NULL AND signature IS NOT NULL AND received_by IS NOT NULL")"

# 02: the occurrence with its form answers.
expect "ocorrência com formulário" "1"   "$(sql "SELECT count(*) FROM delivery_event WHERE \"businessId\" = $FLEET AND type = 'OCCURRENCE'")"

# 04: the refuelling, odometer photo included.
expect "abastecimento (50120 km, 40 L, com foto do hodômetro)" "1"   "$(sql "SELECT count(*) FROM fuel WHERE \"businessId\" = $FLEET AND current_mileage = 50120
          AND liters_amount = 40 AND odometer_photo IS NOT NULL")"

# 04b: the checklist at 50200 km, with the three photos every checklist owes.
expect "checklist (50200 km, 3 fotos)" "1"   "$(sql "SELECT count(*) FROM vehicle_checklist WHERE \"businessId\" = $FLEET AND current_mileage = 50200
          AND photos_by_field ?& array['current_mileage', 'tires_condition', 'fuel_level_adequate']")"

# 07: the arrival queued offline by the deliveries-only driver reached the
# API reported by that driver; the fleet driver who signed in in between
# reported no arrival of that company.
expect "chegada da troca de usuário, pelo dono" "1"   "$(sql "SELECT count(*) FROM delivery_event e JOIN \"user\" u ON u.id = e.\"reportedById\"
          WHERE e.\"businessId\" = $NOFLEET AND e.type = 'ARRIVAL' AND u.email = '$E2E_NOFLEET_EMAIL'")"
expect "nenhum evento da troca de usuário pelo outro motorista" "0"   "$(sql "SELECT count(*) FROM delivery_event e JOIN \"user\" u ON u.id = e.\"reportedById\"
          WHERE e.\"businessId\" = $NOFLEET AND u.email = '$E2E_DRIVER_EMAIL'")"

# 08: the chat message, sent by the deliveries-only driver.
expect "mensagem de chat do motorista sem Frota" "1"   "$(sql "SELECT count(*) FROM chat_message m JOIN \"user\" u ON u.id = m.\"senderId\"
          WHERE u.email = '$E2E_NOFLEET_EMAIL' AND m.body = 'Cheguei no cliente E2E, portaria fechada.'")"

if [ "$failures" -gt 0 ]; then
  exit 1
fi
echo "Banco confere."
