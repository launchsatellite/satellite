# 003 Workspaces

Status **Approved** · Depends on **002**

## Why

Two agents in one folder overwrite each other. A workspace gives each piece of work its own worktree and branch, created in one step, so parallel work is safe by default.

## Scope

- New workspace from a project in one action. The name is generated and can be changed before creating. The branch takes the same name.
- The branch starts from the latest default branch on the remote, or from an existing branch chosen from a list.
- The worktree is created under `~/.satellite/worktrees/<project>/<workspace>`, never inside the repo.
- Ignored files matching the project's `.worktreeinclude` are copied into the new worktree.
- Each step of creation is visible, and a failure says what happened and leaves nothing half made.
- The sidebar shows each workspace under its project with its branch, how far it is ahead of and behind its remote, and its count of changed files.
- Archive a workspace. Satellite first shows what would be lost, meaning uncommitted changes and commits that are not pushed. It then stops the workspace's sessions and processes and removes the worktree. The branch stays.
- On start Satellite compares its list with what `git` reports. A worktree removed outside the app is dropped from the list, and a branch already checked out elsewhere is explained instead of failing.
- A project's main workspace cannot be archived.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Creation runs no setup command | Per project setup and cleanup commands | The user's agent and hooks own setup. Satellite stays a thin layer. |
| Archive keeps the branch | Deleting the branch | Removing a worktree is safe to undo, deleting a branch is not. |

## Not in scope

Starting sessions in the workspace belongs to spec 004.

## Acceptance

- [ ] Creating a workspace makes the worktree and branch from the remote default branch and selects it. Proof, scenario `fresh-repo`.
- [ ] Files listed by `.worktreeinclude` are present in the new worktree and other ignored files are not. Proof, a unit test on the matcher and the same scenario.
- [ ] A name that is not a valid branch or that escapes the worktrees folder is refused. Proof, unit tests.
- [ ] Archive lists uncommitted files and commits that are not pushed before anything is removed. Proof, scenario `unpushed-work`.
- [ ] After archive the worktree is gone, `git worktree list` is clean and the branch exists. Proof, the same scenario.
- [ ] A worktree deleted outside the app disappears from the sidebar on the next start. Proof, a journey.
- [ ] Two workspaces of one project hold different files at the same time. Proof, a journey.
