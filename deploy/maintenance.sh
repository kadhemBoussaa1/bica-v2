#!/usr/bin/env bash
# The maintenance switch. While on, nginx answers every app request with the
# maintenance page (503): for a risky manual operation on the database, say.
# No redeploy, and it survives nginx being restarted or recreated.
#
#   ./deploy/maintenance.sh on | off | status
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

flag=/etc/nginx/state/maintenance

case ${1:-status} in
  on) compose exec -T nginx touch "$flag" && echo "maintenance: on" ;;
  off) compose exec -T nginx rm -f "$flag" && echo "maintenance: off" ;;
  status)
    if compose exec -T nginx test -f "$flag"; then echo "maintenance: on"; else echo "maintenance: off"; fi
    ;;
  *)
    echo "usage: $0 on | off | status" >&2
    exit 1
    ;;
esac
