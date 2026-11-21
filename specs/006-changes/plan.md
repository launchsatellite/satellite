# Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The centre column of a workspace opens on the Changes tab. A file list with Git letters and added and removed line counts sits beside a read-only Monaco diff of the selected file, side by side or inline, with syntax highlighting. Branch shows everything the workspace changed against its base branch, commits and uncommitted work in one list, and Uncommitted shows what differs from the last commit, untracked files included. The workspace header names the branch, its base and how far it is ahead of and behind its remote. The view refreshes by itself while it is visible and when a session finishes a turn. When the base moved and files conflict, a banner says so and offers Send to Claude Code with a request to update from the base. Selected diff lines go into the Claude Code prompt as a reference with one key. Binary, large and other unshowable files show one sentence instead of a diff.

**Architecture:** The background process does every read. A new feature folder `src/main/changes/` reads the change list with one `git diff --raw --numstat -z` against `HEAD` or the merge base plus one `git ls-files --others -z`, resolves the base from what git already knows locally, checks conflicts with `git merge-tree --write-tree` in memory with its new objects sent to a throwaway folder in the Satellite home, and reads each side of one file, the committed side as a blob by object name and the worktree side from disk through a confinement that refuses every link and `.git`. Two bridge channels expose it, `changes.list` and `changes.file`. The page never names a git argument or a path git did not list, because `changes.file` answers only for a path the same page's last `changes.list` of that workspace and view returned. The interface lazy loads Monaco's diff editor with Monarch syntax definitions, polls `changes.list` on an adaptive timer only while the document is visible, and refetches the shown file only when its stamp changes. No file watcher, no new event, no new state file.

**Tech Stack:** As in spec 005. Electron 45.3.4, React 19.3.1, TypeScript 6.0.3, zod 4.6.7, Tailwind 4.3.5, Vitest 5.1.0, playwright-core 1.65.1, Node 24, git 2.31 or newer. Monaco is `monaco-editor` 0.57.0, already a dev dependency, the latest stable on npm, MIT. No new dependency of any kind.

**Spec:** `specs/006-changes/spec.md`

## What this writes and where

- Nothing new in any state file and nothing in any repository's working files, index or refs.
- `<home>/quarantine/<uuid>/` exists only while one conflict check runs. git writes the merged trees and blobs of that in-memory merge there instead of into the repository's object store, and Satellite deletes the folder when the check ends. The first check of each run deletes `<home>/quarantine` whole, so a crash leaves nothing behind for long.
- A repository's own config can still make `git diff` start its clean or process filter, the same program `git status` already may start (ARCHITECTURE Projects, Reads). Nothing else any new read does can start a program the repository names.

## Rulings checked

Each was checked against current documentation or the installed source while planning.

- **Monaco is already the decided diff component.** `ARCHITECTURE.md` Diff and `SATELLITE.md` Decisions name it, so no other editor was compared. `npm view monaco-editor version` answers `0.57.0` (`next` is `0.58.0-rc.2`), its `package.json` says MIT, and its CHANGELOG says 0.56 split the ESM build into supported entry points, `monaco-editor/editor`, `monaco-editor/features/<feature>/register` and `monaco-editor/languages/definitions/<language>/register`.
- **Languages load only when used.** Each `languages/definitions/<id>/register.js` calls `registerLanguage({ id, extensions, aliases, loader: () => import('./<id>.js') })`, so `languages/definitions/register.all` adds only the small registrations and Vite splits every Monarch tokenizer into its own chunk, loaded the first time a model of that language is made. The definitions total 1.4 MB unminified on disk and none is fetched until used. The `languages/features` workers (TypeScript, CSS, HTML, JSON) are not imported, so no language service and no extra worker runs.
- **The content security policy holds.** A search of `node_modules/monaco-editor/esm` finds `new Function` only in `languages/features/typescript/lib/lib.js`, which is not imported, and no `eval(`. Monarch builds its patterns with `new RegExp`, which `script-src 'self'` allows. Chunks and the existing editor worker load from `app://satellite` under `script-src 'self'` and `worker-src 'self'`, and the codicon font under `font-src 'self'`. Styles stay under the existing `'unsafe-inline'`.
- **Diff options (`esm/vs/editor/common/config/diffEditor.js`).** Defaults are `maxComputationTime: 5000`, `maxFileSize: 50` (MB), `renderSideBySide: true`, `useInlineViewWhenSpaceIsLimited: true`, `renderSideBySideInlineBreakpoint: 900`, `renderIndicators: true`, `diffAlgorithm: 'advanced'`, `hideUnchangedRegions.enabled: false` with `contextLineCount: 3`, `minimumLineCount: 3`, `revealLineCount: 20`. `originalAriaLabel` and `modifiedAriaLabel` exist in `monaco.d.ts`. The diff runs in the editor worker.
- **Revealing hidden characters.** `renderControlCharacters` defaults to true, and `isControlCharacter` in `viewLineRenderer.js` draws C0 controls, DEL, U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F and U+061C visibly. Zero-width and look-alike characters are boxed by the `unicodeHighlight` options (`invisibleCharacters`, `ambiguousCharacters`), which need `features/unicodeHighlighter/register`.
- **Keyboard, screen readers and read only.** `features/diffEditor/register` registers the accessible diff viewer on F7 and Shift+F7. Its Revert Block and Revert Selection menu items require `diffEditorModifiedWritable`, so a read-only diff never shows them. `domReadOnly` sets `readonly` on Monaco's input textarea, and `editContext` defaults to true, where focus sits on a div that is no input. `tabFocusMode` and `dropIntoEditor` exist in `monaco.d.ts`.
- **Claude Code file references (code.claude.com/docs/en/common-workflows, Reference files and directories).** `@path` includes the file's current content, paths may be relative or absolute, and no line range syntax and no quoting for spaces is documented. A reference to lines on the committed side would point `@` at the wrong text. So the reference is plain words that name the path and the lines, which Claude Code reads with its own tools.
- **git diff (git-scm.com/docs/git-diff).** `git diff <commit>` compares the commit with the working tree. With `-z`, `--raw` and `--numstat` print names verbatim with NUL terminators, a numstat rename record is `added TAB deleted TAB NUL old NUL new NUL`, and binary files show `-` for both counts. `--no-ext-diff` disallows external diff drivers, `--no-textconv` disallows text conversion filters, `--no-relative` cancels `diff.relative`, and `--ignore-submodules=dirty` shows only submodule commits. A run of git 2.50.1 here confirmed raw records abbreviate object names to 7 digits unless `--no-abbrev` is given, and showed the exact byte layout the parser expects (Task 2).
- **git ls-files.** `ls-files --others --exclude-standard -z` lists untracked files not ignored, NUL separated, and a nested repository as its folder with a trailing `/`, confirmed on git 2.50.1.
- **git merge-tree (git-scm.com/docs/git-merge-tree, RelNotes 2.38.0).** `--write-tree` "does not read from or write to either the working tree or index" and creates a new toplevel tree object, so it writes objects. `--quiet` avoids writing only "most objects" and prints nothing, so it cannot count files. With `--name-only -z --no-messages` it prints the tree, then each conflicted name once, NUL terminated. Exit 0 is clean, 1 is conflicted, anything else is an error. The mode arrived in 2.38.
- **No merge driver and no object written (RelNotes 2.41.0, and a run here).** `git --attr-source=<tree>` makes any command read attributes from that tree, new in 2.41. With the empty tree as the source no `merge=` attribute applies, so no merge driver runs. A run on git 2.50.1 with `.gitattributes` saying `* merge=evil` and `merge.evil.driver` touching a marker file, and with `GIT_OBJECT_DIRECTORY` set to a temp folder and `GIT_ALTERNATE_OBJECT_DIRECTORIES` to the repository's objects, listed the conflicted file, left the marker absent and the repository's object count unchanged, wrote two objects to the temp folder, while the same command without them ran the driver. The empty tree is `4b825dc642cb6eb9a060e54bf8d69288fbee4904` for SHA-1 and `6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321` for SHA-256, the second confirmed with `git hash-object -t tree`.
- **File watching was weighed and rejected.** Node's recursive `fs.watch` uses FSEvents on macOS and ReadDirectoryChangesW on Windows but on Linux walks the tree and adds one inotify watch per folder, so a `node_modules` reaches the per-user watch limit. Watches on network drives miss changes, and every git command an agent runs writes `.git/index` and refs, which a watcher sees. A timer that runs only while the view is visible behaves the same on all three systems.

## Decisions the plan made

| Decision | Why | Cost if wrong |
| --- | --- | --- |
| The base is the remote's default branch as git records it now, `refs/remotes/<origin or the only remote>/HEAD`, else the branch the project's main folder has checked out. The main workspace without that remote ref has no base. Nothing is stored | It is what creation starts from, it needs no network and no new state, and it follows a default branch that changes upstream | A workspace made from another branch compares with the default branch. Branch then shows that other branch's commits too |
| Branch compares the merge base of `HEAD` and the base with the working tree, untracked files added | Exactly what the workspace changed, commits and uncommitted work in one list, as the spec asks | None |
| Uncommitted compares `HEAD` with the working tree, staged and unstaged together, untracked added | Review only, there is nothing to stage, so the index split means nothing here | None |
| A branch with no commit yet shows a sentence instead of a list | Workspaces always start from a commit, so only a main folder of an empty repository meets it | That folder's first files are not listed until its first commit |
| Untracked files read as `A`, with `tracked: false` named in the row's accessible name | They are added relative to the commit in both views, and git's `?` reads as noise | A user who wants to see what git tracks reads the row's name |
| Renames on with `-M`, copies off | Renames are what an agent's `git mv` makes. Copy detection costs a pass over every unmodified file | A copy reads as an addition |
| The diff reads keep git's clean and process filters | They are the same program `git status` already runs, only the repository's config can name one, and turning them off would misread every git-lfs file | A hostile local config could start a program on a diff read, as on a status read today |
| The conflict check reads attributes from the empty tree, so no merge driver runs, and sends merge objects to `<home>/quarantine/<uuid>` | Reading must never run a program the repository chose or write into it | A file whose own merge driver would resolve it reads as conflicting |
| The conflict check needs git 2.41, and on an older git the banner never shows | `--attr-source` is the only way to keep merge drivers out | The git Apple ships with its developer tools is 2.39, so those users get no banner until they install a newer git |
| The banner shows in both views, only when the base has moved past the merge base | One `merge-tree` per list at most, none while the branch already contains the base | None |
| The banner is grey, `bg-side` with `text-fg2` | `DESIGN.md` keeps signal for when the user is the blocker, and the agent can update the branch without the user | None |
| Refresh polls `changes.list` every 2 seconds while the document is visible, the wait growing to four times the last read up to 30 seconds, plus at once on window focus, on returning visible and when a session in the workspace turns `done` | Correct on every system, every drive and every repository size, no watcher limits, no loop with git's own writes | A change shows up to 2 seconds late, and a visible Satellite runs one diff read per tick |
| The shown file is refetched only when its `stamp` changes, the compared object name plus the worktree file's size and modification time | A refresh never reloads two megabytes or resets the diff's scroll for nothing | An edit that keeps size and modification time to the nanosecond is missed until the next change |
| `changes.file` answers only paths in the same page's last `changes.list` for that workspace and view, with the object names from that list | The page cannot name any file git did not report changed, nor any object | A file listed a moment ago and gone since answers not found until the next list |
| Limits are 1000 files listed, 5000 records parsed, 1 MiB and 20000 lines per side, untracked line counts for at most 200 files and 8 MiB in total, four reads at once across the app | Monaco stays fast and the background process never holds more than a few megabytes per read | A very large file or a 1001st file needs the agent or another tool |
| Reads are owned per page. A new list for another workspace or view aborts the page's older ones, a new file read aborts the older file read | Moving on never leaves work running for a screen nobody sees | A very slow repository can be read twice when the user flips views quickly |
| Syntax highlighting uses weight and greys from the app tokens, keywords `fg` bold, strings and numbers `fg2`, comments `dim` italic | `DESIGN.md` keeps colour for state, and the diff's ultraviolet and orange already carry the change | Less colour than the editors users know |
| Inline is a choice the user makes, never Monaco's narrow-width switch | The narrow switch hides which side a line belongs to without warning | None |
| Views and layout are page-load state, Branch and side by side first | No data format change, and Branch shows the whole work of a workspace | The choice resets on reload |
| The line reference is Satellite's own sentence, `Lines 12 to 18 of src/app.ts in this workspace. ` and its committed-side variants, with the path quoted as dropped paths are | Claude Code documents no line range syntax, `@` would attach the wrong version for the committed side, and the words start no input mode | Claude Code reads the file with a tool instead of having it attached |
| A path holding a character Send to Claude Code removes, or a reference over 800 characters, is refused with a toast | Cleaning would silently point at another path | Such files need words typed by hand |
| Every name Satellite draws, file, branch and base, goes through `visibleText`, which writes each control, format, separator, surrogate and variation selector character as `[U+XXXX]` | A direction mark or zero-width character can never disguise a name in the list, the header or the banner | A name with an emoji joiner shows `[U+200D]` |
| One centre tab strip with the single tab Changes | The spec calls it a tab, and specs 007 and 008 add theirs beside it | A strip with one tab |

## Global Constraints

Every task is bound by `.superpowers/sdd/global-constraints.md`, `AGENTS.md`, `.claude/skills/satellite-conventions/SKILL.md`, `.claude/skills/satellite-stack/SKILL.md` and `.claude/skills/satellite-verify/SKILL.md`. No comments, no casts, no `any`, kebab-case files, named exports, tests only where listed and each seen failing once, no home-folder paths in any file, never push. Never read or write the real `~/.satellite`, `~/.claude` or `~/.claude.json`. Never run `npm run dev`, never set `SATELLITE_VERIFY_FOREGROUND`, launch the app only through the verify driver, and before the final report list processes whose command is this repo's `node_modules/electron` binary and confirm none is left. Never run a recursive delete by hand, the code's own `fs.rm` of its quarantine folder is the only one.

### Limits

In `src/shared/bridge-contract.ts`, read by both processes.

```ts
export const changesLimits = {
  files: 1000,
  parsed: 5000,
  sideBytes: 1_048_576,
  sideLines: 20_000,
  countedFiles: 200,
  countedBytes: 8_388_608,
  binaryProbe: 8000,
  pathChars: 4096,
  linkChars: 4096,
  stampChars: 200,
};
```

- `changesReadMs = 15_000` in `src/main/changes/change-list.ts`, for the diff and the untracked list. Every other new git read uses `gitReadMs` (5 seconds). `conflictReadMs = 15_000` in `src/main/changes/conflict-check.ts`.
- `changesReadSlots = 4` in `src/main/changes/changes-handlers.ts`, one `createReadQueue(4, 16)` from `src/main/changes/read-queue.ts` shared by every list and file read across the app, at most 16 waiting, a stopped read leaving the queue at once.
- `cachedLists = 8` per page.
- `changesPollMs = 2000`, `changesPollMaxMs = 30_000`, `changesPollFactor = 4` in `src/renderer/changes/use-changes.ts`.
- `oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/` in `src/main/changes/file-sides.ts`. An all-zero name means none.
- Sorting is by path in UTF-16 code unit order (`a < b ? -1 : a > b ? 1 : 0`), so every system lists the same order.

### Paths

- A change path is git's own, relative to the worktree root with `/` separators. `isChangePath(path, platform)` accepts it only when it is 1 to `pathChars` characters, holds no NUL, does not start with `/`, is not absolute for `posix` or `win32`, has no drive prefix `^[A-Za-z]:`, holds no `\` on Windows, and every `/` segment is non-empty, not `.`, not `..` and not `.git` in any letter case.
- The worktree side is read only when the real path of the file's parent folder equals, by `samePath`, the worktree's real path joined with the parent part of the path, so no folder on the way is a link or junction. The file itself is opened with `noFollow | nonBlocking | noTerminal`, must be a regular file whose 64-bit device and inode equal its `lstat`, and must not change size or modification time while it is read. A link as the file itself is never followed, its target text is what shows.

### Contract

In `src/shared/bridge-contract.ts`.

```ts
export type ChangesView = z.output<typeof changesView>;
export type ChangeLetter = z.output<typeof changeLetter>;
export type ChangedFile = z.output<typeof changedFile>;
export type ChangesList = BridgeResponse<"changes.list">;
export type FileSides = BridgeResponse<"changes.file">;

export const changesView = z.enum(["branch", "uncommitted"]);
export const changeLetter = z.enum(["A", "M", "D", "R", "C", "T", "U"]);
const changePath = z.string().min(1).max(changesLimits.pathChars);
const shortOid = z.string().regex(/^[0-9a-f]{7}$/);
const sideText = z.string().max(changesLimits.sideBytes);
export const changedFile = z.strictObject({
  path: changePath,
  from: changePath.nullable(),
  letter: changeLetter,
  tracked: z.boolean(),
  kind: z.enum(["text", "binary", "submodule", "repository"]),
  added: count.nullable(),
  removed: count.nullable(),
  stamp: z.string().min(1).max(changesLimits.stampChars),
});
```

Requests, added to `bridgeRequests`.

```ts
"changes.list": {
  request: z.strictObject({ workspace: workspaceRef, view: changesView }),
  response: z.strictObject({
    branch: z.string().min(1).max(255).nullable(),
    base: z.string().min(1).max(255).nullable(),
    ahead: count.nullable(),
    behind: count.nullable(),
    conflict: z.strictObject({ files: z.int().min(1).max(1_000_000) }).nullable(),
    changes: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("files"),
        files: z.array(changedFile).max(changesLimits.files),
        more: count,
        longPaths: count,
      }),
      z.strictObject({
        kind: z.literal("unavailable"),
        reason: z.enum(["no-commits", "no-base", "unrelated", "not-local", "too-many", "hung", "failed"]),
      }),
    ]),
  }),
},
"changes.file": {
  request: z.strictObject({ workspace: workspaceRef, view: changesView, path: changePath }),
  response: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("text"), original: sideText, modified: sideText }),
    z.strictObject({ kind: z.literal("binary") }),
    z.strictObject({ kind: z.literal("large") }),
    z.strictObject({ kind: z.literal("submodule"), from: shortOid.nullable(), to: shortOid.nullable() }),
    z.strictObject({ kind: z.literal("repository") }),
    z.strictObject({ kind: z.literal("unmerged") }),
    z.strictObject({ kind: z.literal("changing") }),
    z.strictObject({ kind: z.literal("hung") }),
    z.strictObject({ kind: z.literal("not-local") }),
    z.strictObject({ kind: z.literal("unreadable") }),
  ]),
},
```

- `branch` is `git branch --show-current` in the worktree, `null` when detached. `base` is the base's short name, `origin/main` for `refs/remotes/origin/main`, `main` for `refs/heads/main`. `ahead` and `behind` follow the sidebar's rule, against the upstream, or without one `ahead` counts the commits on no remote and `behind` is `null`, both `null` without a remote.
- `conflict` is `null` until Task 7.
- `longPaths` counts the files whose path or former path is longer than `pathChars`, left out of `files`. `not-local` is a list git cannot build because a partial clone never downloaded its objects, `too-many` one whose git output passed the 16 MiB `runTool` reads, `hung` one whose git ran out of time or found git stuck in that folder. A file listed twice, deleted from the index and untracked on disk, is listed once as its tracked record. A file the index holds in merge stages is `U`.
- `hung` is a side whose read did not finish in time, `not-local` a committed side a partial clone never downloaded.
- An added file's `original` and a deleted file's `modified` are `""`.
- No new event. `window.satellite` keeps its three functions.

### Background failures

Thrown as `BridgeFailure` from `src/main/changes/changes-handlers.ts`.

- Folder gone, `not-found`, `That workspace's folder is gone, so Satellite can't show its changes.`
- Being archived, `refused`, `Satellite is archiving that workspace, so its changes can't be read.`
- A path the last list did not name, `not-found`, `That file is no longer in the list of changes. The list refreshes in a moment.`
- An aborted read, `refused`, `Satellite moved on to a newer read.` The page ignores answers to requests it superseded, so this sentence is never shown.
- More than 16 reads waiting, `limit`, `Satellite is reading a lot of changes at once. It tries again in a moment.`
- git missing, the existing `tool-missing` from `runGit`.

### What a page running hostile script could do

Recorded in `ARCHITECTURE.md` Changes and Bridge.

- **Read files.** Only those git reports changed or untracked and not ignored in a workspace Satellite lists, inside that worktree, plus their committed version, each side at most 1 MiB. It cannot name another path, an object, a git argument or a program. A link shows its target text, a link anywhere above the file refuses the read, `.git` is refused by name, and a pipe or device is never opened. That page could already read every one of those files through `terminal.write` and Claude Code's shell.
- **Learn metadata.** The size and modification time of listed files, folded into `stamp`.
- **Load the machine.** Each request costs at most one bounded read in one of four shared slots, with git's time limits, and a page's newer request aborts its older ones. It can keep four git processes busy, which typing into Claude Code can exceed.
- **Write.** Nothing in any repository. The conflict check writes only into `<home>/quarantine/<uuid>`, a name the background process makes.

### Copy

Every sentence is fixed here. Names inside them are `visibleText` of the name. No colons in prose.

- Centre tab `Changes`. View control labelled `Changes to show`, options `Branch` and `Uncommitted`. Layout control labelled `Diff layout`, options `Side by side` and `Inline`.
- Header, after the branch, `from <base>` in `text-dim` font-mono, then the readout `↑<ahead>` and `↓<behind>` in `font-pixel text-[12px] text-dim uppercase`, each shown only when not null, beside an `sr-only` span `<ahead> ahead, <behind> behind`, leaving out a part that is null.
- Empty, Uncommitted `Nothing changed since the last commit.`, Branch `Nothing changed against <base>.`
- Unavailable, `no-commits` `This branch has no commits yet, so there is nothing to compare.`, `no-base` `Satellite found no base branch to compare with. Uncommitted shows the work here.`, `unrelated` `This branch shares no history with <base>, so Branch has nothing to compare.`, `not-local` `This clone never downloaded some of the files these changes need, so Satellite can't list them.`, `too-many` `Too many files changed here for Satellite to list.`, `hung` `Reading the changes here took too long. It tries again in a moment.`, `failed` `Satellite couldn't read the changes here. It tries again in a moment.`
- Below a capped list, `1 more file is not listed.` or `<n> more files are not listed.`, and for `longPaths` `1 file has a path too long to show.` or `<n> files have paths too long to show.`
- A row's accessible name and tooltip, `<path>, <state>` then `, <added> added, <removed> removed` when both counts are numbers, or `, binary` for a binary file. `<state>` is `added`, `added, not tracked yet`, `modified`, `deleted`, `renamed from <from>`, `copied from <from>`, `changed type` or `in a merge`.
- Instead of a diff, `binary` `This is a binary file, so there is no diff to show.`, `large` `This file is too large to show here, over 1 MB or 20,000 lines.`, `repository` `This folder is a repository of its own, so Satellite shows no diff for it.`, `unmerged` `This file is in the middle of a merge. Claude Code can resolve it.`, `changing` `This file changed while Satellite read it. It shows again on the next refresh.`, `hung` `Reading this file took too long. It tries again on the next refresh.`, `not-local` `This clone never downloaded the earlier version of this file, so there is no diff to show.`, `unreadable` `This file's name isn't valid text, so Satellite can't read it.`, `submodule` `This submodule moved from <from> to <to>.`, or with no `from` `This submodule was added at <to>.`, with no `to` `This submodule was removed. It was at <from>.`, with neither `This submodule changed.`
- Diff labels, `originalAriaLabel` `Before, <from or path>` and `modifiedAriaLabel` `After, <path>`.
- Banner, `<base> moved, and 1 file conflicts with this branch.` or `<base> moved, and <n> files conflict with this branch.`, with the button `Send to Claude Code`.
- Conflict request, `Update this branch from <name> and resolve the conflicts.` where `<name>` is the raw base when `holdsHiddenText(base)` is false and it matches `/^[^\s"'`]+$/`, else `the base branch`.
- Line reference, `<range> of <path> <where>. ` with one trailing space. `<range>` is `Line <n>` or `Lines <start> to <end>`. `<path>` is `quotedPath(path)`, the original side using `from` when set. `<where>` is `in this workspace` for the modified side, `as of the last commit` for the original side in Uncommitted, and `at the merge base with <name>` for the original side in Branch, `<name>` cleaned like the conflict request.
- Refusals as error toasts, `This file's name holds hidden characters, so Satellite can't point Claude Code at it. Ask in your own words.` and `This file's path is too long to send. Ask in your own words.`

### Commands

Ids join `CommandId`. None runs while a dialog is open, through `guarded()`. "Changes shown" means a workspace is selected, its project folder is present and the tool check card is not open.

- `changes.branch` "Show the branch's changes", available while changes are shown and the view is Uncommitted.
- `changes.uncommitted` "Show uncommitted changes", available while changes are shown and the view is Branch.
- `changes.inline` "Show the diff inline", available while a text diff is shown side by side.
- `changes.side-by-side` "Show the diff side by side", available while a text diff is shown inline.
- `changes.update-from-base` "Ask Claude Code to update from the base branch", available while changes are shown and the list's `conflict` is not null. Runs `sendToClaudeCode(conflictRequest(base))`. Task 7.
- `changes.send-lines` "Send the selected lines to Claude Code", shortcut `{ key: "l" }`, available while a text diff is shown. Task 8.

### Test ids

Kept, every existing test id, `diff` included on the Monaco host. New.

- `centre-tabs`, `centre-tab-changes`.
- `changes` on the view, `changes-view-branch`, `changes-view-uncommitted`, `diff-side-by-side`, `diff-inline`, `diff-send-lines`.
- `changes-list`, rows `changes-file-<index>` in list order with `data-path` holding the raw path and `data-state` the letter, `<row>-letter`, `<row>-counts`, `changes-more`.
- `changes-empty`, `changes-unavailable`, `changes-sentence` for a sentence that replaces a diff.
- `changes-banner`, `changes-banner-send`.
- `workspace-base`, `workspace-tracking`.

### Scenarios, steps and journeys

New scenarios `mixed-changes` (Task 5) and `conflict-with-base` (Task 7). New CLI step `diff-lines=<side>:<start>-<end>` and `AppSession.selectDiffLines(side, start, end)` (Task 8). New journey `changes` (Tasks 6 and 8), listed right after `workspaces`. The `launch` journey stops checking the sample diff (Task 5). The `projects` journey's `menuCommands` follows the new commands (Tasks 5, 7 and 8). The `boundary` journey gains the changes refusals (Task 3).

## Review Focus

1. **No path, object or argument from the page.** `changes.file` looks up the path in the page's own cached list, the object name comes from that list, and the worktree read refuses links at every level and `.git`. `changes.list` takes an enum and a workspace reference.
2. **No program the repository chose, no write into it.** Every diff run carries `--no-ext-diff --no-textconv`, `cat-file` never gets `--filters` or `--textconv`, `merge-tree` runs with `--attr-source=<empty tree>` and the quarantine environment, and `gitArgs` still adds `--no-optional-locks` and `core.fsmonitor=`.
3. **Bounded.** Every list and read has its cap, its time and its slot, the poll backs off, and an aborted read stops its git.
4. **Untrusted text stays text.** File content goes only into Monaco models, names only through `visibleText` into React text, and no name becomes markup, a link or a command.
5. **Send to Claude Code stays safe.** References and the conflict request are Satellite's words, refused rather than cleaned when a path holds hidden characters, at most 800 characters, never submitted.

---

### Task 1: Reading one side of a file

The worktree reader with its confinement and the blob reader, with their limits. Nothing calls them yet.

**Files:**
- Create: `src/main/changes/file-sides.ts`, `src/main/changes/file-sides.test.ts`

**Interfaces:**
- Consumes: `changesLimits`, `runGit`, `gitReadMs`, `samePath`, `realpathOrUndefined`, `noFollow`, `nonBlocking`, `noTerminal`, `isMissing`.
- Produces, in `file-sides.ts`:
  ```ts
  export type SideRead =
    | { kind: "text"; text: string }
    | { kind: "binary" }
    | { kind: "large" }
    | { kind: "changing" }
    | { kind: "gone" }
    | { kind: "refused" };
  export const oidPattern: RegExp;
  export function isChangePath(path: string, platform?: NodeJS.Platform): boolean;
  export function looksBinary(bytes: Uint8Array): boolean;
  export function lineCount(text: string): number;
  export function readWorktreeSide(root: string, path: string, bytes?: number): Promise<SideRead>;
  export function readBlobSide(folder: string, oid: string, signal?: AbortSignal): Promise<SideRead>;
  ```
- `isChangePath` per Paths. `looksBinary` is true when a 0 byte sits in the first `binaryProbe` bytes, git's own rule. `lineCount` counts `\n` and adds one when the text is not empty and does not end with `\n`.
- `readWorktreeSide(root, path, bytes = changesLimits.sideBytes)`. `refused` unless `isChangePath`. The real root and the confined parent per Paths, `gone` when either is missing, `refused` when they differ. `lstat` the file, `gone` when missing. A link answers its `readlink` text, `large` past `linkChars`. Anything but a regular file answers `binary`. A regular file larger than `bytes` answers `large`. Otherwise open per Paths, `changing` when the identity, size or modification time differs or the bytes read differ from the size, `binary` when `looksBinary`, then decode with `new TextDecoder("utf-8")`, `large` past `sideLines`, else `text`. The handle closes in a `finally`.
- `readBlobSide(folder, oid, signal)`. `refused` unless `oidPattern` matches and the name is not all zeros. `git cat-file -s <oid>` within `gitReadMs`, `gone` on any failure, `large` past `sideBytes`, then `git cat-file blob <oid>`, `binary` when a `\0` sits in the first `binaryProbe` characters, `large` past `sideLines`, else `text`. No `--filters`, no `--textconv`.

- [ ] **Step 1: Tests**, in `file-sides.test.ts`, each seen failing first. Paths built from `tmpdir()`, links as `"junction"` for folders.
  - `refuses a path that climbs out, is absolute or reaches into .git`, `isChangePath` false for `../x`, `a/../../x`, `/etc/passwd`, `a//b`, `./a`, `.git/config`, `sub/.GIT/HEAD`, a path with NUL, a 4097 character path, and with platform `win32` `C:/x` and `a\\b`, and true for `src/app.ts`, `-dash.txt` and `café notes.md`.
  - `refuses a file reached through a linked folder`, a folder link inside the root to a folder outside answers `refused` for `linked/secret.txt`.
  - `shows a link as its target and never follows it` (`it.skipIf(process.platform === "win32")`), a file link to an outside file answers its target path as text.
  - `answers large past the byte or the line limit`, a file one byte over a `bytes` of 64, and a file of 20001 short lines.
  - `answers binary when a NUL sits in the first 8000 bytes`.
  - `never opens a pipe` (`it.skipIf(process.platform === "win32")`), a FIFO made with `mkfifo` answers `binary` at once.
  - `reads names with spaces, quotes, unicode and a leading dash`, files `with space.txt`, `it's.txt`, `café.md` and `-dash.txt`, plus `quote"d.txt` on systems other than Windows.
  - `reads a committed blob and refuses a made-up object name`, a real repository from `git init` with one commit, `readBlobSide` of the blob from `git rev-parse HEAD:file.txt` answers its text, and `readBlobSide` of `"0".repeat(40)`, `HEAD` and `--help` answers `refused`.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main/changes`, all pass.
- [ ] **Step 3: Prove it.** `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(changes): read each side of a changed file inside its worktree`.

---

### Task 2: The change list and the base

The parsers, the base resolution and the list read. Nothing calls them from the bridge yet.

**Files:**
- Create: `src/main/changes/change-list.ts`, `src/main/changes/change-list.test.ts`, `src/main/changes/change-base.ts`, `src/main/changes/change-base.test.ts`
- Modify: `src/main/workspaces/create-steps.ts` (export `defaultStart` and its `DefaultStart` type, nothing else changes)

**Interfaces:**
- Consumes: Task 1, `runGit`, `gitReadMs`, `defaultStart`, `isBranchName`, `samePath`, `changesLimits`.
- Produces, in `change-list.ts`:
  ```ts
  export interface ChangeRecord {
    path: string;
    from: string | null;
    letter: ChangeLetter;
    tracked: boolean;
    kind: "text" | "binary" | "submodule" | "repository";
    added: number | null;
    removed: number | null;
    sourceOid: string | null;
    targetOid: string | null;
    stamp: string;
  }
  export const changesReadMs = 15_000;
  export function parseDiff(stdout: string): Omit<ChangeRecord, "stamp">[] | undefined;
  export function parseUntracked(stdout: string): string[];
  export function readChangeList(
    folder: string,
    compareWith: string,
    signal: AbortSignal,
  ): Promise<{ records: ChangeRecord[]; more: number } | undefined>;
  ```
- **The diff.** `["diff", "--raw", "--numstat", "-z", "-M", "--no-abbrev", "--no-ext-diff", "--no-textconv", "--no-color", "--no-relative", "--ignore-submodules=dirty", compareWith, "--"]` within `changesReadMs`, where `compareWith` is always an object name that matched `oidPattern`.
- **`parseDiff`.** Split on `\0`. Raw records come first, each a field `:<srcmode> <dstmode> <srcoid> <dstoid> <status>` then one path, or two for a status starting `R` or `C`, the first being `from`. Then exactly as many numstat records in the same order, each `<added>\t<removed>\t<path>` or `<added>\t<removed>\t` followed by two path fields. The letter is the status's first character, a record with `X` or any other letter is skipped, a score after `R` or `C` is dropped. Counts are digits capped at 1000000, or `-` for both meaning binary. `kind` is `submodule` when either mode is `160000`, `binary` when the counts are `-`, else `text`. `sourceOid` is the source name when not all zeros, else `null`, likewise `targetOid`. Answers `undefined` when a raw header is malformed, the numstat count differs from the raw count, a numstat path differs from its raw path, or the output ends mid-record. Only the first `parsed` records are kept, the rest still counted for `more`.
- **The untracked list.** `["ls-files", "--others", "--exclude-standard", "-z"]` within `changesReadMs`. `parseUntracked` keeps non-empty fields. A field ending in `/` becomes a `repository` record without the slash. Every untracked record is letter `A`, `tracked: false`, `from: null`, no object names. The first `countedFiles` untracked files in path order that are not repositories are read with `readWorktreeSide(folder, path, Math.min(sideBytes, budget left))` from a budget of `countedBytes`, which each text read lowers by its length. `text` gives `added: lineCount`, `removed: 0`, `binary` gives `kind: "binary"`, anything else leaves both counts `null`.
- **`readChangeList`** runs the diff and the untracked list together, answers `undefined` when either fails or `parseDiff` refuses, merges the records, sorts them by path, keeps the first `files` and puts the rest in `more`, then sets each `stamp` to `${sourceOid ?? "new"}:${size}:${mtimeNs}` from `lstat(join(folder, path), { bigint: true })`, or `${sourceOid ?? "new"}:gone`, 32 at a time.
- Produces, in `change-base.ts`:
  ```ts
  export interface ChangeBase { ref: string; name: string; oid: string }
  export function headOid(folder: string, signal?: AbortSignal): Promise<string | null | undefined>;
  export function currentBranch(folder: string, signal?: AbortSignal): Promise<string | null>;
  export function resolveBase(projectRoot: string, folder: string, signal?: AbortSignal): Promise<ChangeBase | null>;
  export function mergeBase(folder: string, head: string, base: string, signal?: AbortSignal): Promise<string | null | undefined>;
  ```
- `headOid` runs `rev-parse --verify --quiet HEAD^{commit}`, the name when it matches `oidPattern`, `null` when git answers 1 for an unborn branch, `undefined` on failure. `currentBranch` runs `branch --show-current`, `null` when empty or not `isBranchName`.
- `resolveBase`. `defaultStart(projectRoot)` and, with a remote and a branch, `refs/remotes/<remote>/<branch>` named `<remote>/<branch>`. Otherwise `currentBranch(projectRoot)`, and when `samePath(folder, projectRoot)` or there is none, `null`, else `refs/heads/<branch>` named `<branch>`. Then `rev-parse --verify --quiet <ref>^{commit}` in `folder`, and `null` unless it answers an object name. The ref is a full `refs/` name built from parts that pass `isBranchName`, so it never reads as an option and needs no `--end-of-options`.
- `mergeBase` runs `merge-base <head> <base>` with two object names, the name on 0, `null` on 1, `undefined` otherwise.

- [ ] **Step 1: Tests**, each seen failing first.
  - `change-list.test.ts`
    - `reads an edit, an addition, a deletion and a rename with their letters and counts`, from bytes laid out as git 2.50.1 prints them, the shape in Rulings checked.
    - `keeps names with spaces, quotes, unicode, newlines, colons and a leading dash whole`, including a rename from `old name.txt` to `new\nname.txt` and a path `:start.txt`.
    - `marks binary files and submodules`.
    - `reads a copy, a type change and a file in a merge`.
    - `refuses output that is cut off or whose counts do not match its records`.
    - `lists a nested repository as a folder of its own`.
    - `counts untracked lines only within its budget`, 201 one-line files give 200 counts and one `null`, and a file with a NUL gives `binary`.
    - `lists commits and uncommitted work against the merge base in one list`, a real repository with a commit on a branch plus an uncommitted edit and an untracked file, read against the fork commit, gives all three.
  - `change-base.test.ts`, with real repositories in a temp folder.
    - `compares with the remote's default branch when git knows it`, a clone of a local upstream answers `origin/main`.
    - `falls back to the main folder's branch without a remote`, a linked worktree on `work` answers `main`.
    - `has no base for the main workspace without a remote`.
    - `answers unrelated histories as no merge base`.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main/changes src/main/workspaces`, all pass.
- [ ] **Step 3: Prove it.** `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(changes): list what a workspace changed against its base`.

---

### Task 3: The bridge channels

`changes.list` and `changes.file` per Contract, owned per page, cached for the file lookup, bounded and refused per Global Constraints.

**Files:**
- Create: `src/main/changes/changes-handlers.ts`, `src/main/changes/changes-handlers.test.ts`
- Modify: `src/shared/bridge-contract.ts`, `src/main/sessions/session-folder.ts`, `src/main/main.ts`, `src/main/bridge/registry.test.ts`, `verify/journeys/boundary.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2, `sessionFolder`, `ProjectStore`, `createSlots`, `readTracking`, `countUnpushed`, `hasRemote`, `BridgeFailure`, `BridgeOwner`.
- Produces:
  - Contract and Limits per Global Constraints.
  - `sessionFolder(home, store, ref, sentences = sessionSentences)` with `sessionSentences = { gone: "That folder is gone, so Claude Code can't start there.", archiving: "Satellite is archiving that workspace, so Claude Code can't start there." }` exported, and the changes handlers passing their own two sentences from Background failures. Behaviour is otherwise unchanged.
  - `createChanges({ home, store }: { home: string; store: ProjectStore }): Changes`, `Changes = { handlers: Pick<BridgeHandlers, "changes.list" | "changes.file">; stopInside(folder: string): Promise<void> }`. `handlers` is spread into `registerBridge` in `main.ts` with `projects.store`, and `stopInside` runs beside the terminals' own for an archive and a project removal.
- **`changes.list`.** Per page, held in a `WeakMap<BridgeOwner, PageReads>` cleared through `owner.onGone`, which aborts everything the page runs. The key is `${projectId}/${workspace}/${view}`. A request whose key is already running shares that promise. Any other running list of the page is aborted first, its promise rejecting with the aborted read failure. The read takes one of the four slots, checks its signal before each git run, and does in order.
  1. `folder = await sessionFolder(...)`, `project = await store.project(projectId)`.
  2. `head`, `branch` and `base = resolveBase(project.path, folder)` together.
  3. Tracking for `branch` with `readTracking(folder, [branch])`, and with no upstream `countUnpushed(project.path, branch)` when `hasRemote(project.path)` is true, else both `null`.
  4. `head === undefined` gives `failed`, `head === null` gives `no-commits`.
  5. `fork = base === null ? null : await mergeBase(folder, head, base.oid)`. Branch with no `base` gives `no-base`, with `fork === null` `unrelated`, with `fork === undefined` `failed`. `compareWith` is `head` for Uncommitted and `fork` for Branch.
  6. `readChangeList(folder, compareWith, signal)`, `undefined` gives `failed`. Otherwise `files` from the records without object names and `more`.
  7. The page's cache stores `{ folder, compareWith, records }` under the key, at most `cachedLists` keys, the oldest dropped. Then `conflict: null`.
- **`changes.file`.** The page's running file read is aborted first. The cached list for the key must exist and hold a record whose `path` equals the request's, else the not-found failure. In the slot, `unreadable` when the path holds `\uFFFD`. By record, `repository`, `binary`, `submodule` with the first seven digits of `sourceOid` and `targetOid` as `from` and `to`, `unmerged` for letter `U`. Otherwise the original is `""` for letter `A`, else `readBlobSide(folder, sourceOid)`, and the modified is `""` for letter `D`, else `readWorktreeSide(folder, path)`. Either side `binary`, `large` or `changing` answers that kind, `gone` answers `changing`, `refused` answers the not-found failure, else `text`.

- [ ] **Step 1: Tests**, each seen failing first.
  - `registry.test.ts`, spies for both channels, and `invalid-request` with no handler run for `changes.list` with view `"staged"`, with an extra `args`, without `workspace`, and `changes.file` with an empty path, a 4097 character path and an extra `oid`.
  - `changes-handlers.test.ts`, with a real repository and a stub `ProjectStore` naming it as `main`.
    - `answers a file only when the page's last list named it`, after a list, a listed file answers `text`, an unchanged tracked file, `../outside.txt` and `.git/config` answer `not-found`, and another page's owner answers `not-found` for the listed file.
    - `stops a page's older list when it asks for another view`, two lists with different views, the first rejects with `refused`.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main`, all pass.
- [ ] **Step 3: The boundary journey.** In `verify/journeys/boundary.ts`, after the workspace refusals, on the main workspace of the default repo. `changes.list` with an extra `args` answers `invalid-request`. `changes.list` for `uncommitted` answers `files` with no files. `changes.file` for `../../../etc/hosts`, `.git/config` and `README.md` each answers `not-found`.
- [ ] **Step 4: Prove it.** `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 5: Commit.** `feat(changes): answer a workspace's changes and one file's sides over the bridge`.

---

### Task 4: The diff viewer

Monaco's diff grows into the viewer Changes and spec 008 share, inline or side by side, highlighted, hiding unchanged regions, revealing hidden characters, with a selection the page can read. The sample diff still shows it.

**Files:**
- Create: `src/renderer/diff/diff-language.ts`, `src/shared/visible-text.ts`, `src/shared/visible-text.test.ts`, `src/renderer/ui/segmented.tsx`
- Modify: `src/renderer/diff/diff-view.tsx`, `src/renderer/diff/monaco-environment.ts`, `src/renderer/proving/sample-diff.tsx`, `src/renderer/sessions/send-to-claude-code.ts`

**Interfaces:**
- Produces:
  - `visibleText(raw: string): string` in `src/shared/visible-text.ts`, replacing every character matching `/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}]/gu` with `[U+XXXX]`, uppercase hex of at least four digits.
  - `diffLanguage(path: string): string` in `diff-language.ts`, the id of the first entry of `languages.getLanguages()` whose `filenames` hold the path's last segment or whose `extensions` hold its lowercased extension from the last `.`, else `plaintext`.
  - In `diff-view.tsx`,
    ```ts
    export interface DiffSelection { side: "original" | "modified"; start: number; end: number }
    export interface DiffHandle { selection(): DiffSelection | null }
    export function DiffView(props: {
      original: string;
      modified: string;
      path: string;
      inline: boolean;
      labels: { original: string; modified: string };
      handle?: Ref<DiffHandle>;
    }): ReactElement;
    ```
  - `Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string; testId: string }[]; onChange: (value: T) => void })` in `segmented.tsx`. A `role="radiogroup"` with `aria-label`, each option a `button` with `role="radio"` and `aria-checked`, the checked one alone in the tab order, Left and Right moving and choosing with wrap. Container `flex h-7 items-center rounded-[6px] border border-ctl bg-side p-px`, options `h-[24px] rounded-[5px] px-2 text-[12.5px] text-fg2`, checked `bg-sel text-fg`, the focus ring from the stack skill.
- **Imports** in `diff-view.tsx`, besides the existing two, `monaco-editor/languages/definitions/register.all`, `monaco-editor/features/unicodeHighlighter/register` and `monaco-editor/features/diffEditor/register`. No other feature, never `links`, `hover`, `contextmenu`, `clipboard`'s menus or any `languages/features`.
- **Options** at creation, the existing ones kept, `useInlineViewWhenSpaceIsLimited: false` included, plus `renderSideBySide: !inline` updated with `updateOptions` when `inline` changes, `renderIndicators: true`, `hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 }`, `maxComputationTime: 5000`, `maxFileSize: 2`, `diffAlgorithm: "advanced"`, `renderControlCharacters: true`, `unicodeHighlight: { invisibleCharacters: true, ambiguousCharacters: true, nonBasicASCII: false, includeComments: true, includeStrings: true }`, `tabFocusMode: true`, `dropIntoEditor: { enabled: false }`, `dragAndDrop: false`, `contextmenu: false`, `links: false`, `originalAriaLabel` and `modifiedAriaLabel` from `labels`.
- **Models.** `editor.createModel(text, diffLanguage(path))` for both sides. When `path` equals the previous model's path, `saveViewState()` before and `restoreViewState()` after `setModel`, so a refresh keeps the scroll and the selection. Old models are disposed as today.
- **Selection.** The last side whose editor fired `onDidFocusEditorText`, `modified` until then and always while inline. Its `getSelection()`, with `end` lowered by one when the selection spans lines and ends at column 1. `null` with no model.
- **Theme.** `applyMonacoTheme` adds `rules` from tokens without the `#`, `{ token: "", foreground: fg }`, `{ token: "comment", foreground: dim, fontStyle: "italic" }`, `{ token: "keyword", foreground: fg, fontStyle: "bold" }`, `{ token: "type", foreground: fg }`, `{ token: "string", foreground: fg2 }`, `{ token: "number", foreground: fg2 }`, `{ token: "regexp", foreground: fg2 }`, and colours `"editorUnicodeHighlight.border": token("sigfg")`.
- **Focus after a send.** In `send-to-claude-code.ts`, `typingPlaces` writes `textarea:not([readonly])` instead of `textarea`, so a send from Monaco's read-only input moves focus to the terminal like a send from a button.
- `SampleDiff` passes `path="launch-window.ts"`, `inline={false}` and labels `Before, launch-window.ts` and `After, launch-window.ts`.

- [ ] **Step 1: Tests.** `visible-text.test.ts`, seen failing first, `reveals direction and invisible characters in a name`, `a\u202Eb\u200Bc\tz` gives `a[U+202E]b[U+200B]c[U+0009]z` and a tag character gives `[U+E0041]`, and `keeps plain unicode names as they are`, `café notes.md`, `日本語.txt` and `it's new.txt` unchanged.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/shared`, all pass.
- [ ] **Step 3: Prove it.**
  - `npm run --silent verify -- default choose-folder=repo click=add-first-project wait-for=diff shot=diff-light theme=dark shot=diff-dark`. Both screenshots show the sample with `export`, `function` and `return` in bold and its two sides. `consoleErrors` is empty.
  - `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(diff): highlight, fold and reveal hidden characters in the read-only diff`.

---

### Task 5: The Changes tab

The centre column shows the tab strip, the view and layout controls, the file list and the diff of the selected file, and the header names the base and the tracking. The sample diff goes.

**Files:**
- Create: `src/renderer/window/centre-tabs.tsx`, `src/renderer/changes/use-changes.ts`, `src/renderer/changes/changes-view.tsx`, `src/renderer/changes/change-list.tsx`, `src/renderer/changes/file-diff.tsx`, `src/renderer/changes/change-words.ts`, `verify/scenarios/mixed-changes/scenario.json`
- Modify: `src/renderer/window/app-window.tsx`, `src/renderer/projects/workspace-header.tsx`, `src/renderer/commands/command-registry.ts`, `verify/journeys/launch.ts`, `verify/journeys/projects.ts`
- Delete with `git rm`: `src/renderer/proving/sample-diff.tsx`

**Interfaces:**
- Consumes: Tasks 3 and 4, `invoke`, `visibleText`, `CommandButton`, `Segmented`, `Icon`.
- Produces:
  - `useChanges(workspace: WorkspaceRef | null, view: ChangesView): { list: ChangesList | undefined; error: string | null }` in `use-changes.ts`. A request on every change of `workspace` or `view`, the list reset to `undefined` first, answers to an older request ignored by a sequence number, and on `!result.ok` the error message kept while the last list stays. Task 6 adds the refresh.
  - In `change-words.ts`, every sentence from Copy that the page shows as a function or constant, `rowName(file: ChangedFile): string`, `sideSentence(sides: Exclude<FileSides, { kind: "text" }>): string`, `emptySentence(view, base)`, `unavailableSentence(reason, base)`, `moreSentence(more)`, `trackingWords(ahead, behind)`, each name through `visibleText`.
  - `ShownText = { path: string; from: string | null; letter: ChangeLetter; view: ChangesView; base: string | null }`, exported from `file-diff.tsx`.
  - Outside `file-diff.tsx`'s lazy call, every import from `src/renderer/diff/` is `import type`, and `diff-language.ts` is imported only by `diff-view.tsx`, so nothing pulls Monaco into the first chunk.
  - `FileDiff({ workspace, view, file, base, inline, handle, onShown })` in `file-diff.tsx`. It loads `DiffView` with `lazy(() => import("../diff/diff-view.tsx").then((module) => ({ default: module.DiffView })))` inside `Suspense` with an empty `div` as fallback, so Monaco is its own chunk that loads only when a diff first shows. It invokes `changes.file` when `file.path` or `file.stamp` changes and keeps the last answer until the next arrives. `text` draws `DiffView` with the labels from Copy, anything else `changes-sentence`, a failure its message there. `onShown` gets a `ShownText` while a text diff is drawn and `null` otherwise.
  - `ChangeList({ files, more, selected, onSelect })` in `change-list.tsx`, a `ul` with `data-testid="changes-list"` of `button` rows. Each row is 28 pixels, `aria-current` on the selected one, `title` and `aria-label` from `rowName`, the letter in `font-mono text-[12px]`, `text-addfg` for `A`, `text-delfg` for `D`, `text-dim` otherwise, the file name in `text-fg` and its folder in `text-dim`, both `visibleText` in an element with `dir="ltr"` and `[unicode-bidi:isolate]`, the folder truncating first, then the counts in `font-mono text-[12px]` as `+<added>` in `text-addfg` and `−<removed>` in `text-delfg`, nothing for `null`. Up and Down move the selection and focus, Home and End go to the ends. `changes-more` below when `more` is above 0.
  - `ChangesView({ workspace, view, onView, inline, onInline, list, error, diffHandle, onShown })` in `changes-view.tsx`. The top is one 40 pixel bar on `side` with a bottom hairline, `CentreTabs` on the left, then on the right the view `Segmented`, the layout `Segmented` while a text diff shows, and room for Task 8's button. Below, a `@container` row where the list takes 260 pixels with a right hairline and the diff the rest, stacking with the list above at most 40 percent high when the container is under 640 pixels. The selected path is kept in state, the first file when none or when the kept one left, the next one in its place when it left. `changes-empty`, `changes-unavailable` and the error sentence sit centred in `text-[13px] text-fg2`, nothing while `list` is `undefined`.
  - `CentreTabs()` in `centre-tabs.tsx`, `role="tablist"` with `data-testid="centre-tabs"` and one `role="tab"` button `Changes` with `aria-selected="true"`, `data-testid="centre-tab-changes"`, 40 pixels high with the selected tab's look from the session tabs. The tab panel is the view below it.
  - `WorkspaceHeader` takes `base: string | null`, `ahead: number | null` and `behind: number | null` and draws them after the branch per Copy, `workspace-base` and `workspace-tracking`, hidden at the same container width as the branch. `AppWindow` passes the list's values once loaded, else the workspace view's `ahead` and `behind` and `null` for the base.
  - In `AppWindow`, `changesView` state starting `"branch"`, `diffInline` starting `false`, `shownText` set by `onShown`, `diffHandle = useRef<DiffHandle>(null)`, `useChanges(changesHere, changesView)` where `changesHere` is `sessionHere` while changes are shown, else `null`, the four view and layout commands from Commands, and `ChangesView` in place of `SampleDiff`.
- **Scenario `mixed-changes`.** Description says it is a clone of a local upstream with one workspace alpha holding a commit and uncommitted work, a stand-in Claude Code that reports one prompt, and the light theme. `folders` holds `upstream` with `README.md` `# Verify repo\n`, `src/app.ts` `export function greet(name: string) {\n  return "Hello " + name;\n}\n`, `old.txt` `This file goes away.\n` and `notes.md` `# Notes\n\nKeep this.\n`, then `init -b main`, `add .`, `commit -m "first commit"`. `repo` is `clone ../folders/upstream .`. `workspaces` holds `alpha` with steps writing `src/app.ts` `export function greet(name: string) {\n  const greeting = "Hello";\n  return \`${greeting}, ${name}!\`;\n}\n` and `docs/new guide.md` `# Guide\n\nStep one.\n`, then `rm old.txt`, `mv notes.md "café notes.md"`, `add -A`, `commit -m "work on alpha"`, then writing `README.md` `# Verify repo\n\nEdited by the agent.\n`, `it's new.txt` `fresh\n`, `-dash.txt` `leading dash\n`, `report\u202Etxt.md` `hidden direction\n` and `logo.bin` `\u0000\u0001PNG`. `home` seeds `interface.json` version 1 with `"theme":"light"`. `gh` as in `default`. `claude` prints `Claude Code stand-in\r\n`, `\u001b[?2004h` and `> `, awaits `\r`, posts `UserPromptSubmit` then `Stop`, prints `\r\nReady.\r\n> `, then awaits `\r`.
- Expected Branch list in order, `-dash.txt` A +1, `README.md` M +2, `café notes.md` R from `notes.md`, `docs/new guide.md` A +3, `it's new.txt` A +1, `logo.bin` A binary, `old.txt` D −1, `report[U+202E]txt.md` A +1, `src/app.ts` M +2 −1. Uncommitted holds `-dash.txt`, `README.md`, `it's new.txt`, `logo.bin` and `report[U+202E]txt.md`.
- **Journeys stay green.** `launch.ts` waits for `changes` instead of `diff` after adding the project and drops `checkDiff`, which Task 6's `changes` journey takes over. `projects.ts` sets `menuCommands` to the number the command menu now lists with a workspace selected, `changes.uncommitted` added, so 11, confirmed by a run.

- [ ] **Step 1: Implement** per the interfaces. No new unit test, this task is layout and glue.
- [ ] **Step 2: Prove it.**
  - `npm run --silent verify -- mixed-changes click=workspace-repo-alpha wait-for=changes-list tree shot=changes-light theme=dark shot=changes-dark` lists the nine Branch rows above with their letters and counts in `-letter` and `-counts`, `workspace-base` reads `from origin/main`, `workspace-tracking` holds `1 ahead` in its text, and the eighth row's name holds `[U+202E]`. Look at both screenshots.
  - Append `click=changes-file-8 wait-for=diff click=diff-inline shot=inline click=changes-view-uncommitted wait-text=changes-file-1:README.md click=changes-file-3 wait-text=changes-sentence:binary file resize=900x700 shot=narrow`, and look at each shot. `consoleErrors` is empty.
  - `npm run build`, then `grep -l monaco-diff-editor out/renderer/assets/*.js` names a chunk other than the one `out/renderer/index.html` loads.
  - `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 3: Commit.** `feat(changes): show a workspace's changes as a file list and a diff`.

---

### Task 6: Refresh, and the changes journey

The list and the shown file follow the disk without any action, and a journey proves the tab.

**Files:**
- Create: `verify/journeys/changes.ts`
- Modify: `src/renderer/changes/use-changes.ts`, `src/renderer/window/app-window.tsx`, `verify/journeys.ts`

**Interfaces:**
- Produces:
  - `useChanges(workspace, view, finished: string)`. After each answer, the next request is set for `Math.min(changesPollMaxMs, Math.max(changesPollMs, changesPollFactor * elapsed))` milliseconds, only while `document.visibilityState === "visible"`, and none while one runs. `visibilitychange` to visible, the window's `focus` and a change of `finished` to a non-empty value request at once, clearing the timer. Everything stops on unmount or a change of workspace or view.
  - In `AppWindow`, `finished` is the keys of the selected workspace's tabs whose status is `done`, joined with a space.
- **Journey `changes`, scenario `mixed-changes`.** Every wait through `waitUntil` or Playwright's own waiting, the window at the size the driver opens, rows found by `data-path`.
  1. Select alpha. The list holds the nine Branch rows with their letters, `src/app.ts` reads `+2` and `−1`, and the row with `report` in its path shows `[U+202E]` in its text.
  2. Select `src/app.ts`, and the diff shows `.editor.original` and `.editor.modified` with `greeting` in the modified side. No `securitypolicyviolation` event fired since load, read from a listener added at the start with `page.evaluate`.
  3. Choose Uncommitted, and the list holds exactly its five rows.
  4. Write `live.txt` with `written while you watch\n` into the alpha worktree, `<home>/worktrees/repo/alpha`, with `node:fs/promises`. Without any click, a row for `live.txt` appears with letter `A`.
  5. Select `README.md`, then append `Another line.\n` to it on disk. Without any click, its counts read `+3` and the modified side shows `Another line.`
  6. Select `logo.bin`, and `changes-sentence` reads the binary sentence.
  7. Write `big.txt` of 30000 lines of `line\n` into the worktree, wait for its row and select it. `changes-sentence` reads the large sentence, and while it shows `page.evaluate(() => 1)` answers within 2 seconds.
  8. `consoleErrors` is empty, `close()` reports no leftover.
- `journeys.ts` lists `changes` right after `workspaces`.

- [ ] **Step 1: Implement** per the interfaces.
- [ ] **Step 2: Write the journey.** Before trusting it, turn the poll off for one run and see step 4 fail with a legible reason, then restore it.
- [ ] **Step 3: Prove it.** `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(changes): refresh while the view is visible and when a turn ends`.

---

### Task 7: Conflicts with the base

The background process checks a moved base in memory, and the banner offers the request.

**Files:**
- Create: `src/main/changes/conflict-check.ts`, `src/main/changes/conflict-check.test.ts`, `src/renderer/changes/prompt-requests.ts`, `src/renderer/changes/prompt-requests.test.ts`, `verify/scenarios/conflict-with-base/scenario.json`
- Modify: `src/main/platform/tools.ts`, `src/main/workspaces/git-command.ts`, `src/main/changes/changes-handlers.ts`, `src/main/main.ts`, `src/renderer/changes/changes-view.tsx`, `src/renderer/commands/command-registry.ts`, `src/renderer/window/app-window.tsx`, `verify/journeys/projects.ts`

**Interfaces:**
- Produces:
  - `GIT_OBJECT_DIRECTORY` and `GIT_ALTERNATE_OBJECT_DIRECTORIES` join the closed `gitVariables` list in `tools.ts`, which `runTool`'s `gitVariables` option and `runGit`'s last argument `{ gitVariables }` already pass on, copying only names on that list. Only the conflict check passes these two.
  - In `conflict-check.ts`, `conflictReadMs`, and `conflictCount(home: string, folder: string, head: string, base: string, signal?: AbortSignal): Promise<number | null>`.
    1. `null` once this run has seen an unsupported git. Every call first awaits one sweep promise, made at the first call of the run, that removes `<home>/quarantine` with `rm(..., { recursive: true, force: true })`, so a sweep never races a running check.
    2. `rev-parse --path-format=absolute --git-path objects` and `rev-parse --show-object-format`, `null` unless the first is a fully qualified path holding no `path.delimiter`, newline or leading `"`, and the second is `sha1` or `sha256`, which picks the empty tree from Rulings checked.
    3. `mkdir(<home>/quarantine, { mode: 0o700 })` tolerating `EEXIST`, then `mkdir(<home>/quarantine/<randomUUID()>, { mode: 0o700 })`.
    4. `runGit(folder, ["--attr-source=<empty tree>", "merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", head, base], conflictReadMs, signal, { gitVariables: { GIT_OBJECT_DIRECTORY: <quarantine>, GIT_ALTERNATE_OBJECT_DIRECTORIES: <objects> } })`.
    5. In a `finally`, `rm(<quarantine>, { recursive: true, force: true })`, only for the path step 3 built.
    6. Exit 129 marks git unsupported for the run and answers `null`. Exit 0 answers `0`. Exit 1 answers the count of distinct non-empty fields after the first, capped at 1000000. Anything else `null`.
  - In `changes.list`, after the list, when `base` and `fork` are set and `fork !== base.oid`, `conflict` is `{ files: n }` for `conflictCount(home, folder, head, base.oid, signal)` above 0, else `null`.
  - In `prompt-requests.ts`, `cleanBase(base: string | null): string`, the name or `the base branch` per Copy, and `conflictRequest(base: string | null): string`.
  - The banner in `ChangesView`, below the bar while `list.conflict` is not null, `role="status"`, `data-testid="changes-banner"`, `bg-side border-b border-line px-4 py-2 text-[13px] text-fg2` with the `branch` icon in `text-dim`, the sentence from Copy, and `CommandButton command="changes.update-from-base" variant="secondary" size="small" testId="changes-banner-send"` reading `Send to Claude Code`.
  - The `changes.update-from-base` command from Commands.
- **Scenario `conflict-with-base`.** Description says the base moved and one file conflicts with workspace alpha, and the repository's own merge driver must never run. `folders` holds `upstream` with `README.md` `# Verify repo\n`, `shared.txt` `one\ntwo\nthree\n` and `.gitattributes` `shared.txt merge=evil\n`, then `init -b main`, `add .`, `commit -m "first commit"`, then `shared.txt` `one\nTWO on main\nthree\n` and `commit -am "main moves"`. `repo` runs `clone ../folders/upstream .`, `switch -C main HEAD~1` and `config merge.evil.driver "touch \"$HOME/merge-driver-ran\""`. `workspaces` holds `alpha` writing `shared.txt` `one\ntwo on alpha\nthree\n` and `commit -am "alpha edits shared"`. `home`, `gh` and `claude` as in `mixed-changes`.
- `projects.ts` keeps its count, since the new command needs a conflict.

- [ ] **Step 1: Tests**, each seen failing first.
  - `conflict-check.test.ts`, real repositories in a temp folder with a temp home.
    - `counts the files that conflict with the base`, 1.
    - `answers 0 for a base that merges cleanly`.
    - `writes nothing into the repository`, the files under the repository's `.git/objects` are the same before and after, and `<home>/quarantine` holds nothing afterwards.
    - `never runs a merge driver the repository's config names` (`it.skipIf(process.platform === "win32")`), a `merge=evil` attribute and a driver that writes a marker leave no marker.
  - `prompt-requests.test.ts`, `asks to update from a base named by Satellite's words only`, `origin/main` gives `Update this branch from origin/main and resolve the conflicts.`, and a base holding `\u202E` or a space gives `the base branch`.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main src/renderer`, all pass.
- [ ] **Step 3: Prove it.**
  - `npm run --silent verify -- conflict-with-base --keep click=workspace-repo-alpha wait-for=changes-banner text=changes-banner click=start-claude wait-text=terminal:stand-in press=Enter wait-state=session-tab-1:done click=changes-banner-send wait-text=terminal:resolve the conflicts log`. The banner reads `origin/main moved, and 1 file conflicts with this branch.`, and the log's `input` events hold `Update this branch from origin/main and resolve the conflicts.` with no `\r` after it. In the kept temp folder, `user-home/merge-driver-ran` does not exist and `home/quarantine` holds nothing. Leave the kept folder where it is.
  - `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(changes): say when the base moved and files conflict, and offer the request`.

---

### Task 8: Selected lines to the prompt

One key sends a reference to the selected lines, and the driver can select lines.

**Files:**
- Modify: `src/renderer/changes/prompt-requests.ts`, `src/renderer/changes/prompt-requests.test.ts`, `src/renderer/terminal/dropped-paths.ts`, `src/renderer/changes/changes-view.tsx`, `src/renderer/commands/command-registry.ts`, `src/renderer/window/app-window.tsx`, `verify/driver.ts`, `verify/cli.ts`, `verify/journeys/changes.ts`, `verify/journeys/projects.ts`

**Interfaces:**
- Produces:
  - `quotedPath(path: string): string`, the existing private `quoted` in `dropped-paths.ts`, exported under that name and used by `droppedPaths` as before.
  - In `prompt-requests.ts`,
    ```ts
    export type LineReference = { ok: true; text: string } | { ok: false; sentence: string };
    export function lineReference(input: {
      path: string;
      side: "original" | "modified";
      view: ChangesView;
      base: string | null;
      start: number;
      end: number;
    }): LineReference;
    ```
    per Copy. `{ ok: false }` with the hidden sentence when `holdsHiddenText(path)`, with the long sentence when the text is over 800 characters.
  - The `changes.send-lines` command from Commands. Its `run` reads `diffHandle.current?.selection()` and `shownText`. The side is `modified` for letter `A`, `original` for letter `D`, else the selection's. The path is `from ?? path` for the original side. A refusal shows its sentence as an error toast, otherwise `sendToClaudeCode(text)`.
  - `CommandButton command="changes.send-lines" variant="ghost" size="small"` reading `Send lines`, with no icon, with `testId="diff-send-lines"` in the bar while a text diff shows.
  - `AppSession.selectDiffLines(side: "original" | "modified", start: number, end: number): Promise<void>` in `driver.ts`, clicking the line number whose text is `start` inside `[data-testid="diff"] .editor.<side> .line-numbers`, then that of `end` with Shift held. The CLI step `diff-lines=<side>:<start>-<end>` calls it, refusing any other shape with a sentence that names the step.
- **Journey `changes`, appended.**
  9. Start Claude Code, press Enter, and wait for `session-tab-1` to read `done`.
  10. Choose Branch, select `src/app.ts`, select modified lines 2 to 3, press the shortcut, `Meta+L` on macOS and `Control+Shift+L` elsewhere. The stand-in's input holds `Lines 2 to 3 of src/app.ts in this workspace. ` and focus is in the terminal.
  11. Select `café notes.md`, select original line 1 and press the shortcut. The input holds `Line 1 of "café notes.md" at the merge base with origin/main. `
  12. No `\r` reached the stand-in after step 9's Enter.
- `projects.ts` keeps its count, since the new command needs a text diff.

- [ ] **Step 1: Tests**, in `prompt-requests.test.ts`, each seen failing first.
  - `points at lines on each side of a diff in Satellite's words`, the modified side, the original in Uncommitted and in Branch, and a single line.
  - `quotes a path with spaces, quotes or unicode so it reads whole`, `café notes.md` and `it's new.txt` quoted, `src/app.ts` and `-dash.txt` bare.
  - `refuses a path with hidden characters or a reference too long to send`, a path holding `\u202E`, one holding `\n`, and one of 790 characters.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/renderer`, all pass.
- [ ] **Step 3: Prove it.**
  - `npm run --silent verify -- mixed-changes click=workspace-repo-alpha click=start-claude wait-text=terminal:stand-in press=Enter wait-state=session-tab-1:done click=changes-file-8 wait-for=diff diff-lines=modified:2-3 press=Meta+L wait-text=terminal:in this workspace log` on macOS, `Control+Shift+L` elsewhere. The log's `input` events hold `Lines 2 to 3 of src/app.ts in this workspace. `
  - Before trusting the journey, turn the send off for one run and see step 10 fail with a legible reason, then restore it.
  - `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(changes): send a reference to the selected lines to Claude Code`.

---

### Task 9: Docs, skills and status Done

**Files:**
- Modify: `ARCHITECTURE.md`, `SATELLITE.md`, `DESIGN.md`, `.claude/skills/satellite-stack/SKILL.md`, `.claude/skills/satellite-verify/SKILL.md`, `specs/006-changes/spec.md`, `specs/README.md`

- [ ] **Step 1: ARCHITECTURE.md.**
  - Bridge. Rows for `changes.list` and `changes.file` with what each does, the limits from Global Constraints and what a hostile page could do from Global Constraints.
  - Repositories and Projects' Reads paragraph. Every new git command, `diff --raw --numstat -z` with its flags, `ls-files --others --exclude-standard -z`, `cat-file -s` and `cat-file blob`, `rev-parse`, `branch --show-current`, `symbolic-ref`, `merge-base` and `merge-tree --write-tree` under `--attr-source`, with what each can start, the diff's clean and process filter only, and that the only write is the quarantine folder in the Satellite home.
  - A new section `## Changes` after Inbox and notifications, in a few bullets, the base rule, the two views, the parse and the limits, the confinement, the per-page reads and cache, the conflict check with its quarantine and its git 2.41 floor, and the refresh.
  - Diff. Rewrite the bullets, the languages, the two features, inline as the user's choice replacing Always side by side, hidden regions, hidden characters, the selection, the theme rules, and the lazy chunk.
  - Platform. `runTool`'s `gitVariables` option and its closed list, used for the quarantine and to keep the blob reader from fetching.
  - Folder layout. `src/main/changes/`, `src/renderer/changes/`, `src/renderer/window/centre-tabs.tsx`, `src/shared/visible-text.ts`, `src/renderer/ui/segmented.tsx`, `src/renderer/diff/diff-language.ts`, and the `src/renderer/proving/` row removed.
  - Decisions. Rows for polling over watching, the base from git's local refs over a stored base, the quarantine and empty attribute source over writing objects or running merge drivers, and plain-word references over `@` mentions.
- [ ] **Step 2: SATELLITE.md.** A short `## Changes` section after Inbox, in sentences, the default tab, the two views, the header, the refresh, the banner and its request, sending lines, and the sentence for large and binary files, plus that the conflict banner needs git 2.41.
- [ ] **Step 3: DESIGN.md.** In App, one bullet for the centre tab strip and the Changes view, the list row, the letters and counts in `addfg` and `delfg`, the grey banner, and syntax in weight and greys. Components gains the segmented control under the parts drawn.
- [ ] **Step 4: Skills.** `satellite-stack`, `Segmented` in Interface parts, and that git reads for a feature may pass `env` only as the conflict check does. `satellite-verify`, the `diff-lines` step, `AppSession.selectDiffLines`, scenarios `mixed-changes` and `conflict-with-base`, the `changes` journey row, the `launch` journey row without the sample diff and the `boundary` row with the changes refusals, and feature map rows for 006.
- [ ] **Step 5: Status.** Spec and index to **Done**, and tick the spec's acceptance items. Leave `plan.md` to the controller.
- [ ] **Step 6: Check.** `./scripts/check` and `npm run --silent journeys` green, last lines in the report. Commit `docs: describe changes and mark spec 006 done`.

---

## Acceptance map

| Acceptance item or scope bullet | Task | Proof |
| --- | --- | --- |
| An edited, an added, a deleted and a renamed file each appear with the right letter and diff | 2, 5 | `change-list.test.ts`, scenario `mixed-changes` in Task 5 Step 2, `changes` journey steps 1 and 2 |
| Branch shows commits and uncommitted work against the base in one list | 2, 3, 5 | `change-list.test.ts` `lists commits and uncommitted work against the merge base in one list`, scenario `mixed-changes`, `changes` journey step 1 |
| A file changed on disk updates the list without any action | 6 | `changes` journey steps 4 and 5 |
| A base branch that conflicts shows the banner and the request lands in the prompt | 7 | scenario `conflict-with-base` in Task 7 Step 3, `conflict-check.test.ts` |
| Selected lines arrive in the prompt as a reference to the file and lines | 8 | the driver run in Task 8 Step 3, `prompt-requests.test.ts`, `changes` journey steps 10 and 11 |
| A file name with spaces, quotes or unicode is listed and opened correctly | 1, 2, 8 | `file-sides.test.ts`, `change-list.test.ts`, `prompt-requests.test.ts`, `changes` journey step 11 |
| A binary file and a very large file show a sentence and never freeze the window | 1, 5, 6 | `file-sides.test.ts`, `changes` journey steps 6 and 7 |
| Scope, the Changes tab is the default tab in the centre column | 5 | Task 5 Step 2 screenshots, `launch` journey |
| Scope, Uncommitted includes untracked files | 2, 5 | `change-list.test.ts`, `changes` journey step 3 |
| Scope, read-only diffs side by side or inline with syntax highlighting | 4, 5 | Task 4 and Task 5 screenshots, the `inline` shot |
| Scope, the header shows the branch, its base and ahead and behind its remote | 3, 5 | Task 5 Step 2 `workspace-base` and `workspace-tracking` |
| Scope, the view refreshes when a session finishes a turn | 6 | `finished` in Task 6, Task 7 and Task 8 proofs where the list refreshes after `done` |
| Security, no path or argument from the page reaches git or the disk outside the worktree | 1, 3 | `file-sides.test.ts`, `changes-handlers.test.ts`, `registry.test.ts`, the `boundary` journey |
| Security, reading never runs a program the repository chose or writes into it | 2, 7 | the flags in Task 2, `conflict-check.test.ts` |
