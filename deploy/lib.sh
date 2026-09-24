# Sourced by the scripts in deploy/, never run: finds the checkout, reads
# .env.production, derives what follows from DOMAIN, and defines `compose`.
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable for a rehearsal on another machine; the server uses the default.
ENV_FILE="${BICAPACK_ENV_FILE:-$ROOT/.env.production}"

if [[ ! -f $ENV_FILE ]]; then
  echo "Missing $ENV_FILE: copy .env.production.example and fill it in." >&2
  exit 1
fi

# Bind-mount sources. Created here as the deploy user; left to Docker, they
# would be created root-owned inside the checkout.
mkdir -p "$ROOT/docker/certbot/conf" "$ROOT/docker/certbot/www" "$ROOT/docker/nginx/state"

# One value from the env file, without executing it: `source` would run any
# $(...) inside a value, and compose parses the file its own way anyway.
env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

DOMAIN="$(env_value DOMAIN)"
if [[ -z $DOMAIN ]]; then
  echo "DOMAIN is not set in $ENV_FILE" >&2
  exit 1
fi

# A bare IP cannot have a certificate: plain HTTP (templates/http). A host
# name gets TLS (templates/https). IP_MODE is read by deploy.sh.
# shellcheck disable=SC2034
if [[ $DOMAIN =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
  IP_MODE=true
  _scheme=http
else
  IP_MODE=false
  _scheme=https
fi

# In compose's interpolation the shell environment wins over the env file,
# which is how deploy.sh overrides NGINX_MODE (--ssl-init) and IMAGE_TAG
# (--tag). PUBLIC_URL is derived unless the env file pins it (a local test
# on another port).
export NGINX_MODE="${NGINX_MODE:-$_scheme}"
PUBLIC_URL="$(env_value PUBLIC_URL)"
export PUBLIC_URL="${PUBLIC_URL:-$_scheme://$DOMAIN}"
unset _scheme

compose() {
  docker compose --env-file "$ENV_FILE" -f "$ROOT/docker/docker-compose.prod.yml" "$@"
}
