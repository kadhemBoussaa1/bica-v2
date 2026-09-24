#!/usr/bin/env bash
# Signs in to the running API with curl and prints the Better Auth session
# token on stdout (Node's fetch gets a 403 from Better Auth; curl does not).
#
#   TOKEN=$(bash session.sh)                       # super admin from apps/api/.env
#   TOKEN=$(bash session.sh production@bica.com pw) # another account
#
# The jar path is printed on stderr for follow-up curl calls, e.g.
#   curl -s -G -b "$JAR" --data-urlencode 'input={"page":1,"pageSize":10,"sortBy":"name","sortDir":"asc","filter":"all"}' \
#        http://localhost:3001/trpc/client.list | jq .result.data
# Inputs are the BARE object — there is no superjson envelope; a {"json":…}
# wrapper makes every field undefined and the call "succeeds" with defaults.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
API="${API_URL:-http://localhost:3001}"

if [[ $# -ge 2 ]]; then
  EMAIL="$1"; PASSWORD="$2"
else
  # Only the two keys, never the whole file: it holds other secrets.
  EMAIL=$(sed -n 's/^SUPER_ADMIN_EMAIL=//p' apps/api/.env | tr -d '"' | head -1)
  PASSWORD=$(sed -n 's/^SUPER_ADMIN_PASSWORD=//p' apps/api/.env | tr -d '"' | head -1)
  [[ -n "$EMAIL" && -n "$PASSWORD" ]] || { echo "# SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not in apps/api/.env" >&2; exit 2; }
fi

JAR=$(mktemp -t bica-jar.XXXXXX)
status=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$API/api/auth/sign-in/email" || true)
if [[ "$status" != "200" ]]; then
  echo "# sign-in failed (HTTP $status) — is the API up on $API?" >&2
  exit 1
fi

# Jar lines for the cookie start with "#HttpOnly_localhost", so parse the
# seven tab-separated fields rather than skipping '#' lines.
TOKEN=$(awk -F'\t' '$6 == "better-auth.session_token" { print $7 }' "$JAR" | head -1)
[[ -n "$TOKEN" ]] || { echo "# no session cookie in the jar" >&2; exit 1; }

echo "# jar: $JAR  (curl -b \"$JAR\" …); token is the cookie value, Session.token in SQL is the part before the '.'" >&2
printf '%s\n' "$TOKEN"
