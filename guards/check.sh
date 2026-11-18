#!/bin/sh
# Content guards. Applies guards/content.txt, the personal literals in .git/info/blocked-literals
# (kept outside Git so the list is never published) and a 1 MB file limit.
#   check.sh files            every file in the index (pre-commit, scripts/check, CI)
#   check.sh message <file>   one commit message (commit-msg)
# Reports where a match is, never the match itself, so a secret is not copied into a log.
set -u
DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
LITERALS="$(git rev-parse --git-common-dir)/info/blocked-literals"
MAX_BYTES=1048576
mode=${1:?usage: check.sh files | check.sh message <file>}
FOUND=$(mktemp) || exit 2
trap 'rm -f "$FOUND"' EXIT

# hits <name> <grep flags and pattern...> appends "where: name" for every matching line.
hits() {
  name=$1
  shift
  if [ "$mode" = message ]; then
    grep -v '^#' "$MESSAGE" | grep -n -i "$@" | cut -d: -f1 | sed 's/^/commit message line /'
  else
    git grep --cached -n -I -i "$@" | cut -d: -f1-2
  fi | sed "s/\$/: $name/" >>"$FOUND"
}

[ "$mode" = message ] && MESSAGE=${2:?usage: check.sh message <file>}

grep -v '^[[:space:]]*\(#\|$\)' "$DIR/content.txt" | while IFS= read -r rule; do
  hits "${rule%% => *}" -E -e "${rule#* => }"
done

# Blank lines are dropped first, because an empty pattern would match every line.
if [ -s "$LITERALS" ]; then
  grep -v '^[[:space:]]*$' "$LITERALS" >"$FOUND.literals"
  [ -s "$FOUND.literals" ] && hits "a blocked personal literal" -F -f "$FOUND.literals"
  rm -f "$FOUND.literals"
fi

if [ "$mode" = files ]; then
  git ls-files -s | awk -F '\t' '{ split($1, a, " "); print a[2] " " $2 }' |
    git cat-file --batch-check='%(objectsize) %(rest)' |
    awk -v max="$MAX_BYTES" '$1 > max { sub(/^[^ ]+ /, ""); print $0 ": over 1 MB" }' >>"$FOUND"
fi

if [ -s "$FOUND" ]; then
  echo "Guards found something that must not be committed." >&2
  sed 's/^/  /' "$FOUND" >&2
  echo "Fix the cause. A key that was ever pushed must be revoked and rotated." >&2
  exit 1
fi
echo "guards: clean"
