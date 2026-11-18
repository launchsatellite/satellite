#!/bin/sh
# Proves every guard still fires, and stays quiet on everyday work. Run it after editing a guard.
set -u
DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
failed=0

# expect <deny|ask|allow> <command>
expect() {
  out=$("$DIR/command.sh" "$2" 2>/dev/null)
  code=$?
  if [ "$code" -eq 2 ]; then got=deny; elif [ -n "$out" ]; then got=ask; else got=allow; fi
  [ "$got" = "$1" ] || { echo "  expected $1, got $got for $2"; failed=1; }
}

expect deny 'git push origin main'
expect deny 'git push origin HEAD:main'
expect deny 'git add . && git push -u origin main'
expect deny 'git push --force origin feat/x'
expect deny 'git push origin +feat/x'
expect deny 'git push -uf origin feat/x'
expect deny 'git commit --no-verify -m x'
expect deny 'git commit -an -m x'
expect deny 'git config core.hooksPath /dev/null'
expect deny 'gh pr merge 3 --squash'
expect deny 'gh pr review 3 --approve'
expect deny 'gh auth token'
expect deny 'echo x > guards/content.txt'
expect deny 'sed -i "" s/a/b/ .githooks/pre-push'
expect deny 'rm .claude/settings.json'
expect deny 'cat .env'
expect deny 'cat app/.env.local'
expect deny 'claude --dangerously-skip-permissions'
expect ask 'gh release create v0.1.0'
expect ask 'git reset --hard origin/main'
expect ask 'rm -rf node_modules'
expect allow 'git push -u origin feat/main-menu'
expect allow 'git push -u origin HEAD'
expect allow 'git commit -m "feat(git): stage a file"'
expect allow 'gh pr create --base main --title x --body-file /tmp/b.md'
expect allow 'cat guards/content.txt'
expect allow 'cat .env.example'
expect allow './scripts/check'

# Content guards on a commit message.
msg=$(mktemp)
trap 'rm -f "$msg"' EXIT
printf 'feat: x\n\nCo-Authored''-By: Claude <noreply@example.invalid>\n' >"$msg"
"$DIR/check.sh" message "$msg" >/dev/null 2>&1 && { echo "  an AI co-author passed the message guard"; failed=1; }
printf 'feat: x\n\nCo-Authored''-By: Ada <ada@example.invalid>\n' >"$msg"
"$DIR/check.sh" message "$msg" >/dev/null 2>&1 || { echo "  a human co-author failed the message guard"; failed=1; }
printf 'feat: worktrees created by Claude sessions show their status\n' >"$msg"
"$DIR/check.sh" message "$msg" >/dev/null 2>&1 || { echo "  product language failed the message guard"; failed=1; }
printf 'fix: path in /Users''/someone/project\n' >"$msg"
"$DIR/check.sh" message "$msg" >/dev/null 2>&1 && { echo "  a home path passed the message guard"; failed=1; }

[ "$failed" -eq 0 ] && echo "guards tests: all passed"
exit "$failed"
