# 007 Files

Status **Done** · Depends on **003**

## Why

Sometimes the user needs to read the code as it is, not as it changed. Files is a fast reader for the workspace, and agents stay the only way to change it.

## Scope

- Files is a tab of the rail beside Changes and Ready, with its own actions in a bar under the rail's tabs. The chosen tab stays while you switch workspaces, unless an inbox row opens Ready because the pull request needs you. A tree of the workspace folder as it is on disk, like a code editor's explorer. Files that git ignores are dimmed, changed files carry their Git letter, and each file and folder has an icon for its kind.
- Folders load when opened, so large repositories stay fast.
- Open a file by clicking it, or by name with one shortcut and fuzzy matching.
- Files open read-only with syntax highlighting. Several can stay open as tabs, remembered per workspace.
- The tree and open files update when an agent changes them on disk.
- Selecting lines and pressing one key sends a reference to those lines into the Claude Code prompt.
- Images are shown. Other binary files and very large files show a sentence instead.
- Files sits in the rail as the tree with Find a file on Cmd+F, and a file opens as a tab in the centre's strip beside the sessions.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Read-only | Editing and file operations | Agents write. See `SATELLITE.md`. |
| The chosen rail tab stays across workspaces, unless an inbox row opens Ready because the pull request needs you | The same tab again on every switch | Keeping the chosen tab lets you compare one view across workspaces. |
| The tree in the rail, an opened file in the centre | Tree and file side by side in the centre | Claude Code keeps the centre, and a file is read beside it as a tab. |

## Not in scope

Diffs belong to spec 006.

## Acceptance

- [x] Files is a named rail tab, its tree in the rail and an opened file in the centre's strip. Proof, the `files` journey and the agent looking at the real window in light, dark and at 960 by 600.
- [x] The tree shows tracked, untracked and ignored files, with ignored ones dimmed and an icon for each kind. Proof, scenario `mixed-changes`.
- [x] Open by name finds a file deep in the tree. Proof, the driver.
- [x] A file changed on disk updates in its open tab. Proof, journey `files`.
- [x] No path from the interface can read outside the workspace folder, including through a symlink. Proof, unit tests on the path check.
- [x] Selected lines arrive in the prompt as a reference. Proof, the driver.
- [x] Typing in an open file changes nothing. Proof, the driver.

