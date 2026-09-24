#!/usr/bin/env bash
# Deploys Bicapack ERP on this server, or redeploys it. Safe to run twice in
# a row: CI runs it after every push to main, a human runs it the same way.
#
#   ./deploy/deploy.sh                    pull IMAGE_TAG and restart what changed
#   ./deploy/deploy.sh --tag main-<sha>   deploy that exact build (also the rollback)
#   ./deploy/deploy.sh --build            build the images here instead of pulling
#   ./deploy/deploy.sh --ssl-init         first deploy on a domain: get the certificate
#
# Migrations run before anything is replaced; if one fails, the old version
# keeps serving. A new version that fails its health check does not roll
# back by itself: deploy.sh prints the logs, and --tag <previous> undoes it.
# -E: the ERR trap below must also fire inside the `compose` function.
set -Eeuo pipefail

die() { echo "deploy: $*" >&2; exit 1; }

ssl_init=false
build=false
while (($#)); do
  case $1 in
    --tag)
      [[ -n ${2:-} ]] || die "--tag needs a value, e.g. --tag main-<commit sha>"
      export IMAGE_TAG=$2
      shift 2
      ;;
    --build) build=true; shift ;;
    --ssl-init) ssl_init=true; shift ;;
    -h | --help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$ROOT"

tag="${IMAGE_TAG:-$(env_value IMAGE_TAG)}"
tag="${tag:-main}"

# --- First certificate -------------------------------------------------------
# nginx cannot start with a TLS config whose certificate does not exist, and
# certbot needs nginx up to answer the challenge. So: nginx with an HTTP-only
# config (templates/acme), certbot, then the normal deploy below swaps the
# real config in.
if $ssl_init; then
  ! $IP_MODE || die "--ssl-init needs a host name in DOMAIN, not an IP"
  email="$(env_value LETSENCRYPT_EMAIL)"
  [[ -n $email ]] || die "set LETSENCRYPT_EMAIL in .env.production"

  echo "==> Answering the ACME challenge for $DOMAIN"
  # In a subshell on purpose: acme applies to this one `up`, the rest of the
  # script keeps the mode lib.sh derived.
  # shellcheck disable=SC2030
  (export NGINX_MODE=acme; compose up -d --no-deps --force-recreate nginx)
  echo "==> Requesting the certificate"
  compose run --rm --no-deps --entrypoint certbot certbot certonly \
    --webroot -w /var/www/certbot -d "$DOMAIN" \
    --email "$email" --agree-tos --no-eff-email --non-interactive --keep-until-expiring
fi

# shellcheck disable=SC2031
if [[ $NGINX_MODE == https ]] &&
  ! compose run --rm --no-deps --entrypoint test certbot -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" 2>/dev/null; then
  die "no certificate for $DOMAIN yet: point its DNS record here, then run ./deploy/deploy.sh --ssl-init"
fi

# --- Images ------------------------------------------------------------------
# Only the three app images move on a deploy. postgres, nginx and certbot are
# pulled once and updated deliberately: ./deploy/compose.sh pull postgres nginx certbot
if $build; then
  echo "==> Building $tag here"
  compose build migrate api web
else
  echo "==> Pulling $tag"
  compose pull migrate api web
fi

# --- Migrate -----------------------------------------------------------------
# On its own, before `up`. The compose file does make the API wait for
# migrate, but `up` recreates every changed container before it starts any:
# a migration that fails inside `up` has already stopped the old API. Run
# first, a failed migration aborts the deploy with the old version serving.
# (`up` runs migrate once more below; with nothing pending it is a no-op.)
echo "==> Migrating"
compose up -d --wait postgres
compose run --rm migrate || die "a migration failed; nothing was replaced, the running version keeps serving"

# --- Start -------------------------------------------------------------------
on_error() {
  echo "deploy: FAILED. State of the stack:" >&2
  compose ps -a >&2 || true
  compose logs --tail=40 migrate api web >&2 || true
}
trap on_error ERR

echo "==> Starting"
compose up -d --remove-orphans --wait --wait-timeout 300
# nginx re-resolves the app containers every 10 s by itself; a graceful
# reload makes it follow the ones this deploy recreated right away.
compose exec -T nginx nginx -s reload

trap - ERR
echo "$(date -Iseconds) $tag$($build && echo ' (built here)')" >>"$ROOT/.deploy-history"

# Reached only on success (set -e), so a failed deploy is never cleaned up
# while it is being debugged. Every deploy by --tag leaves a tagged image, so
# dangling-only pruning would still fill the disk: remove this stack's images
# (labelled in Dockerfile.prod) that no container uses, once a week old. A
# rollback past that pulls again. Other images on the machine are left alone.
docker image prune -af --filter "label=com.bicapack.image" --filter "until=168h" >/dev/null
if $build; then docker builder prune -f --filter "until=168h" >/dev/null; fi

compose ps
echo "==> Deployed $tag"
