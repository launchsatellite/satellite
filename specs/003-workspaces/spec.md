# 003 Workspaces

Status **Done** · Depends on **002**

## Why

Two agents in one folder overwrite each other. A workspace gives each piece of work its own worktree and branch, created in one step, so parallel work is safe by default.

## Scope

- New workspace from a project in one action. The name is generated and can be changed before creating. The branch takes the same name.
- The branch starts from the latest default branch on the remote, or as a new branch at an existing branch chosen from a list.
- The worktree is created under `~/.satellite/worktrees/<project>/<workspace>`, never inside the repo.
- Ignored files matching the project's `.worktreeinclude` are copied into the new worktree.
- Each step of creation is visible, and a failure says what happened and leaves nothing half made. The repository's own hooks run as they would in a terminal, and Cancel stops a running creation and undoes it.
- The sidebar shows each workspace under its project with its branch, how far it is ahead of and behind its remote, and its count of changed files. In a repository with a remote, a branch that was never pushed shows its commits that are on no remote.
- Archive a workspace, from the command menu, the workspace header or the archive button its sidebar row shows under the pointer or keyboard focus. Satellite first shows what would be lost, meaning uncommitted changes, commits that are not pushed and anything it cannot rule out. It then stops Satellite's terminals in the workspace and removes the worktree, its ignored files included. The branch stays. A worktree git has locked, one with submodules checked out, one holding a folder from another drive or one Satellite cannot check whole is not archived.
- On every list Satellite compares its records with what `git` reports. A workspace whose folder was removed outside the app, Satellite's whole worktrees folder included, is dropped from the list with a sentence, and a branch already checked out elsewhere is explained in it instead of failing. A worktree in the project's own worktrees folder with no record shows up as a workspace. So does every other worktree git lists for the project on a branch, such as one an agent made in `.claude/worktrees`, under its folder name made safe. Satellite archives only workspaces in its own worktrees folder, never one elsewhere nor one whose folder holds a worktree from elsewhere, and a worktree from elsewhere that leaves git leaves the list quietly.
- A project's main workspace cannot be archived, and a project that still has workspaces in Satellite's own worktrees folder cannot be removed until they are archived, unless its folder is gone. Worktrees from elsewhere never hold it back.
- A project holds at most 20 workspaces Satellite made besides its main one, and shows at most 30 worktrees made outside it, 50 in all, so those never take room from a new workspace. One creation runs per project and four at once.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Creation runs no setup command | Per project setup and cleanup commands | The user's agent and hooks own setup. Satellite stays a thin layer. |
| Every worktree git lists on a branch shows as a workspace, a detached one stays out since a workspace is a branch, Archive only for those in Satellite's own worktrees folder | Only Satellite's own worktrees, or archive for all | An agent that splits a task into worktrees is the common case, and removing a folder Satellite did not make is the agent's call. |
| Archive keeps the branch | Deleting the branch | Removing a worktree is safe to undo, deleting a branch is not. |
| Starting from an existing branch makes a new branch at it | Checking out the chosen branch itself | The branch takes the workspace's name, and git refuses a branch checked out in two worktrees. |
| The repository's hooks run during creation, and the dialog says so | Turning hooks off | Setup belongs to the user's hooks, and creation is `git worktree add` as the user would run it. |
| Archive deletes ignored files with the folder, and the dialog says so | Keeping them | A worktree folder cannot be kept without its checkout, and dependencies and build output can be rebuilt. |
| A worktree with submodules checked out is not archived | Forcing its removal | git would delete each submodule's own history with it. |

## Not in scope

Starting sessions in the workspace belongs to spec 004.

## Acceptance

- [x] Creating a workspace makes the worktree and branch from the remote default branch and selects it. Proof, scenario `fresh-repo` and the `workspaces` journey, which makes first-look from the dialog, sees it selected and announced, and finds `second commit` from the fetched main in its worktree, and `create-steps.test.ts` with real git.
- [x] Files listed by `.worktreeinclude` are present in the new worktree and other ignored files are not. Proof, `worktree-include.test.ts` on the matcher, `include-copy.test.ts` on the copy, and the `workspaces` journey, which finds `.env` and `config/dev.local.json` in first-look and no `notes.log`, `node_modules` or `scratch.txt`.
- [x] A name that is not a valid branch or that escapes the worktrees folder is refused. Proof, `workspace-name.test.ts`, `worktree-folders.test.ts` and `registry.test.ts`, and the `boundary` journey, where `workspaces.create` refuses `../../outside` and `-x` and no worktrees folder appears.
- [x] Archive lists uncommitted files and commits that are not pushed before anything is removed. Proof, scenario `unpushed-work`, `workspace-archive.test.ts`, and the `workspaces` journey, whose archive dialog lists `?? src/only-here.ts` and the commit `keep this commit` before it is confirmed.
- [x] After archive the worktree is gone, `git worktree list` is clean and the branch exists. Proof, the `workspaces` journey, which finds the folder gone, no worktree line for first-look and `refs/heads/first-look` still at `keep this commit`, and `workspace-archive.test.ts`.
- [x] A worktree an agent makes in the project shows up as a workspace with no Archive, and leaves quietly once the agent removes it. Proof, the `projects` journey, which adds one in `.claude/worktrees` and removes it, and `project-list.test.ts`.
- [x] A worktree deleted outside the app disappears from the sidebar on the next start. Proof, the `workspaces` journey, which deletes second-look while the app is closed and finds it gone after the restart with its sentence, and `project-list.test.ts`.
- [x] Two workspaces of one project hold different files at the same time. Proof, the `workspaces` journey, where a file written in first-look is absent from second-look and the repo, and each holds the files of its own start.
