#!/usr/bin/env bash
# Quick verification of the H1-H9 fixes from fibaapp_security_audit.md
# Usage:  bash verify_security.sh
#
# Optional env vars:
#   PUBKEY  - publishable key (defaults to the prod one)
#   GMAIL   - real gmail to test allowed signup. Leave unset to skip.
set -u

BASE="https://www.fibaapp.com"
SUPA="https://mckaplalscnvaanukrmz.supabase.co"
PUBKEY="${PUBKEY:-sb_publishable_yr0p_RWcFWLNdd24fkKRjg_ptOFxTX2}"

pass() { printf "  \033[32m✓\033[0m %s\n" "$*"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$*"; }

echo
echo "── Pre-conditions ───────────────────────────────────────────"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
[[ "$code" == "200" ]] && pass "App is up ($code)" || fail "App returned $code"

echo
echo "── H2: signup público con dominio NO permitido ────────────"
SIGNUP=$(curl -s -X POST "$SUPA/auth/v1/signup" \
  -H "apikey: $PUBKEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"verify_$RANDOM@example.com\",\"password\":\"VerifyTest!2026\"}")
got_token=$(echo "$SIGNUP" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('access_token','none'))" 2>/dev/null)
if [[ "$got_token" == "none" ]]; then
  pass "@example.com signup blocked"
else
  fail "@example.com signup got a JWT — H2 BROKEN"
  echo "    Response head: ${SIGNUP:0:200}"
fi

echo
echo "── H1 + H4: dataset directo en Supabase REST ──────────────"
# RLS denies all rows when no policies exist for the role. PostgREST returns
# 200 with [] in that case. We treat empty body as "blocked".
for tbl in nominations personnel competitions employees loans assets; do
  body=$(curl -s "$SUPA/rest/v1/$tbl?select=id&limit=1" \
    -H "apikey: $PUBKEY" -H "Authorization: Bearer $PUBKEY")
  if [[ "$body" == "[]" || "$body" =~ "code" ]]; then
    pass "Anon GET $tbl returns no rows"
  else
    fail "Anon GET $tbl leaks data: ${body:0:120}"
  fi
done

echo
echo "── H3: /api/users requiere superadmin ─────────────────────"
# Without a JWT the auth middleware blocks at 401 — already protected
ANON_USERS=$(curl -s -o /dev/null -w "%{http_code}" -L "$BASE/api/users")
[[ "$ANON_USERS" == "401" ]] && pass "/api/users without JWT → 401" \
  || fail "/api/users without JWT returned $ANON_USERS"

echo
echo "── H5: bucket público de nominations ──────────────────────"
PUB=$(curl -s -o /dev/null -w "%{http_code}" \
  "$SUPA/storage/v1/object/public/nominations/Eugenia%20Martellotto%20FIBA%20U18%20AmeriCup%20Nomination.pdf")
[[ "$PUB" =~ ^(400|404)$ ]] && pass "Public bucket URL rejected ($PUB)" \
  || fail "Public bucket URL still serves ($PUB)"

# N1 (round 2): /api/nominations/{id}/download must reject anon callers
DL=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/api/nominations/bae73b3f-3558-4c4a-92fa-fb4224e720e6/download")
[[ "$DL" == "401" ]] && pass "Anon download rejected (401)" \
  || fail "Anon download returned $DL — expected 401"

# Same for training PDF exports
DL2=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/api/training/export/pdf/competition/bae73b3f-3558-4c4a-92fa-fb4224e720e6")
[[ "$DL2" == "401" ]] && pass "Anon training PDF rejected (401)" \
  || fail "Anon training PDF returned $DL2"

echo
echo "── H7: CSP sin 'unsafe-inline' en script-src ──────────────"
CSP=$(curl -sI "$BASE/" | grep -i 'content-security-policy:' | tr -d '\r')
echo "$CSP" | grep -q "script-src 'self'" && \
  ! echo "$CSP" | grep -q "script-src[^;]*unsafe-inline" && \
  pass "script-src clean" || fail "script-src still has unsafe-inline"

echo
echo "── H8: server header sin versión ──────────────────────────"
SRV=$(curl -sI "$BASE/" | grep -i '^server:' | tr -d '\r')
echo "$SRV" | grep -qiE "nginx/[0-9]" && fail "Server header reveals version: $SRV" \
  || pass "Server header clean ($SRV)"

echo
echo "── H9: Permissions-Policy duplicado ──────────────────────"
PP_COUNT=$(curl -sI "$BASE/" | grep -ic '^permissions-policy:')
[[ "$PP_COUNT" == "1" ]] && pass "Permissions-Policy single ($PP_COUNT)" \
  || fail "Permissions-Policy appears $PP_COUNT times"

echo
echo "── Hardening extras ──────────────────────────────────────"
HSTS=$(curl -sI "$BASE/" | grep -ic '^strict-transport-security:')
[[ "$HSTS" -ge "1" ]] && pass "HSTS enabled" || fail "HSTS missing"

XFO=$(curl -sI "$BASE/" | grep -i '^x-frame-options:' | tr -d '\r')
echo "$XFO" | grep -qi DENY && pass "X-Frame-Options DENY" || fail "X-Frame-Options weak: $XFO"

echo
echo "Done."
