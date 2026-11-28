# 002 Shell and projects

Status **Done** · Depends on **001**

## Why

Work is spread over several repositories, each in its own editor window. Satellite holds them all in one window, so switching project is one click or one shortcut.

## Scope

- The three columns from `SATELLITE.md`, with the left and right columns resizable within limits and remembered.
- Add a project by choosing a folder or dropping one on the window. The folder must be a git repository. Satellite records its path and writes nothing into it.
- Projects are called Repos in every word the interface shows, the sidebar group, Add a repo, Remove this repo, the first-run sentence, dialogs, notifications and accessible names. Code names and test ids stay.
- The sidebar opens with Satellite's lockup at 17px, the Twin mark beside the wordmark, then New workspace as the primary button, one row that opens the command menu, Needs you, then every repo by name with its main workspace, which is the repo's own folder on its current branch, and Agents and Settings in its footer. Labels are sentence case.
- A repo's chevron folds its workspaces for the rest of the run. A folded repo shows its most urgent pixel and how many of its workspaces have a session.
- A workspace row shows one readout, merged, its pull request number, running processes or commits ahead, in that order of precedence, with the rest in its tooltip and accessible name.
- Remove a project from the command menu, the workspace header or the remove button its sidebar row shows under the pointer or keyboard focus, always after a question. It is only forgotten, the folder is untouched.
- Drag a project's row to put it anywhere in the list, or use Move this repo up and Move this repo down. The order is saved.
- Projects, the selected workspace and the column widths are restored on restart from `~/.satellite`.
- One command registry. Every action is registered once with a plain title, and the command menu, shortcuts and buttons all call it.
- The command menu on Cmd+K, or Ctrl+Shift+K on Windows and Linux, lists every command. The quick switcher jumps to any workspace in any project by typing part of its name.
- Light and dark, following the system, with a command to switch.
- A first run check for `git`, `gh` and `claude`. Each is checked for real, and each failing row shows what is wrong and the next step that fixes it, a command where one exists.
- Empty states for no projects and for a project with nothing selected.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Adding an existing folder as the one way in | Clone and create forms | Each is one line in any terminal and happens once per repository. |
| Plain JSON files in `~/.satellite`, validated on read | A database | Readable, small and enough for a list of paths and a few preferences. |
| A repo's row shows its name alone | A generated pixel avatar beside it | The avatar told projects apart by noise, and the name already does. |
| Removing always asks first | Asking only while something runs | One click on a row's small button should never forget a project by surprise. |
| The order is the order of `projects.json` | A separate order field | The list is already ordered, so moving a project changes no data format. |

## Not in scope

Worktree workspaces belong to spec 003. The agent pane belongs to spec 004.

## Acceptance

- [x] Adding a repository folder shows it in the sidebar, and it is still there after a restart. Proof, scenario `two-projects` and the `projects` journey, which adds alpha and beta and reads both back after a restart.
- [x] Adding a folder that is not a repository is refused with a sentence that says why. Proof, the same scenario and journey, refusing the plain folder `notes`, and `repository-check.test.ts` with real git, under a German locale too.
- [x] Removing a project leaves its folder byte for byte unchanged. Proof, the `projects` journey, which compares every file of alpha before adding it and after removing it.
- [x] Removing a project from its sidebar row asks first and then forgets it. Proof, the `projects` journey, which removes the moved beta from its row's button and confirms.
- [x] A project dragged or moved keeps its place after a restart. Proof, the `projects` journey, which runs Move this repo down on alpha and finds beta above it after the restart, and a drag of beta above alpha through the driver, read back after a restart.
- [x] The sidebar opens with the lockup, its mark on the rows' icon edge, then New workspace, the command menu row, Needs you and Repos, with Agents and Settings at the foot. Proof, the agent looking at the real window in light, dark and Dracula at 1100 and 1600 wide.
- [x] Every word a person sees or hears says repo, never project. Proof, the strings in `src/renderer` and `src/main` and their tests.
- [x] A workspace row reads one readout and keeps the rest in its summary. Proof, the `workspaces` journey, which reads an uncommitted file in the row's summary after a restart.
- [x] A folded repo shows its most urgent pixel and its count of workspaces with a session. Proof, scenario `title-bar` with main asking for permission and its repo folded.
- [x] Every command in the registry appears in the command menu and runs from it. Proof for one command only, the `projects` journey runs Remove this project from the menu.
- [x] The quick switcher reaches a workspace in another project. Proof, the driver, and the `projects` journey selecting alpha from the switcher after beta was added.
- [x] With `claude` missing or `gh` signed out, the first run check names the problem and the next step that fixes it. Proof, scenarios `claude-missing` and `not-signed-in`, and `gh-auth.test.ts`.
- [x] A corrupt state file never stops the app from starting. Proof, `json-file.test.ts` and `interface-file.test.ts` on the reader, and scenario `corrupt-state`, which starts with both files cut off and sets each aside.

## Next

- A workspace row whose pull request has nothing blocking it reads Ready. Part of [015 Layout](../015-layout/spec.md).
- Clicking a repo row opens the repo view from 015.
