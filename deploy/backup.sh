#!/usr/bin/env bash
# Database backup: a timestamped pg_dump (custom format, compressed, restores
# with pg_restore). Run from cron, not from CI or deploy.sh. As the deploy
# user (`crontab -e`):
#
#   0 2 * * * /srv/bicapack/app/deploy/backup.sh >> /srv/bicapack/backups/backup.log 2>&1
#
# A backup on the same disk as the database is not a backup: copy
# BACKUP_DIR off the server as well (rsync, rclone, S3).
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

backup_dir="${BACKUP_DIR:-/srv/bicapack/backups}"
keep_days="${KEEP_DAYS:-30}"
mkdir -p "$backup_dir"

previous="$(find "$backup_dir" -maxdepth 1 -name 'bica-*.dump' -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)"
out="$backup_dir/bica-$(date +%F-%H%M).dump"

compose exec -T postgres pg_dump -U bica -d bica -Fc >"$out.partial"

# pg_dump's exit status is checked (set -e); the size is the second guard,
# against a dump that "succeeded" with next to nothing in it. Refuse one under
# 10 kB outright, and one under half the previous: the data only grows, so a
# dump that halved means a broken dump or lost rows, and someone must look.
# The one legitimate shrink is an audit purge: run once with ALLOW_SHRINK=1.
size="$(stat -c %s "$out.partial")"
if ((size < 10240)); then
  echo "backup: $out.partial is only $size bytes; kept for inspection, not rotated" >&2
  exit 1
fi
if [[ -n $previous && ${ALLOW_SHRINK:-} != 1 ]]; then
  previous_size="$(stat -c %s "$previous")"
  if ((size * 2 < previous_size)); then
    echo "backup: $out.partial is $size bytes, under half of $previous ($previous_size); kept for inspection" >&2
    exit 1
  fi
fi

mv "$out.partial" "$out"
find "$backup_dir" -maxdepth 1 \( -name 'bica-*.dump' -o -name 'bica-*.dump.partial' \) -mtime +"$keep_days" -delete
echo "$(date -Iseconds) backup: $out ($size bytes)"
