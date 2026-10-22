#!/usr/bin/env bash
# Disk alert: emails DISK_ALERT_TO when the root filesystem is more than
# DISK_ALERT_PERCENT full (80 unless set), through the mail account the app
# already sends with (SMTP_* in .env.production). Run from cron, not from CI
# or deploy.sh. As the deploy user (`crontab -e`):
#
#   */30 * * * * /srv/bicapack/app/deploy/disk-alert.sh >> /srv/bicapack/disk-alert.log 2>&1
#
# One email when usage goes over, one a day while it stays over, and one when
# it is back under — not one every half hour. After installing it, check the
# address and the SMTP settings with one alert sent now, whatever the usage:
#
#   ./deploy/disk-alert.sh --test
#
# Both disk-full incidents (2026-09-29, 2026-10-20) were found by a deploy
# failing on `compose pull`; this is meant to find the next one first.
set -euo pipefail

test=false
case ${1:-} in
  "") ;;
  --test) test=true ;;
  -h | --help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "disk-alert: unknown option $1 (see --help)" >&2; exit 1 ;;
esac

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

die() { echo "$(date -Iseconds) disk-alert: $*" >&2; exit 1; }

threshold="$(env_value DISK_ALERT_PERCENT)"
threshold="${threshold:-80}"
[[ $threshold =~ ^[0-9]+$ ]] || die "DISK_ALERT_PERCENT must be a whole number, not '$threshold'"
to="$(env_value DISK_ALERT_TO)"
[[ -n $to ]] || die "set DISK_ALERT_TO in $ENV_FILE"

host="$(env_value SMTP_HOST)"
port="$(env_value SMTP_PORT)"
port="${port:-587}"
user="$(env_value SMTP_USER)"
password="$(env_value SMTP_PASSWORD)"
[[ -n $host && -n $user && -n $password ]] || die "SMTP_HOST, SMTP_USER and SMTP_PASSWORD must be set in $ENV_FILE"
name="$(env_value MAIL_FROM_NAME)"
name="${name:-BICA-PACK - Système de Gestion}"

used="$(df --output=pcent / | tail -n 1 | tr -dc '0-9')"
# When the last alert went out, while usage is over the line; absent under it.
state="$ROOT/.disk-alert-state"

# The message and curl's config (it holds the password) live here, removed on
# any exit, a failed send included.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Sends one plain-text email through the SMTP account. The password goes to
# curl in a private config file, never on its command line, where `ps` would
# show it to anyone on the machine.
send() {
  local subject=$1 body=$2 url address
  local -a tls=() rcpts=() addresses=()
  printf 'user = "%s:%s"\n' "${user//\"/\\\"}" "${password//\"/\\\"}" >"$tmp/curlrc"
  chmod 600 "$tmp/curlrc"

  IFS=, read -ra addresses <<<"$to"
  for address in "${addresses[@]}"; do
    address="${address// /}"
    [[ -n $address ]] && rcpts+=(--mail-rcpt "$address")
  done

  # The app's own rule (mail.service.ts): a sink on this machine speaks no
  # TLS; anywhere else TLS is required — 465 implicit, 587 by STARTTLS.
  if [[ $host == localhost || $host == 127.0.0.1 ]]; then
    url="smtp://$host:$port"
  elif [[ $port == 465 ]]; then
    url="smtps://$host:$port"
  else
    url="smtp://$host:$port"
    tls=(--ssl-reqd)
  fi

  # The display name and subject may hold accents: headers take RFC 2047
  # encoded words, the body is UTF-8 as declared.
  {
    printf 'From: =?UTF-8?B?%s?= <%s>\r\n' "$(printf %s "$name" | base64 -w0)" "$user"
    printf 'To: %s\r\n' "$to"
    printf 'Subject: =?UTF-8?B?%s?=\r\n' "$(printf %s "$subject" | base64 -w0)"
    printf 'Date: %s\r\n' "$(date -R)"
    printf 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n'
    printf '%s\n' "$body" | sed 's/$/\r/'
  } >"$tmp/message"

  curl --silent --show-error --fail --max-time 60 "${tls[@]}" \
    --config "$tmp/curlrc" --url "$url" --mail-from "$user" "${rcpts[@]}" \
    --upload-file "$tmp/message"
  echo "$(date -Iseconds) disk-alert: sent \"$subject\" to $to"
}

# What the email shows: the disk, what Docker holds on it, and the usual cures.
report() {
  cat <<EOF
$(df -h /)

$(timeout 30 docker system df 2>&1 || echo "(docker system df failed)")

Usual space to win back, as the deploy user in /srv/bicapack/app:
  docker image prune -af --filter label=com.bicapack.image   # app images no container uses
  docker image prune -f                                      # untagged images
  docker builder prune -af                                   # build cache (deploy.sh --build only)
Database backups (/srv/bicapack/backups) and the database volume grow too.
EOF
}

if $test; then
  send "[Bicapack ERP] Disk alert test: $used% used on $DOMAIN" \
    "A test of deploy/disk-alert.sh: the root disk is $used% full, and the alert fires above $threshold%.

$(report)"
  exit 0
fi

now="$(date +%s)"
if ((used > threshold)); then
  last="$(cat "$state" 2>/dev/null || echo 0)"
  # The state is written only after a send succeeds, so a failed one is
  # retried at the next run.
  if ((now - last >= 86400)); then
    send "[Bicapack ERP] Disk $used% full on $DOMAIN" \
      "The root disk is $used% full, over the $threshold% alert line. A deploy pulls about 1 GB of images and fails on a full disk.

$(report)"
    echo "$now" >"$state"
  fi
elif [[ -f $state ]]; then
  send "[Bicapack ERP] Disk back to $used% on $DOMAIN" \
    "The root disk is back under the $threshold% alert line: $used% used.

$(df -h /)"
  rm -f "$state"
fi
