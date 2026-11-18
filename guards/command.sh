#!/bin/sh
# Command guards, run by Claude Code before every Bash command (.claude/settings.json).
# Applies guards/commands.txt. A deny blocks the command, an ask hands it to the human.
# Reads the hook's JSON on stdin, or takes the command as $1 (guards/test.sh).
# Matches patterns, so it catches mistakes, not a determined bypass.
set -u
DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
[ -r "$DIR/commands.txt" ] || { echo "guards/commands.txt is missing, so every command is refused." >&2; exit 2; }

if [ $# -gt 0 ]; then
  cmd=$1
else
  input=$(cat)
  if command -v jq >/dev/null 2>&1; then
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
  else
    cmd=$input
  fi
fi

# first_reason <deny|ask> prints the reason of the first matching rule.
first_reason() {
  grep "^$1 " "$DIR/commands.txt" | while IFS= read -r rule; do
    rule=${rule#"$1 "}
    if printf '%s\n' "$cmd" | grep -Eiq -e "${rule%% => *}"; then
      printf '%s\n' "${rule#* => }"
      break
    fi
  done
}

reason=$(first_reason deny)
if [ -n "$reason" ]; then
  echo "Blocked by guards/commands.txt. $reason" >&2
  exit 2
fi
reason=$(first_reason ask)
if [ -n "$reason" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$reason"
fi
exit 0
