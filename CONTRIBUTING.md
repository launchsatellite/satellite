# Contributing

Satellite is built by people and by coding agents working for them, under the same rules. Agents start from [AGENTS.md](AGENTS.md). This file is the same contract for people, plus what only a maintainer does.

## Setup

Clone, then switch on the Git hooks. Claude Code does this by itself at the start of every session. Then install with Node 24, the version in `.nvmrc`.

```sh
git config core.hooksPath .githooks
npm ci
```

`npm run dev` starts the app. [AGENTS.md](AGENTS.md) lists every command.

## How work happens

1. A new feature starts as a spec in `specs/` and gets the maintainer's approval before anyone builds it ([specs/README.md](specs/README.md)). Fixes, refactors, docs, CI and tooling go straight to a branch.
2. `main` is the only long-lived branch and is always green. One short branch per change, conventional commits.
3. `./scripts/check` passes locally and in CI, and CI runs it and the smoke journeys on macOS, Windows and Linux for every pull request that changes more than docs. Every journey runs on `main` after the merge.
4. The change fixes every doc, spec and skill it made wrong, in the same pull request.
5. A finished branch gets an independent review, then a pull request with the template filled in and a conventional-commit title.
6. **A human merges it.** Pull requests are squash-merged, so the title becomes the one commit on `main`. A maintainer who wants agents to merge their own green pull requests on a machine creates the empty file `~/.config/satellite/merge-granted` there, then asks for the merge in the task. It lives outside the repo, and deleting it takes the grant back. The ruleset on `main` lets only an admin update it, so those merges use `gh pr merge --squash --admin --match-head-commit` with the approved commit.

Tests are written only where they catch a real, likely failure. Most proof comes from running the real app.

## Guards

Small local checks that keep mistakes out of `main`. Each is a plain rule in a text file, so adding one means adding a line.

| File | What it holds | Who runs it |
| --- | --- | --- |
| `guards/content.txt` | patterns that must never be committed, like keys, home-folder paths and AI attribution | `guards/check.sh`, from the pre-commit and commit-msg hooks and `./scripts/check` |
| `guards/commands.txt` | shell commands an agent may never run, or must ask about first | `guards/command.sh`, before every Bash command in Claude Code |
| `.githooks/` | no commits or pushes to `main`, no rewriting pushed work, conventional messages | Git |

Your name, emails and handles go in `.git/info/blocked-literals`, one per line. The guards block them in every commit, and the list itself stays outside Git.

When a guard trips, fix the cause. A key that was ever pushed is compromised, so revoke and rotate it. A false positive is fixed in the rule, by the maintainer, with a case in `guards/test.sh`.

The guards run on the machine the agent controls and match patterns, so they catch mistakes, not a determined bypass. CI runs them again on every pull request, and a human reviews every change.

## Maintainer only

Guard files (`guards/`, `.githooks/`, `.claude/settings.json`) belong to the maintainer. Agents read and run them but never change them. To let an agent change one, move `.claude/settings.json` aside for that session and put it back afterwards. In a real emergency a maintainer can commit or push with `--no-verify`. Agents cannot.

To release, bump `version` in `package.json` and `package-lock.json` in a pull request and merge it. Then tag that commit on `main` as `v` plus the version and push the tag. The release workflow refuses a tag that differs from the version, runs the green checkpoint, checks the fuses and proves each packaged app, then drafts the release. Read the draft, its notes and its checksums, and publish it by hand.
