#!/usr/bin/env bash
# Daily ping to Supabase to prevent auto-pause on the Free plan.
# Free pauses projects after ~7 days of DB inactivity. A trivial SELECT via
# PostgREST resets that counter.
#
# Install (on droplet):
#   sudo cp scripts/fiba-supabase-keepalive.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/fiba-supabase-keepalive.sh
#   sudo touch /var/log/fiba-supabase-keepalive.log
#   sudo chown root:adm /var/log/fiba-supabase-keepalive.log
#   sudo chmod 640 /var/log/fiba-supabase-keepalive.log
#   echo '0 9 * * * root /usr/local/bin/fiba-supabase-keepalive.sh' | \
#     sudo tee /etc/cron.d/fiba-supabase-keepalive
#
# Tail:
#   ssh fiba sudo tail -f /var/log/fiba-supabase-keepalive.log

set -u

ENV_FILE=/opt/fiba-nominations/.env
LOG=/var/log/fiba-supabase-keepalive.log

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '[%s] %s\n' "$(ts)" "$*" >> "$LOG"; }

if [[ ! -r "$ENV_FILE" ]]; then
  log "ERROR env file not readable: $ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  log "ERROR missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in $ENV_FILE"
  exit 1
fi

# PostgREST select hits Postgres → resets Supabase inactivity counter.
# limit=1 keeps it cheap; service_role bypasses RLS.
url="${SUPABASE_URL%/}/rest/v1/personnel?select=id&limit=1"

response=$(curl -sS --max-time 15 \
  -o /dev/null \
  -w '%{http_code} %{time_total}' \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  "$url" 2>&1) || {
    log "ERROR curl failed: $response"
    exit 2
  }

http_code=${response%% *}
time_total=${response##* }

if [[ "$http_code" == "200" ]]; then
  log "OK http=$http_code time=${time_total}s"
  exit 0
else
  log "FAIL http=$http_code time=${time_total}s"
  exit 3
fi
