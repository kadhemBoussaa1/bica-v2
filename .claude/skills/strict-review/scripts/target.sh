#!/usr/bin/env bash
# Resolves what a strict-review run should look at, and prints one source
# file per line on stdout (metadata goes to stderr, prefixed with '#').
#
#   target.sh                    uncommitted work: modified + untracked files
#   target.sh --staged           what `git add` has staged
#   target.sh --diff <ref>       working tree vs <ref> (branch, tag, sha)
#   target.sh --all              every source file in the repo
#   target.sh <path>...          those files / directories
#   target.sh <module>...        e.g. `clients`: the module's API folder, web
#                                route, modal interceptors, message files and
#                                contract schemas
#
# A mode flag and paths/modules together intersect: only the changed files
# that fall under those paths. Deleted files are never listed.
#
# The result is then widened to the OTHER layer (scripts/layers.mjs): web
# files add the API modules they call, API files add the web files calling
# them. `--one-layer` turns that off.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

MODE=changes
REF=""
ONE_LAYER=0
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --staged) MODE=staged ;;
    --diff)
      MODE=diff
      REF="${2:?--diff needs a ref}"
      shift
      ;;
    --all) MODE=all ;;
    # Both layers is the default: see the widening step below.
    --one-layer) ONE_LAYER=1 ;;
    # Review flags, not target flags: accepted so the same argument list can
    # be passed straight through from the skill invocation.
    --quick|--fix) ;;
    --focus) shift ;;
    --focus=*) ;;
    --) shift; ARGS+=("$@"); break ;;
    -*) echo "# unknown flag: $1" >&2; exit 2 ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

# Source files worth reviewing. Lockfiles, build output, generated Prisma
# client, docs and images are out.
is_source() {
  case "$1" in
    */node_modules/*|*/dist/*|*/.next/*|*/.turbo/*|*/generated/*|docs/*|*.lock|pnpm-lock.yaml) return 1 ;;
    *.ts|*.tsx|*.mts|*.js|*.mjs|*.cjs|*.css|*.json|*.prisma|*.sql|*.md|*.yaml|*.yml) return 0 ;;
    *) return 1 ;;
  esac
}

expand_path() {
  # A directory expands to the source files under it; a file is itself.
  if [[ -d "$1" ]]; then
    find "$1" -type f \
      -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.next/*' \
      -not -path '*/.turbo/*' -not -path '*/generated/*' | sed 's#^\./##'
  elif [[ -f "$1" ]]; then
    printf '%s\n' "$1"
  fi
}

expand_module() {
  # `clients` and `client` both reach apps/api/src/client, apps/web/app/clients,
  # the modal interceptors, the four message files and the contract schema.
  local mod="$1" sing="${1%s}"
  shopt -s nullglob
  local candidates=(
    apps/api/src/"$mod"* apps/api/src/"$sing"*
    apps/web/app/"$mod"* apps/web/app/"$sing"*
    "apps/web/app/@modal/(.)$mod"* "apps/web/app/@modal/(.)$sing"*
    apps/web/messages/*/"$mod".json apps/web/messages/*/"$sing".json
    packages/api-contract/src/"$mod"*.ts packages/api-contract/src/"$sing"*.ts
  )
  shopt -u nullglob
  local c
  for c in "${candidates[@]}"; do expand_path "$c"; done
  # The module's Zod inputs may live in a file named otherwise (clients in
  # partners.ts): find them by the schema names, createClientInput etc.
  local pascal
  pascal=$(printf '%s' "$sing" | sed -E 's/(^|-)([a-z])/\U\2/g')
  grep -lE "export const [a-zA-Z]*${pascal}[A-Za-z]*Input\b" packages/api-contract/src/*.ts 2>/dev/null || true
}

mode_files() {
  case "$MODE" in
    changes)
      git diff --name-only --diff-filter=d HEAD --
      git ls-files --others --exclude-standard
      ;;
    staged) git diff --name-only --cached --diff-filter=d -- ;;
    diff)
      git diff --name-only --diff-filter=d "$REF" --
      git ls-files --others --exclude-standard
      ;;
    all) git ls-files --cached --others --exclude-standard ;;
  esac
}

arg_files() {
  local a
  for a in "${ARGS[@]}"; do
    if [[ -e "$a" ]]; then
      expand_path "$a"
    else
      local found
      found=$(expand_module "$a")
      if [[ -z "$found" ]]; then
        echo "# nothing matched '$a' as a path or a module name" >&2
      else
        printf '%s\n' "$found"
      fi
    fi
  done
}

collect() {
  if [[ ${#ARGS[@]} -eq 0 ]]; then
    mode_files
  elif [[ "$MODE" == changes && ${#ARGS[@]} -gt 0 ]]; then
    # Paths alone, no mode flag: review exactly those, changed or not.
    arg_files
  else
    # Mode flag plus paths: the changed files under those paths.
    local wanted
    wanted=$(arg_files | sort -u)
    mode_files | grep -Fxf <(printf '%s\n' "$wanted") || true
  fi
}

FILES=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  [[ "$f" == \#* ]] && continue
  is_source "$f" || continue
  [[ -f "$f" ]] || continue
  FILES+=("$f")
done < <(collect | sort -u)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "# no source files in the target" >&2
  exit 0
fi

# Both layers, always (user's standing request, 2026-09-23): web files pull
# in the API modules their tRPC calls reach, API files pull in the web files
# that call them. `--one-layer` opts out for a deliberately narrow review.
if [[ $ONE_LAYER -eq 0 ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    is_source "$f" || continue
    [[ -f "$f" ]] || continue
    FILES+=("$f")
  done < <(printf '%s\n' "${FILES[@]}" | node "$SCRIPT_DIR/layers.mjs")
  mapfile -t FILES < <(printf '%s\n' "${FILES[@]}" | sort -u)
fi

total_lines=0
refs=()
for f in "${FILES[@]}"; do
  n=$(wc -l < "$f")
  total_lines=$((total_lines + n))
  case "$f" in
    apps/api/*) refs+=(api) ;;
    apps/web/*|packages/ui/*) refs+=(web) ;;
    packages/api-contract/*) refs+=(contract) ;;
  esac
done

desc="$MODE"
[[ "$MODE" == diff ]] && desc="diff vs $REF"
[[ "$MODE" == changes && ${#ARGS[@]} -gt 0 ]] && desc="paths"
[[ ${#ARGS[@]} -gt 0 ]] && desc="$desc (${ARGS[*]})"
echo "# target: $desc" >&2

# The procedures of every API module in the target live in the one router
# file; point the reviewer at each section once.
for mod in $(printf '%s\n' "${FILES[@]}" | sed -nE 's#^apps/api/src/([^/]+)/.*#\1#p' | sort -u); do
  key=$(printf '%s' "$mod" | sed -E 's/-([a-z])/\U\1/g')
  if grep -qE "^\s+${key}[a-zA-Z]*: router\(" apps/api/src/trpc/trpc.router.ts 2>/dev/null; then
    echo "# router section for $mod: grep -nE '^\s+${key}[a-zA-Z]*: router\(' apps/api/src/trpc/trpc.router.ts" >&2
  fi
done
echo "# files: ${#FILES[@]}  lines: $total_lines" >&2
if [[ ${#refs[@]} -gt 0 ]]; then
  echo "# references to load: $(printf '%s\n' "${refs[@]}" | sort -u | tr '\n' ' ')" >&2
fi
# What the target renders or computes through but does not include: the
# relative imports that resolve to files outside it. The reviewer reads them
# (SKILL.md step 2); the scanner's derived checks cover their classes and keys.
declare -A in_target=()
for f in "${FILES[@]}"; do in_target["$f"]=1; done
shared=()
for f in "${FILES[@]}"; do
  case "$f" in *.ts|*.tsx|*.mts) ;; *) continue ;; esac
  dir=$(dirname "$f")
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    base=$(realpath -m --relative-to=. "$dir/$rel")
    for cand in "$base" "$base.ts" "$base.tsx" "$base/index.ts" "$base/index.tsx"; do
      if [[ -f "$cand" && -z "${in_target[$cand]:-}" ]]; then
        shared+=("$cand")
        break
      fi
    done
  done < <(grep -oE 'from "\.{1,2}/[^"]+"' "$f" | sed -E 's/^from "//; s/"$//')
done
if [[ ${#shared[@]} -gt 0 ]]; then
  echo "# shared (imported, not in target): $(printf '%s\n' "${shared[@]}" | sort -u | tr '\n' ' ')" >&2
fi

if [[ ${#FILES[@]} -gt 80 ]]; then
  echo "# warning: ${#FILES[@]} files is more than one review reads properly; narrow to a module or a path, or review in passes" >&2
fi

printf '%s\n' "${FILES[@]}"
