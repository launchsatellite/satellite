# 002 Shell and projects

Status **Done** · Depends on **001**

## Why

Work is spread over several repositories, each in its own editor window. Satellite holds them all in one window, so switching project is one click or one shortcut.

## Scope

- The three columns from `SATELLITE.md`, with the left and right columns resizable within limits and remembered.
- Add a project by choosing a folder or dropping one on the window. The folder must be a git repository. Satellite records its path and writes nothing into it.
- The sidebar lists every project with its main workspace, which is the project's own folder on its current branch.
- Remove a project. It is only forgotten, the folder is untouched.
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

## Not in scope

Worktree workspaces belong to spec 003. The agent pane belongs to spec 004.

## Acceptance

- [x] Adding a repository folder shows it in the sidebar, and it is still there after a restart. Proof, scenario `two-projects` and the `projects` journey, which adds alpha and beta and reads both back after a restart.
- [x] Adding a folder that is not a repository is refused with a sentence that says why. Proof, the same scenario and journey, refusing the plain folder `notes`, and `repository-check.test.ts` with real git, under a German locale too.
- [x] Removing a project leaves its folder byte for byte unchanged. Proof, the `projects` journey, which compares every file of alpha before adding it and after removing it.
- [x] Every command in the registry appears in the command menu and runs from it. Proof, the `projects` journey, which opens the menu with a project selected, finds every available command besides the one that opens it, and runs Remove this project from it. Every command runs through the same menu row.
- [x] The quick switcher reaches a workspace in another project. Proof, the driver, and the `projects` journey selecting alpha from the switcher after beta was added.
- [x] With `claude` missing or `gh` signed out, the first run check names the problem and the next step that fixes it. Proof, scenarios `claude-missing` and `not-signed-in`, and `gh-auth.test.ts`.
- [x] A corrupt state file never stops the app from starting. Proof, `json-file.test.ts` and `interface-file.test.ts` on the reader, and scenario `corrupt-state`, which starts with both files cut off and sets each aside.
