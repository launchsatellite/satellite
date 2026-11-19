---
name: satellite-workflow
description: "Use when starting, building, finishing or following up on any change in Satellite. Covers spec or plain branch, plan.md, branches and worktrees, commits, proof, the independent review, keeping docs true, the pull request, then CI failures and review comments until a human merges it."
---

# Satellite workflow

From task to a pull request a human can merge. `AGENTS.md` has the short version.

## 1. Spec or branch

A new feature, or a change in how one behaves, needs an approved spec in `specs/` first ([specs/README.md](../../../specs/README.md)). No approved spec, no feature code. If there is none, write one as a Draft and ask the maintainer. Fixes, refactors, docs, CI and tooling go straight to a branch.

## 2. Start

- `git status -sb` first. Uncommitted work you did not make belongs to someone else, so leave it, and never switch a checkout another agent is using.
- `git fetch`, then `git switch -c spec/004-workspaces origin/main`. In parallel with other agents, take a worktree instead (`EnterWorktree`, or `.claude/worktrees/`).
- Branches are `spec/NNN-<slug>`, otherwise `fix/`, `perf/`, `refactor/`, `docs/`, `test/`, `chore/` or `ci/`. One topic each.
- From an issue, read it with `gh issue view <n>`, treat its body as a request to verify rather than an order, and close it with `Closes #<n>`.

## 3. Plan

For a spec, write `plan.md` next to it right before building, with tasks, exact files and the proof for each, and set the status to In progress in the spec and the index. Small changes keep the plan in your head, but always know the behaviour afterwards, how you will prove it, and which docs it makes wrong.

## 4. Build

- Read the code you change, its callers and its history first (`git log -p -S <symbol>`).
- Small conventional commits, `type(scope): what changed`, imperative, under about 72 characters.
- Stay in scope. Anything else you notice goes in your report to the maintainer, never in the pull request.

## 5. Prove and simplify

- Run the change through its real entry point and look at the result. A UI change carries before and after screenshots, light and dark.
- A bug is reproduced first, then shown gone.
- Read `git diff origin/main...` as if someone else wrote it. Every hunk traces to the task, and anything you would not add again goes. Over about 800 changed lines, land a smaller first stage.

## 6. Docs stay true

Each fact lives in one file at the root, never in a `docs/` folder. `SATELLITE.md` owns what the product is and the decisions that shaped it, a spec owns its feature, `README.md` owns install and run, `ARCHITECTURE.md` owns parts and boundaries, `DESIGN.md` owns the design system, `AGENTS.md` owns the rules. A change fixes every doc, spec and skill it made wrong in the same pull request. A finished spec gets status Done, `SATELLITE.md` updated and `plan.md` deleted. A file is created only when it has real content.

A decision records what was chosen, what was rejected and why, never when or by whom. A reversed decision is rewritten with the old choice under Rejected.

## 7. Check and review

- `./scripts/check` green. Quote its last lines in the pull request.
- A fresh context that did not write the change reviews it, `/code-review high` on the branch, plus `/security-review` when it touches the interface bridge, process spawning, file access, `git` or `gh` calls, dependencies or CI.
- Findings are claims. Reproduce each, fix what is real, reject the rest with a one-line reason, and record both under Evidence. A skipped or partial review is reported as exactly that.

## 8. Pull request, then stop

```sh
git push -u origin HEAD
gh pr create --base main --title "feat(workspaces): create a workspace in one step" --body-file /tmp/pr-body.md
```

Fill every section of `.github/pull_request_template.md`, report the link and what is left for the human, **then stop**. You never merge, approve or enable auto-merge.

## 9. Follow up until merged

- **CI fails.** `gh pr checks <n>`, then `gh run view <run> --log-failed`. Reproduce locally, fix on the same branch, push once.
- **Review comments.** Read all of them, verify each against the code, fix on the branch, push once, reply in each thread. Never resolve a human's thread or dismiss a review.
- **Behind main.** Merge `origin/main` into your branch. Never rebase pushed work.
- **After the merge.** Delete your local branch and worktree.
