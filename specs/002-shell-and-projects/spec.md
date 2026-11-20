# 002 Shell and projects

Status **Approved** · Depends on **001**

## Why

Work is spread over several repositories, each in its own editor window. Satellite holds them all in one window, so switching project is one click or one shortcut.

## Scope

- The three columns from `SATELLITE.md`, with the left and right columns resizable within limits and remembered.
- Add a project by choosing a folder or dropping one on the window. The folder must be a git repository. Satellite records its path and writes nothing into it.
- The sidebar lists every project with its main workspace, which is the project's own folder on its current branch.
- Remove a project. It is only forgotten, the folder is untouched.
- Projects, the selected workspace and the column widths are restored on restart from `~/.satellite`.
- One command registry. Every action is registered once with a plain title, and the command menu, shortcuts and buttons all call it.
- The command menu on Cmd or Ctrl+K lists every command. The quick switcher jumps to any workspace in any project by typing part of its name.
- Light and dark, following the system, with a command to switch.
- A first run check for `git`, `gh` and `claude`. Each is checked for real, and a missing or signed-out tool shows what is wrong and the command that fixes it.
- Empty states for no projects and for a project with nothing selected.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Adding an existing folder as the one way in | Clone and create forms | Each is one line in any terminal and happens once per repository. |
| Plain JSON files in `~/.satellite`, validated on read | A database | Readable, small and enough for a list of paths and a few preferences. |

## Not in scope

Worktree workspaces belong to spec 003. The agent pane belongs to spec 004.

## Acceptance

- [ ] Adding a repository folder shows it in the sidebar, and it is still there after a restart. Proof, scenario `two-projects`.
- [ ] Adding a folder that is not a repository is refused with a sentence that says why. Proof, the same scenario.
- [ ] Removing a project leaves its folder byte for byte unchanged. Proof, a journey that compares the folder before and after.
- [ ] Every command in the registry appears in the command menu and runs from it. Proof, the driver.
- [ ] The quick switcher reaches a workspace in another project. Proof, the driver.
- [ ] With `claude` missing or `gh` signed out, the first run check names the problem and the fix. Proof, scenarios `claude-missing` and `not-signed-in`.
- [ ] A corrupt state file never stops the app from starting. Proof, a unit test on the reader.
