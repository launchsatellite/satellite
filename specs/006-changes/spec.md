# 006 Changes

Status **Done** · Depends on **003**

## Why

Reviewing what an agent did is the user's main job. Changes shows the work of a workspace as diffs, live, without a trip to another tool.

## Scope

- The Changes tab in the centre column, the default tab of a workspace.
- Two views. Uncommitted shows what differs from the last commit, including untracked files. Branch shows everything the workspace changed against its base branch.
- A file list with Git letters and added and removed line counts, and the diff of the selected file beside it.
- Diffs are read-only, side by side or inline, with syntax highlighting.
- The header shows the branch, its base, and how far it is ahead of and behind its remote.
- The view refreshes when files change on disk and when a session finishes a turn.
- When the base branch has moved and files conflict, a banner says so and offers Send to Claude Code with a request to update from the base branch.
- Selecting lines in a diff and pressing one key sends a reference to those lines into the Claude Code prompt.
- Large and binary files show a sentence instead of a diff.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Review only | Stage, commit, discard, push and pull controls | Agents write. One prepared request replaces each of those controls. |

## Not in scope

Review threads on diff lines belong to spec 008. Conflicts show only as the banner in Changes, and the inbox does not list them.

## Acceptance

- [x] An edited, an added, a deleted and a renamed file each appear with the right letter and diff. Proof, scenario `mixed-changes` and unit tests on the status parser.
- [x] Branch shows commits and uncommitted work against the base in one list. Proof, the same scenario.
- [x] A file changed on disk updates the list without any action. Proof, journey `changes`.
- [x] A base branch that conflicts shows the banner and the request lands in the prompt. Proof, scenario `conflict-with-base`.
- [x] Selected lines arrive in the prompt as a reference to the file and lines. Proof, the driver.
- [x] A file name with spaces, quotes or unicode is listed and opened correctly. Proof, unit tests.
- [x] A binary file and a very large file show a sentence and never freeze the window. Proof, `src/main/changes/file-sides.test.ts`, which answers large past the byte or the line limit and binary for a NUL in the first 8000 bytes.
