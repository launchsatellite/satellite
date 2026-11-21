# 007 Files

Status **Done** · Depends on **003**

## Why

Sometimes the user needs to read the code as it is, not as it changed. Files is a fast reader for the workspace, and agents stay the only way to change it.

## Scope

- The Files tab in the centre column. A tree of the workspace folder as it is on disk, like a code editor's explorer. Files that git ignores are dimmed, changed files carry their Git letter, and each file and folder has an icon for its kind.
- Folders load when opened, so large repositories stay fast.
- Open a file by clicking it, or by name with one shortcut and fuzzy matching.
- Files open read-only with syntax highlighting. Several can stay open as tabs, remembered per workspace.
- The tree and open files update when an agent changes them on disk.
- Selecting lines and pressing one key sends a reference to those lines into the Claude Code prompt.
- Images are shown. Other binary files and very large files show a sentence instead.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Read-only | Editing and file operations | Agents write. See `SATELLITE.md`. |

## Not in scope

Diffs belong to spec 006.

## Acceptance

- [x] The tree shows tracked, untracked and ignored files, with ignored ones dimmed and an icon for each kind. Proof, scenario `mixed-changes`.
- [x] Open by name finds a file deep in the tree. Proof, the driver.
- [x] A file changed on disk updates in its open tab. Proof, a journey.
- [x] No path from the interface can read outside the workspace folder, including through a symlink. Proof, unit tests on the path check.
- [x] Selected lines arrive in the prompt as a reference. Proof, the driver.
- [x] Typing in an open file changes nothing. Proof, the driver.
