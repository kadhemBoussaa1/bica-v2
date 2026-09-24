#!/usr/bin/env bash
# `docker compose` for the production stack. Run every compose command on
# the server through this: it points at the prod compose file and
# .env.production, and sets PUBLIC_URL and NGINX_MODE, which the compose file
# refuses to run without.
#
#   ./deploy/compose.sh ps
#   ./deploy/compose.sh logs -f --tail=100 api
#   ./deploy/compose.sh exec postgres psql -U bica
#   ./deploy/compose.sh run --rm api node dist/seed.js
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

compose "$@"
