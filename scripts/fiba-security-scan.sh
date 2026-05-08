#!/usr/bin/env bash
# Hourly security scan of nginx logs.
# Detects suspicious patterns and writes alerts to /var/log/fiba-security-alerts.log
#
# Install (on droplet):
#   sudo cp scripts/fiba-security-scan.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/fiba-security-scan.sh
#   sudo touch /var/log/fiba-security-alerts.log
#   sudo chown root:adm /var/log/fiba-security-alerts.log
#   echo '15 * * * * root /usr/local/bin/fiba-security-scan.sh' | sudo tee /etc/cron.d/fiba-security-scan
#
# Tail in real time:
#   ssh fiba sudo tail -f /var/log/fiba-security-alerts.log

set -u
LOG=/var/log/nginx/access.log
ALERTS=/var/log/fiba-security-alerts.log
WINDOW_MIN=60

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
emit() { printf '[%s] %s\n' "$(ts)" "$*" | tee -a "$ALERTS"; }

# Build a regex of timestamps within the last $WINDOW_MIN minutes (nginx default fmt).
# nginx time: [08/May/2026:17:42:01 +0000]
# Cheaper: just take last N lines (nginx writes ~ a few hundred per hour normally).
TAIL=$(tail -n 5000 "$LOG" 2>/dev/null) || exit 0

# 1) Burst of 401s on /api/users from a single IP (auth probing).
echo "$TAIL" | awk '$9==401 && $7 ~ /^\/api\/users/ {print $1}' | sort | uniq -c | \
  awk -v t=10 '$1>=t {printf "401-burst /api/users from %s (count=%d)\n", $2, $1}' | \
  while read -r line; do emit "$line"; done

# 2) Burst of signup attempts (Supabase auth proxied or direct).
echo "$TAIL" | awk '$7 ~ /\/auth\/v1\/signup/ {print $1}' | sort | uniq -c | \
  awk -v t=15 '$1>=t {printf "signup-burst from %s (count=%d)\n", $2, $1}' | \
  while read -r line; do emit "$line"; done

# 3) Burst of 4xx (any) from a single IP — generic scanner detection.
echo "$TAIL" | awk '$9>=400 && $9<500 {print $1}' | sort | uniq -c | \
  awk -v t=100 '$1>=t {printf "4xx-burst from %s (count=%d)\n", $2, $1}' | \
  while read -r line; do emit "$line"; done

# 4) Direct hits to suspicious paths (.env, wp-admin, .git, phpmyadmin).
echo "$TAIL" | awk '$7 ~ /(\.env|wp-admin|wp-login|\.git|phpmyadmin|\.aws|id_rsa)/ {print $1, $7}' | \
  sort -u | while read -r line; do emit "scanner-path: $line"; done

# 5) Non-200 on download endpoints with high frequency (potential enum).
echo "$TAIL" | awk '$7 ~ /\/api\/nominations\/.*\/download/ && $9>=400 {print $1}' | sort | uniq -c | \
  awk -v t=20 '$1>=t {printf "download-enum from %s (count=%d)\n", $2, $1}' | \
  while read -r line; do emit "$line"; done

exit 0
