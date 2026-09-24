#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu/Debian server for Bicapack ERP, as root:
#
#   curl -fsSL <raw URL of this file> -o setup-server.sh && sudo bash setup-server.sh
#
# Installs Docker, opens only SSH/HTTP/HTTPS, adds fail2ban and (on small
# machines) swap, and creates the deploy user. It stops short of anything
# involving a secret: those steps are printed at the end, for a human.
set -euo pipefail

deploy_user="${DEPLOY_USER:-bicapack}"
home="/srv/bicapack"

[[ $EUID -eq 0 ]] || { echo "run as root (sudo bash $0)" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw fail2ban

# Docker Engine + the compose plugin, from Docker's own repository.
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# The deploy user runs deploy.sh (by hand and from CI over SSH). Membership
# of the docker group is root-equivalent: guard its SSH keys accordingly.
if ! id -u "$deploy_user" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" --home "$home" "$deploy_user"
fi
usermod -aG docker "$deploy_user"
install -d -o "$deploy_user" -g "$deploy_user" "$home/backups"

# Firewall: deny everything inbound but SSH, HTTP (ACME challenge and the
# redirect) and HTTPS. Docker publishes container ports around ufw, which is
# why the compose file publishes nothing but nginx's 80/443.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# SSH brute-force protection; Debian/Ubuntu ship the sshd jail enabled.
systemctl enable --now fail2ban

# `deploy.sh --build` runs `next build` here, which wants ~2 GB of memory.
# Pulled images need none of it, but a 2 GB box with no swap gets OOM-killed
# on the first emergency build.
mem_kb="$(awk '/MemTotal/ { print $2 }' /proc/meminfo)"
if ((mem_kb < 4000000)) && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

cat <<EOF

Server ready. Remaining steps, by hand, as $deploy_user (sudo -iu $deploy_user):

  1. Give this server read access to the repository (a read-only deploy key),
     then clone it:      git clone <repo URL> $home/app
  2. Let Docker pull the private images, with a GitHub token that has only
     read:packages:      docker login ghcr.io -u <github user>
  3. Secrets:            cd $home/app && cp .env.production.example .env.production
                         and fill in every value (chmod 600 .env.production)
  4. DNS: an A record for DOMAIN pointing at this server's address.
  5. First deploy:       ./deploy/deploy.sh --ssl-init
  6. Nightly backup:     crontab -e, the line at the top of deploy/backup.sh

docs/deployment.md has the database restore and the smoke test.
EOF
