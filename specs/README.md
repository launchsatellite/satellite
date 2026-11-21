# Specs

One folder per feature, numbered in build order. `SATELLITE.md` says what the product **is**. A numbered spec says what one feature **adds** and why, precisely enough for an agent to build it without asking.

## What gets a spec

A feature, meaning something a person using Satellite can do afterwards that they could not before, or a change in how a feature behaves for them. A workspace action, a pane, a git view, a command, the agent status.

Everything else goes straight to a branch with the docs it touches updated in the same change. Bug fixes, refactors, performance work, tests, docs, CI, guards and tooling. Spikes too, with what they taught recorded in the spec or doc it concerns. When unsure, ask "does this change what someone can do with Satellite?" If not, it is not a spec.

## Lifecycle

| Status | Set by | Meaning |
| --- | --- | --- |
| Draft | author | being written |
| Approved | maintainer | may be planned and built |
| In progress | builder | `plan.md` exists and a `spec/NNN-<slug>` branch is open |
| Done | builder, in the pull request | merged, and `SATELLITE.md` reflects it |
| Dropped | maintainer | abandoned, keeps its number |

The status lives in the spec and in the index below. Change both together.

## Steps

1. Copy `_template/` to `specs/NNN-<slug>/` with the next number. Fill Why, Scope, Not in scope and Acceptance on one page. Status Draft.
2. Open it as its own pull request on `spec/NNN-<slug>`, with the spec's row added to the index below. The maintainer reviews it, sets status Approved and merges it. Numbers follow merge order, so a clash is fixed in review by taking the next free one.
3. Right before building, write `plan.md` next to the spec, with tasks, exact files and the proof for each. Status In progress.
4. Build on `spec/NNN-<slug>` from an up-to-date `main` (skill `satellite-workflow`). Every acceptance item is proven in the real app, by a command, or by a test where one is worth it.
5. The pull request that finishes the feature updates `SATELLITE.md` and any doc it touched, sets status Done and deletes `plan.md`. Git keeps the plan.

## One living spec per feature

A spec describes its feature as it is now. A later change to that feature edits its spec in place instead of opening a new one. Proposals wait under Next until the maintainer approves them, then move into Scope and Acceptance and the status returns to Approved.

Numbers are identifiers. They are never reused or renumbered, so "spec 004" always means the same feature.

## Index

| # | Spec | Status |
| --- | --- | --- |
| 001 | [Foundation](001-foundation/spec.md) | Done |
| 002 | [Shell and projects](002-shell-and-projects/spec.md) | Done |
| 003 | [Workspaces](003-workspaces/spec.md) | Done |
| 004 | [Claude Code sessions](004-claude-code-sessions/spec.md) | Done |
| 005 | [Inbox and notifications](005-inbox-and-notifications/spec.md) | Done |
| 006 | [Changes](006-changes/spec.md) | Done |
| 007 | [Files](007-files/spec.md) | Done |
| 008 | [Pull request](008-pull-request/spec.md) | Done |
| 009 | [Running processes](009-running-processes/spec.md) | Approved |
