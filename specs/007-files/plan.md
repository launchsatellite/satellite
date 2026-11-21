# Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The centre column gets a second tab, Files. A tree of the workspace folder lists each folder only when it is opened, hides what git ignores, and marks changed files with their Git letter. A file opens read-only with syntax highlighting in a tab, several can stay open, and the open tabs are remembered per workspace. Images show as images, and binary, very large and non-UTF-8 files show one sentence. One shortcut opens a file by fuzzy name. The tree and the open file follow the disk by themselves while Satellite is visible. Selected lines go into the Claude Code prompt as a reference with the same key Changes uses. Nothing in Files can change a file.

**Architecture:** The background process does every read, in a new folder `src/main/files/` on top of the confined worktree reader spec 006 built (`src/main/changes/file-sides.ts`), the bounded git helper and the read queue. Three bridge channels, `files.list` (several folders at once), `files.read` (one file, by path, with the stamp the page already shows) and `files.find` (fuzzy names). A path from the page is only ever a request that must pass the path rule, the no-link confinement and git's own ignore check before a byte is read, so the page needs no list to name a file and open tabs survive a reload. Folder entries come from `opendir` inside the confinement and are filtered with one `git check-ignore -z --stdin` per folder, which is O(entries in that folder) in any repository size. Names for open by name come from one `git ls-files -z --cached --others --exclude-standard` read cached for 5 seconds. Git letters come from the `changes.list` answer for Uncommitted that the page already polls. The page reuses the poll schedule, the read-only Monaco editor, the name reveal and the send path. Tabs live in `interface.json`, raised to version 3. No file watcher, no new event, no new state file, no new dependency.

**Tech Stack:** Electron 45.3.4, React 19.3.1, TypeScript 6.0.3, zod 4.6.7, Tailwind 4.3.5, Vitest 5.1.0, playwright-core 1.65.1, vite 8.3.8, Node 24 (`.nvmrc`), git 2.31 or newer (2.50.1 here), `monaco-editor` 0.57.0 (dev dependency, already installed), all read from `package.json` and `node_modules`. No new dependency of any kind.

**Spec:** `specs/007-files/spec.md`

## What this writes and where

- Nothing in any repository, working file, index or ref. Every new git run is a read, and `--no-optional-locks` stays in `gitArgs`.
- `interface.json` in the Satellite home gains the open tabs, version 3 (Task 2). No other state file changes.
- No new directory, no scratch folder, no cache on disk. The name list and the open-file stamps live in memory for one page load.

## Rulings checked

Each was checked while planning, against current documentation or by running the installed git 2.50.1 in a throwaway folder made with `mktemp -d` and left behind.

- **Listing a folder safely and fast.** Three candidates were weighed. (1) `git ls-files --cached --others --exclude-standard -- <folder>/` walks the whole subtree, because a pathspec with `*` also matches `/`, and for the repository root that is `git status` over everything. (2) `git ls-tree HEAD <folder>/` is fast but reads the commit, not the index or the disk, so staged, untracked and deleted files disagree with what is on screen. (3) A confined `opendir` of that one folder plus `git check-ignore -z --stdin` over its entries costs only that folder's entries. The plan takes (3). git's docs (git-scm.com/docs/git-check-ignore) say `--stdin` reads pathnames from standard input, `-z` makes input paths NUL separated and the output machine readable, "By default, tracked files are not shown at all since they are not subject to exclude rules", and exit status 0 means one or more paths are ignored, 1 none, 128 a fatal error. A run here showed what the docs leave out. A path under an ignored folder that does not exist yet is reported ignored (`build/nope`), a tracked file that matches an ignore pattern (`build/forced.js`, added with `-f`) is not, and a folder that holds a tracked file is not reported either, while `--no-index` reports both and so would hide tracked files. So the default mode is the one that keeps tracked files visible. A path inside a submodule makes git exit 128 with `fatal: Pathspec 'subm/s.txt' is in submodule 'subm'` and print nothing for the paths after it, while the submodule's own folder checks clean, so the tree marks any folder that holds a `.git` entry as a repository of its own and never lists inside it, and a 128 answers `unavailable` for that folder or file only, because every folder is checked in its own run. A nested repository that is not a submodule checks like any folder.
- **No program the repository chose.** A hostile repository was built with a marker program wired to `core.fsmonitor`, `core.pager`, `core.editor`, `core.sshCommand`, `core.gitProxy`, `diff.external`, a `textconv` driver, a clean, smudge and process filter selected by `.gitattributes`, `credential.helper`, `core.untrackedCache` and executable `post-index-change`, `pre-commit`, `fsmonitor-watchman`, `reference-transaction` and `post-checkout` hooks, then `check-ignore`, `ls-files --cached --others --exclude-standard -z` and `ls-tree` were run with Satellite's safe options (`--no-optional-locks`, `-c core.fsmonitor=` and the rest of `gitArgs`) and without them. Without them `check-ignore` and `ls-files` started the fsmonitor program, and a `status` control run started it and the `post-index-change` hook as well. With them no marker was written by any of the three commands. These commands hash no file content and show no diff, so filters, textconv, external diff, the pager and the editor have no role in them, and the safe options already close the one that does, fsmonitor. The user's own global and system config applies as in spec 006, which is what makes the user's global ignore file count.
- **Symlinked ignore files.** The git 2.32 release notes (`RelNotes/2.32.0`) say "`.gitattributes`, `.gitignore`, and `.mailmap` files that are symbolic links are ignored", and a run here on 2.50.1 printed `warning: unable to access '.gitignore': Too many levels of symbolic links` and applied no pattern from the target. The floor is 2.31, where git read the link's target as patterns, which can tell a page only whether a name matches a pattern from a file outside the workspace. A repository's own `core.excludesFile` can do the same on every version, since git reads that file as patterns. Both are less than the same page does through `terminal.write`, and are recorded in `ARCHITECTURE.md`.
- **Names for open by name.** `git ls-files --cached --others --exclude-standard -z` (git-scm.com/docs/git-ls-files) lists tracked files from the index and untracked files that are not ignored, and with `--directory` absent prints a nested repository as `dir/`. `--deduplicate` is documented without a version, so the plan dedupes with a `Set` instead. It reads the index and walks only non-ignored folders, runs once when the finder opens and not on every tick, and `runTool` already stops output at 16 MiB. A run over this repository took 0.02 seconds for 320 paths. More than 200,000 names answers `too-many`.
- **Fuzzy matching.** `fuzzyScore` and `rankMatches` in `src/renderer/palette/fuzzy-match.ts` already rank the command menu and the switcher, and a few dozen lines are enough. Main needs the same function for the name list, so the file moves to `src/shared/fuzzy-match.ts` with its test, which is the one case where two features share it. The ranking gets a second tier, a match inside the file name outranks a match that needs the folder part. No library, which would be a new dependency the maintainer must approve.
- **Polling over watching.** Spec 006's ruling (`ARCHITECTURE.md` Decisions, polling instead of a watch) holds unchanged. A recursive watch needs one inotify watch per folder on Linux and reaches the per-user limit under `node_modules`, misses changes on network drives and sees git's own writes. Files has the same need and the same answer, and reuses the schedule in `refresh-schedule.ts`, 2 seconds doubling to 30 and reset by focus, returning visible and a finished session turn. The tree adds no new probe, because every tick re-lists the open folders and re-reads the active file with its stamp, and the answer to an unchanged file is the word `same`.
- **Images under the policy and the sandbox.** The production policy has `img-src 'self' data:` (`src/shared/content-security-policy.ts`) and `default-src 'none'`, so a `data:` URL built by the page loads and nothing else does. MDN (developer.mozilla.org, `img-src`) confirms `data:` is a scheme source that `'self'` does not include and that an SVG loaded through `<img>` cannot run script or fetch anything, which is why a PNG, JPEG, GIF or WebP drawn from a `data:` URL needs no policy change. Bytes reach the page as base64 inside the bridge answer, never as a URL, a `file:` address or a `blob:`, and the page cannot choose the media type, since the background process decides it from the file's first bytes into a closed enum of four. Formats are PNG, JPEG, GIF and WebP, which every Chromium decoder handles and which are what a repository holds. SVG is not drawn. It is text a code reader wants to read, it opens in the editor as XML, and drawing it would add the SVG renderer's surface for no gain. AVIF, BMP, ICO and TIFF open as binary files. A decoder runs inside the sandboxed renderer, and a renderer that dies ends every Claude Code session, so a decompression bomb is the risk that matters. The background process reads the pixel size from the header before any byte leaves and refuses more than 50,000,000 pixels. PNG, `IHDR` at offsets 16 and 20, four bytes each, big endian, after the signature `89 50 4E 47 0D 0A 1A 0A` (w3.org/TR/png-3, sections 5.2, 7.1 and 11.2.1, the offsets are the sum of signature, length and type). GIF, bytes 6 and 8, two bytes little endian, after `GIF87a` or `GIF89a`. WebP, `RIFF`, four size bytes, `WEBP`, then `VP8X` with canvas width minus one in 24 bits little endian at byte 24 and height minus one at byte 27 (developers.google.com/speed/webp/docs/riff_container), `VP8 ` with the key frame start code `9D 01 2A` at byte 23 and 14 bit width and height in two little endian 16 bit fields at 26 and 28 (RFC 6386, section 9.1, where the byte order is the reference code's, so a test builds the bytes), or `VP8L` with signature `2F` at byte 20 then width minus one and height minus one as 14 bits each, least significant bit first (WebP lossless bitstream specification). JPEG is read by walking markers to the first start of frame, `C0` to `CF` but not `C4`, `C8` or `CC`, whose payload holds the 16 bit height then width, big endian. A header that does not parse as one of these answers `binary`, so a file that only claims to be an image is never handed to a decoder.
- **The read-only editor in the installed version.** `src/renderer/diff/read-only-editor.tsx` already holds `readOnlyOptions` (`readOnly`, `domReadOnly`, no minimap, no links, no context menu, no drag and drop, `tabFocusMode`) and `SideView` already creates a plain `editor.create` editor of one text with the language from the path, the reveal of hidden characters, the look-alike marks and `selectedLines`. Monaco 0.57.0 is the version in `package.json` and the lockfile, and no editing contribution is imported, so no key can change a model. Files needs that same editor with no added or removed marks, so `SideView` takes `side: DiffSide | null` and `null` means a plain file (Task 3).
- **Tabs remembered per workspace.** Interface state is `interface.json` (`ARCHITECTURE.md` State), validated by a strict schema whose `version` is a literal, which the file reads for versions 1 and 2 and writes as 2, saved whole through `interface.save`. A new field is a new version, 3, that reads 1 and 2 as it does today. An older build sets a version 3 file aside as an unknown version, as the version 2 change already does. The saved tabs are paths only, bounded, and the page prunes workspaces it no longer lists.
- **Shortcuts in use.** The command registry has K (commands), O (add a project), N (new workspace), T (new session), P (switcher) and L (send lines). The app menu's roles take A, C, V, X, Z (Edit), H, Q (macOS app menu) and M, W (Window), and the development View menu takes the reload and developer tools keys. Electron and Chromium bind nothing to Ctrl+Shift+F, and macOS binds Cmd+F to nothing here, since the Edit menu has no Find. Open by name takes F, which reads as find. Send lines keeps L.

## Open calls decided here

| Decision | Why | Cost if wrong |
| --- | --- | --- |
| Git letters in the tree come from the Uncommitted list, not Branch | It needs no base, so the main workspace has letters too, and it is what every editor's explorer shows | Files a branch changed in earlier commits show no letter. Changes shows them |
| A folder row shows no letter or mark for changes inside it | The spec marks files, and a mark needs a walk of the list per folder | A collapsed folder hides that something inside changed |
| Files git ignores are neither listed nor readable, by any path | Ignored files are where secrets live and generated junk grows, spec 006 never reads them either, and the page needs no more than the tree shows | A user cannot read a build output or a local config in Satellite. The agent and their editor can |
| A file git tracks stays visible and readable even when a pattern matches it | `check-ignore` without `--no-index` answers that way, and tracked files are part of the repository | None |
| A check that fails, hangs or hits a submodule path fails closed, the file is not shown | Reading what git could not vouch for is the unsafe side | A file shows a sentence instead of its text until the next tick |
| Deleted files do not appear in the tree | They are not on disk, and the Changes tab lists them | Nothing |
| A symlink is a row that opens as the text of its target, a folder that holds a `.git` entry is a row that does not open | The reader never follows a link, and a repository of its own has its own ignore rules | A nested repository's files are not browsable here |
| SVG opens as text, and AVIF, BMP, ICO and TIFF as binary | See Rulings checked | A user cannot see a vector image drawn |
| Images up to 5 MiB and 50 million pixels, text up to 1 MiB and 20,000 lines | The text limit is spec 006's, and a 12 megapixel photo is under 5 MiB | A larger image shows the sentence |
| The Files tab is page-load state, Changes stays the tab a workspace opens on | No format change for it, spec 006 keeps its view the same way | Reloading shows Changes first |
| Switching tabs unmounts the other view, so the selected diff file resets to the first | Mounting both keeps two Monaco editors alive for a view nobody sees | Going back to Changes loses the selected row |
| The tree keeps at most 16 folders open at once and closes the one opened longest ago when a 17th opens | The refresh reads every open folder each tick, so the count is the bound | A user who opens 17 folders sees the oldest close |
| Open folders are not remembered, the folders on the way to the active tab open by themselves | Only the tabs are saved, and the active file shows where it is | A reload collapses the tree to the active file |
| At most 12 tabs per workspace, and opening another closes the leftmost | A bound for the file, and the user opened the new one on purpose | An old tab closes without a question |
| No scroll, selection or find memory per tab | A tab re-reads the file when it is shown, which keeps it current | A tab opens at the top |
| Only 1000 entries of a folder are listed and a folder over 5000 raw entries is not listed | The list is bounded, sorted folders first, and open by name reaches the rest | A huge folder needs the finder |
| Open by name searches at most 200,000 names, then says so | A bounded list in memory per page, and 16 MiB of git output is the other cap | A repository above that has no finder |
| Open by name offers a tracked file deleted on disk | One more git read to subtract it is not worth it, and opening it says the file is gone | One wasted result |
| The finder is a third mode of the existing palette, not a new dialog | It already has the input, the list, the keys, the focus return and the tests | The finder shares the palette's look |
| The finder has no filter field in the tree, no content search, no breadcrumb | The spec asks for tree, tabs, finder, refresh and lines | A user greps in the agent pane |
| Files has its own four slot read queue | A tree tick must never wait behind a diff read and the reverse | Up to eight git runs at once across both tabs |

## Exact values

### Limits

In `src/shared/bridge-contract.ts`, read by both processes.

```ts
export const filesLimits = {
  folders: 16,
  folderScan: 5000,
  folderEntries: 1000,
  nameChars: 255,
  imageBytes: 5_242_880,
  imagePixels: 50_000_000,
  imageBase64Chars: 6_990_508,
  findNames: 200_000,
  findResults: 50,
  queryChars: 200,
  tabsPerWorkspace: 12,
  tabbedWorkspaces: 100,
};
```

- Text reads reuse `changesLimits.sideBytes` (1 MiB), `sideLines` (20000), `linkChars`, `binaryProbe`, `pathChars` (4096) and `stampChars` (200).
- Time. Each git run `gitReadMs` (5 seconds). The name list read `findReadMs = 15_000`, in `src/main/files/name-index.ts`. A folder listing and a file read have 5 seconds for their file calls, through the same `withinTime` and stuck marking `file-sides.ts` uses. The name list is reused for `nameIndexMs = 5000` in the same file.
- Concurrency. `filesReadSlots = 4` and 16 waiting, one `createReadQueue(4, 16)` in `src/main/files/files-handlers.ts`. Per page one list, one file read and one find at a time, a newer one of a kind stops the older.
- Refresh. `changesPollMs`, `changesPollMaxMs` and `changesPollFactor` from the moved schedule, unchanged.
- Sorting. Folders and repositories first, then links and files, each group by UTF-16 code unit order of the name, so every system lists alike.
- Shortcut `{ key: "f" }`, shown as `⌘F` on macOS and `Ctrl+Shift+F` elsewhere. Send lines keeps `{ key: "l" }`.

### Paths and the rule for what a page may read

A path is `/` separated and relative to the workspace folder, the empty string for the folder itself. A request names a path, and the background process reads it only when every step holds, in this order, and otherwise answers a sentence and reads nothing more.

1. `isChangePath(path)` from spec 006, so no empty, `.` or `..` segment, no `.git` in any case or with the characters macOS ignores, nothing absolute, no drive prefix, no backslash, no NUL, no replacement character, no Windows short name, at most 4096 characters. The folder itself, `""`, is the one empty path and only `files.list` takes it.
2. The workspace is one Satellite lists, its folder passes `sessionFolder` with the changes sentences, and it is not being archived.
3. Every folder on the way is a plain folder by `lstat` from the real workspace root down, so no link or junction is ever followed, and the real path of the parent equals the real root joined with the parent part, checked before and after the read. This is `confinedFolder` in `file-sides.ts`.
4. `git check-ignore` does not report the path, run in the workspace after step 3. A path it reports is `ignored`, a run that fails or ends on a submodule path is `unavailable`, and one that runs out of time or finds git stuck in that folder is `hung`.
5. The file opens with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_NOCTTY`, must be a regular file whose device, inode, size, modification time and change time equal its `lstat`, and must not change while it is read. A link itself is not followed, its target text is the content. A pipe or device is never opened.

No list names a file first, because tabs come back after a reload and the rule above already confines the page. A folder row that holds a `.git` entry is never listed inside.

### Contract

In `src/shared/bridge-contract.ts`.

```ts
export type FolderListing = z.output<typeof folderListing>;
export type FilesList = BridgeResponse<"files.list">;
export type FileRead = BridgeResponse<"files.read">;
export type FilesFind = BridgeResponse<"files.find">;
export type FileTabs = z.output<typeof fileTabs>;

const filePath = z.string().min(1).max(changesLimits.pathChars);
const folderPath = z.string().max(changesLimits.pathChars);
const fileStamp = z.string().min(1).max(changesLimits.stampChars);
const entryName = z.string().min(1).max(filesLimits.nameChars);
export const fileEntry = z.strictObject({
  name: entryName,
  kind: z.enum(["file", "folder", "repository", "link"]),
});
export const folderListing = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("listed"),
    entries: z.array(fileEntry).max(filesLimits.folderEntries),
    more: count,
  }),
  z.strictObject({ state: z.enum(["missing", "unreadable", "too-many", "hung", "failed"]) }),
]);
export const imageType = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const fileTabs = z.strictObject({
  projectId: z.uuid(),
  workspace: workspaceKey,
  paths: z.array(filePath).min(1).max(filesLimits.tabsPerWorkspace),
  active: z.int().min(0).max(filesLimits.tabsPerWorkspace - 1),
});
```

Requests, added to `bridgeRequests`.

```ts
"files.list": {
  request: z.strictObject({
    workspace: workspaceRef,
    folders: z.array(folderPath).min(1).max(filesLimits.folders),
  }),
  response: z.strictObject({
    folders: z.array(z.strictObject({ path: folderPath, listing: folderListing }))
      .max(filesLimits.folders),
  }),
},
"files.read": {
  request: z.strictObject({ workspace: workspaceRef, path: filePath, known: fileStamp.nullable() }),
  response: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("text"), text: z.string().max(changesLimits.sideBytes), stamp: fileStamp }),
    z.strictObject({ kind: z.literal("link"), text: z.string().max(changesLimits.linkChars), stamp: fileStamp }),
    z.strictObject({
      kind: z.literal("image"),
      type: imageType,
      data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(filesLimits.imageBase64Chars),
      stamp: fileStamp,
    }),
    z.strictObject({ kind: z.enum(["binary", "large", "not-utf8"]), stamp: fileStamp }),
    z.strictObject({ kind: z.literal("same") }),
    z.strictObject({
      kind: z.enum(["ignored", "gone", "changing", "hung", "unreadable", "unavailable"]),
    }),
  ]),
},
"files.find": {
  request: z.strictObject({
    workspace: workspaceRef,
    query: z.string().min(1).max(filesLimits.queryChars),
  }),
  response: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("found"), paths: z.array(filePath).max(filesLimits.findResults) }),
    z.strictObject({ kind: z.enum(["too-many", "hung", "failed"]) }),
  ]),
},
```

- `files.list` answers one `{ path, listing }` per requested folder, in order, duplicates answered once. `entries` are names only, the page builds each path as `folder + "/" + name`. `missing` is a folder that is gone or no folder, `unreadable` a path that fails the path rule or a link on the way or a `.git` entry beside it, `too-many` more than `folderScan` raw entries, `hung` a read that ran out of time, `failed` a check that did not answer. `more` is the count of non-ignored entries beyond `folderEntries`.
- `files.read` with `known` equal to the stamp of the file as it is now, after steps 1 to 4, answers `same` and reads no byte. The stamp is `${size}:${mtimeNs}:${ctimeNs}` as in `fileStamp`. A stamp the page sends that is wrong costs one full read.
- `files.find` ranks paths with `rankFiles(query, names)` in `src/main/files/name-index.ts` and returns at most 50.
- Interface state. `interfaceState` gains `files: z.array(fileTabs).max(filesLimits.tabbedWorkspaces)`, one entry per workspace, `defaultInterfaceState.files = []`. `interface.json` is version 3 (Task 2).
- No new event. `window.satellite` keeps its three functions.

### Background failures

`BridgeFailure` from `src/main/files/files-handlers.ts`.

- Workspace not on record, `not-found`, `That workspace is not in Satellite.` (existing).
- Folder gone, `not-found`, `That workspace's folder is gone, so Satellite can't show its files.`
- Being archived, `refused`, `Satellite is archiving that workspace, so its files can't be read.`
- More than 16 requests waiting, `limit`, `Satellite is reading a lot of files at once. It tries again in a moment.` `createReadQueue` gets an optional third parameter, the sentence, so the changes queue keeps its own.
- A stopped read, `refused`, `Satellite moved on to a newer read.` The page ignores answers to requests it superseded, so this is never shown.
- git missing, the existing `tool-missing`.

### What a page running hostile script could do with these channels

Recorded in `ARCHITECTURE.md` in Task 8.

- **Read files.** Any regular file inside any workspace Satellite lists, and since `projects.drop` takes any path, any repository on disk it adds first, that git does not ignore, at most 1 MiB of text or 5 MiB of image each, and a link's target text. It cannot read `.git`, anything ignored, anything outside the folder, or anything through a link at any level, and it names no argument, program, object, URL or media type. That page could already read all of it through `terminal.write` and Claude Code's shell, so the rule keeps the interface's reach where spec 006 left it, to what a user would see in the tree.
- **Learn metadata.** Names, kinds, sizes and times of non-ignored entries, that a path is ignored, and whether a path inside a submodule exists. A repository's own `core.excludesFile` or a pre 2.32 symlinked `.gitignore` can make git test a name against patterns read from a file outside the workspace, which shows that file's patterns one yes or no at a time.
- **Load the machine.** One request costs at most a bounded `opendir`, up to 5000 `lstat` calls and one git run per folder, 16 folders at most, in one of four slots, with 5 second limits, and a newer request of its kind stops the older. A find sorts at most 200,000 names, so a page that sends a query as fast as it can keeps one core busy, which typing into Claude Code does too.
- **Write.** Nothing, in a repository or anywhere. The saved tabs are the page's own state in `interface.json`, bounded to 100 workspaces of 12 paths, and a path in them is only a request that the rules above confine.
- **Images.** It receives bytes and the closed media type. It builds a `data:` URL from the type and the validated base64, and the policy allows nothing else, so no file or remote URL is ever drawn.

### Copy

Every sentence on screen. File and folder names inside them go through `VisibleName` or `visibleText`. No colons in prose.

- Centre tabs `Changes` and `Files`, the strip labelled `Workspace views`.
- Tree, labelled `Files`. Empty workspace `This workspace has no files yet.` Empty folder row `Empty`. A folder that is not listed shows one `dim` row under it, `missing` `This folder is gone.`, `unreadable` `Satellite can't open this folder.`, `too-many` `This folder holds too many entries to list. Find files in it by name.`, `hung` `Reading this folder took too long. It tries again in a moment.`, `failed` `Satellite couldn't read this folder. It tries again in a moment.` After a capped list `1 more entry is not listed.` or `<n> more entries are not listed.` A row's accessible name and tooltip, `<path>, <state>` with `<state>` `added`, `added, not tracked yet`, `modified`, `renamed`, `copied`, `changed type`, `in a merge` for a letter, `repository of its own` for that kind and `link` for a link, and nothing for a file with no letter. A deleted file never has a row.
- Viewer with no tab open `Pick a file from the tree, or find one by name.` while the bar's button reads `Find a file`.
- File tabs, labelled `Open files`, each tab's tooltip the full path and its close button `Close <name>`.
- Opening `Opening the file…`. The viewer failing to load `Satellite couldn't load the file viewer, so there is nothing to show.`
- A link `This is a link, so the file shows where it points.`
- Instead of a file, `binary` `This is a binary file, so there is nothing to read here.`, `large` `This file is too large to show here. Text opens up to 1 MB and 20,000 lines, images up to 5 MB.`, `not-utf8` `This file isn't UTF-8 text, so Satellite doesn't show it.`, `ignored` `Git ignores this file, so Satellite doesn't show it.`, `gone` `This file isn't there anymore.`, `changing` `This file changed while Satellite read it. It shows again on the next refresh.`, `hung` `Reading this file took too long. It tries again in a moment.`, `unreadable` `This file's name isn't one Satellite can open.`, `unavailable` `Satellite couldn't check this file against gitignore, so it doesn't show it.` A failed request shows the request's own sentence.
- Image label, the file's name through `visibleText`.
- Finder, the palette's third mode. Label `Open a file by name`, placeholder `Type part of a file name`, group `Files`, footer action `Open`. Before a query `Type part of a file name.` No match `Nothing matches that.` `too-many` `This workspace has too many files to search by name. Open files from the tree.` `hung` `Searching took too long. Try again in a moment.` `failed` `Satellite couldn't list the files here. Try again in a moment.` A result shows the name, with its folder in `dim`.
- Lines from a file, reusing spec 006's reference text, `Lines 12 to 18 of src/app.ts in this workspace. ` and its refusals. Nothing selected in a file, `Select some lines in the file first.`
- Commands, `Show the files`, `Show the changes`, `Open a file by name` (shortcut F) and the existing `Send the selected lines to Claude Code` (shortcut L).

### Commands

Ids join `CommandId`. None runs while a dialog is open. "Shown" means a workspace is selected, its project folder is present and the tool check card is not open.

- `files.show` "Show the files", available while shown and the centre tab is Changes.
- `changes.show` "Show the changes", available while shown and the centre tab is Files.
- `files.open` "Open a file by name", shortcut `{ key: "f" }`, available while shown. It opens the Files tab if needed and the palette in `files` mode.
- `changes.branch`, `changes.uncommitted`, `changes.inline`, `changes.side-by-side` and `changes.update-from-base` are available only while the Changes tab is the centre tab.
- `changes.send-lines` keeps its id and shortcut, and `whenFocusIn` becomes `[data-testid='diff'], [data-testid='file-text']`. It is available while a text diff shows on Changes or a text or link file shows on Files.

### Test ids

Kept, every existing id.

- `centre-tab-files`, `files` on the view, `files-find`, `file-send-lines`.
- `files-tree` on the tree, rows `files-row-<index>` in display order with `data-path` (the full path), `data-kind` (`file`, `folder`, `repository` or `link`), `data-state` (the Git letter or empty) and `aria-expanded` on folders, `<row>-letter`, `files-note` on each sentence row with `data-path` of its folder, `files-empty` for the workspace with no files.
- `file-tabs`, tabs `file-tab-<index>` with `data-path`, `<tab>-close`.
- `file-pane` around the viewer, `file-text` on the Monaco host, `file-image`, `file-sentence`, `file-loading`, `file-link-note`, `file-empty` for the viewer with no tab.
- `palette` mode rows `file-result-<index>` with `data-path`, and the existing `palette-input` and `palette-empty`.

### Scenarios, steps and journeys

`mixed-changes` gains, in its upstream first commit, a `.gitignore` of `*.log` and `build/`, the file `src/deep/er/than/usual/needle-target.ts` and the one pixel `assets/pixel.png`, and in the alpha worktree, never committed, the ignored files `debug.log` and `build/out.js`. Its `write` step takes `{ path, base64 }` as an alternative to `content`. New CLI step `file-lines=<start>-<end>` and `AppSession.selectFileLines(start, end)`. New journey `files`, listed right after `changes`. The `boundary` journey gains the files refusals. `launch`, `projects` and `changes` journeys follow the commands that now depend on the centre tab.

## Review Focus

1. **No path from the page reads outside the workspace.** The five steps in order, `isChangePath`, the session folder, the link-free walk checked before and after, git's ignore check that fails closed, and the no-follow open. Unit tests on every step, a link anywhere above the file, `.git`, `..`, an absolute path, a drive path, a pipe.
2. **Ignored files are never listed or read, and a failed check shows nothing.** Per folder runs, so a submodule fatal costs that folder only.
3. **No program the repository chose, no write into it.** Only `check-ignore` and `ls-files` with `gitArgs`, nothing hashes content, nothing is written.
4. **Bounded.** Every number in Limits is enforced where the work happens, the schema repeats it at the boundary, and a stopped request stops its git.
5. **Untrusted text stays text.** Names through `visibleText` and `VisibleName`, content only in Monaco models, image bytes only in a `data:` URL built from a closed enum, nothing in the saved tabs is ever run.

---

### Task 1: The reads and their bounds

The confined folder listing, the ignore check, the file read with images, and the name list with its ranking, all in the background process with their limits. Nothing calls them from the bridge yet.

**Files:**
- Create: `src/main/files/ignore-check.ts`, `src/main/files/ignore-check.test.ts`, `src/main/files/folder-listing.ts`, `src/main/files/folder-listing.test.ts`, `src/main/files/image-size.ts`, `src/main/files/image-size.test.ts`, `src/main/files/file-read.ts`, `src/main/files/file-read.test.ts`, `src/main/files/name-index.ts`, `src/main/files/name-index.test.ts`
- Move: `src/renderer/palette/fuzzy-match.ts` and `fuzzy-match.test.ts` to `src/shared/fuzzy-match.ts` and `fuzzy-match.test.ts`, with the palette's import updated
- Modify: `src/main/platform/tools.ts` and its test (an `input` option), `src/main/workspaces/git-command.ts` (`GitExtra` takes `input`), `src/main/changes/file-sides.ts` (export what the new reads share), `src/shared/bridge-contract.ts` (`filesLimits` only)

**Interfaces:**
- Consumes: `isChangePath`, `confinedFolder`, `folderPathKind`, `withinTime`, `markStuck`, `rootsWithStuckReads`, `decodedText`, `looksBinary`, `lineCount` and `fileStamp` from `file-sides.ts` (exported as needed, nothing renamed), `readGit`, `gitReadMs`, `isSafeFileName`, `isMissing`, `noFollow`, `nonBlocking`, `noTerminal`, `changesLimits`, `filesLimits`.
- Produces:
  ```ts
  // tools.ts
  interface RunOptions { input?: string }   // stdin is a pipe only when set, written once and ended, EPIPE ignored
  // ignore-check.ts
  export type IgnoreCheck = { kind: "checked"; ignored: ReadonlySet<string> } | { kind: "hung" } | { kind: "failed" };
  export function checkIgnored(folder: string, paths: readonly string[], signal?: AbortSignal): Promise<IgnoreCheck>;
  // folder-listing.ts
  export function listFolder(root: string, folder: string, signal?: AbortSignal): Promise<FolderListing>;
  // image-size.ts
  export type ImageKind = { type: ImageType; width: number; height: number };
  export function readImageHeader(bytes: Uint8Array): ImageKind | undefined;
  // file-read.ts
  export function readFileForViewing(root: string, path: string, known: string | null, signal?: AbortSignal): Promise<FileRead>;
  // name-index.ts
  export const findReadMs = 15_000;
  export type NameIndex = { kind: "names"; names: string[] } | { kind: "too-many" | "hung" | "failed" };
  export function readNames(root: string, signal?: AbortSignal): Promise<NameIndex>;
  export function rankFiles(query: string, names: readonly string[]): string[];
  ```
- `checkIgnored` runs `["check-ignore", "-z", "--stdin"]` through `readGit` with `input` the paths NUL separated, at most 5000. Exit 0 and 1 are checked, the ignored set is the NUL separated paths printed, anything else, 128 included, is `failed`, `time` and `stuck` are `hung`.
- `listFolder`. A path failing `isChangePath` (the empty string passes) answers `unreadable`. `confinedFolder(root, folder)` gives the real folder, `missing` when it is gone, `unreadable` when a link or a non-folder sits on the way, and it is checked again after the read and answers `unreadable` when it moved. `opendir` of the real folder reads entries one by one, skipping `.git` by `isChangeSegment`, and stops at `folderScan` entries with `too-many`. A directory entry that holds a `.git` entry by `lstat` is `repository`, other directories `folder`, symbolic links and junctions `link`, regular files `file`, and pipes, sockets and devices are left out. The `lstat` calls run 32 at a time. The names go to `checkIgnored(root, paths)` with each name joined to the folder, the ignored ones drop out, a `hung` or `failed` check answers that state for the folder, and what is left sorts as in Exact values, is cut to `folderEntries` and the rest counted in `more`. The whole call has `gitReadMs` through `withinTime` and marks the root stuck like a read that hangs.
- `readImageHeader` per Rulings checked, answering `undefined` for anything it cannot parse, and for a zero size.
- `readFileForViewing` runs the five steps of Paths in order and answers the contract's `files.read`. Step 1 failing answers `unreadable`. The stuck root answers `hung`. After step 3 the file's `lstat` gives the stamp, and `known` equal to it answers `same` once step 4 passed. Then `checkIgnored(root, [path])` answers `ignored`, `unavailable` or `hung`. The open reads the first 64 KiB (or the whole file when smaller), `readImageHeader` of them decides whether the file is an image and gives its type and size, `large` over `imagePixels` or `imageBytes`, `binary` when the signature is right and the header does not parse. A file over `imageBytes` is `large` whatever it is, over `sideBytes` and not an image `large`, otherwise the whole file is read with the same identity checks as `openedSide` and an image answers `type` and base64, a NUL in the first 8000 bytes `binary`, text that is not UTF-8 `not-utf8`, over 20000 lines `large`, else `text`, and a link `link` with its target text. A change while reading answers `changing`, a missing file `gone`.
- `readNames` runs `["ls-files", "-z", "--cached", "--others", "--exclude-standard"]` through `readGit` within `findReadMs`, drops entries ending in `/`, entries failing `isChangePath` and duplicates, and answers `too-many` past `findNames` or when git's output limit stops it, `hung` and `failed` otherwise. `rankFiles` keeps the names whose file name part matches the query with `fuzzyScore`, then the names that match only as a whole path, each tier by score, then shorter paths first, then code unit order, at most `findResults`.

- [ ] **Step 1: Platform.** Add `input` to `RunOptions` in `tools.ts`, thread it through `GitExtra`, and test it with `runTool("git", ["hash-object", "--stdin"], { input: "hi\n" })` answering `45b983be36b73c0788dc9cbcb76cbb80fc7bb057`, plus an input larger than the pipe buffer, plus a tool that exits before reading its input, which must not throw an unhandled error. Skill `satellite-stack` is updated in Task 8.
- [ ] **Step 2: Tests**, each seen failing first, with real repositories from `git init` in `mkdtemp` folders, links as `"junction"` for folders.
  - `ignore-check.test.ts`
    - `reports an ignored file and an ignored folder and leaves a tracked file that matches a pattern`, with `*.log`, `build/`, `!keep.log` and a file added with `-f`.
    - `answers failed for a path inside a submodule and checked for the folder itself`.
    - `starts no program the repository chose`, a marker executable wired to `core.fsmonitor` and a `post-index-change` hook in the repository, run through `checkIgnored`, the marker file never appears. Skips on Windows.
  - `folder-listing.test.ts`
    - `lists folders first and hides ignored entries, .git and files in ignored folders`.
    - `keeps a tracked file that an ignore pattern matches`.
    - `marks a folder that holds a .git entry as a repository and a link as a link` (link cases `it.skipIf(process.platform === "win32")` for the file link, the folder link as a junction everywhere).
    - `refuses a folder reached through a linked folder, .git, .., an absolute path and a drive path`.
    - `answers too-many past the scan limit and cuts the list at 1000 with the rest counted`.
    - `answers missing for a folder that is gone and for a file`.
  - `image-size.test.ts`
    - `reads the size of a PNG, a GIF, a JPEG and the three WebP kinds from crafted bytes`, the VP8 and VP8L bytes built from the two specs.
    - `refuses a truncated header, a zero size and bytes that only start like an image`.
  - `file-read.test.ts`
    - `refuses a file reached through a linked folder, .git, an absolute path and a path that climbs out`, each `unreadable`.
    - `shows a link as its target and never follows it`, `it.skipIf(process.platform === "win32")`.
    - `refuses an ignored file and a file in an ignored folder, and reads a tracked one that matches a pattern`.
    - `answers same only for the stamp the file has now`.
    - `answers image for each format and large for more than 50 million pixels or 5 MiB`, with a PNG header that claims 10000 by 10000.
    - `answers binary for a NUL, not-utf8 for bytes that are not text, large past the line limit`.
    - `never opens a pipe`, `it.skipIf(process.platform === "win32")`.
  - `name-index.test.ts`
    - `lists tracked and untracked files, hides ignored ones and drops nested repositories and duplicates` (a file with two merge stages).
    - `ranks a file name match above a path match and shorter first`, the query `needle` ranks `src/deep/needle-target.ts` above `needle/readme.md`, whose file name does not match.
    - `answers too-many past the name limit`, with the limit passed in.
- [ ] **Step 3: Implement** per the interfaces. Move `fuzzy-match` with `git mv`, the palette imports the shared file. `npx vitest run src/main src/shared src/renderer/palette`, all pass.
- [ ] **Step 4: Prove it.** `./scripts/check` green.
- [ ] **Step 5: Commit.** `feat(files): read folders, files and names inside a worktree` (platform and move in their own commits first, `feat(platform): give a tool run an input` and `refactor: move fuzzy matching to shared`).

---

### Task 2: The bridge channels and the saved tabs

`files.list`, `files.read` and `files.find` owned per page, the boundary journey cases, and `interface.json` version 3 with the tabs.

**Files:**
- Create: `src/main/files/files-handlers.ts`, `src/main/files/files-handlers.test.ts`
- Modify: `src/shared/bridge-contract.ts`, `src/main/changes/read-queue.ts`, `src/main/state/interface-file.ts` and its test, `src/main/main.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/bridge/bridge-client.ts` only if typecheck asks, `verify/journeys/boundary.ts`, `verify/journeys/settings.ts` only if its seeded state needs the new field

**Interfaces:**
- Consumes: Task 1, `sessionFolder`, `ProjectStore`, `createReadQueue`, `BridgeFailure`, `BridgeOwner`.
- Produces:
  - Contract per Exact values, `filesLimits`, the three requests, `fileTabs`, `files` on `interfaceState` and its default.
  - `createReadQueue(size, waitLimit, fullSentence = queueFull)`.
  - `createFiles({ home, store }): Files` with `handlers: Pick<BridgeHandlers, "files.list" | "files.read" | "files.find">`, `stopInside(folder)` and `stopAll()`, the same shape as `Changes`. `main.ts` builds it beside `createChanges`, spreads its handlers into `registerBridge`, adds `files.stopInside` to the `Promise.all` in `stopInside` and `files.stopAll` wherever `changes.stopAll` runs at quit.
  - `interface-file.ts` reads versions 1, 2 and 3 and writes 3, a version 1 or 2 file reading as `files: []`.
- **Handlers.** Per page in a `WeakMap<BridgeOwner, PageReads>` cleared through `owner.onGone`, holding one list controller, one read controller, one find controller and the page's name list (`{ key, at, names }` for one workspace, replaced when another workspace asks, reused for `nameIndexMs`, dropped on `onGone`). A new request of a kind aborts the older of that kind with `movedOn()`. Each takes a slot with the queue, resolves the folder with `sessionFolder(home, store, workspace, filesSentences)` inside the slot, and registers as active with its folder for `stopInside` and `stopAll`, as `changes-handlers.ts` does, waiting at most 5 seconds. `files.list` lists the distinct folders one after another with `listFolder` and answers them in request order, checking the signal between folders. `files.read` is `readFileForViewing`. `files.find` reads the names when the cached ones are older than 5 seconds or belong to another workspace, answers `found` with `rankFiles`, or the state of the failed read, and keeps nothing for a failed one.
- **Saved tabs.** `files` holds one `fileTabs` entry per workspace, and `paths` holds no duplicate. The schema refuses a `paths` with an `active` out of range with a refinement, so a hostile or damaged file is set aside like any other.

- [ ] **Step 1: Contract and queue.** Add the schemas and limits. `createReadQueue` takes the sentence. `registry.test.ts` gets the three spies, which typecheck asks for, and its attack list gains the payloads that must answer `invalid-request` with no handler run, 17 folders, a folder of 4097 characters, a folder that is a number, `known` as an object, a query of 201 characters, an empty query, an extra key such as `follow`, and a workspace of `../main`.
- [ ] **Step 2: Tests.**
  - `files-handlers.test.ts` (with a real `ProjectStore` over a temp repository as the changes handler tests do) `answers a listing in the order asked and each folder once`, `a newer list stops the page's older one and answers refused`, `a read of a path the rules refuse reads nothing`, `a page that goes stops its reads and drops its names`, `archiving a workspace stops its reads`, `answers not-found for a workspace the page does not own and limit past 16 waiting`, `reuses the name list for five seconds and reads again after`.
  - `interface-file.test.ts` `reads a version 1 and a version 2 file as version 3 with no tabs and keeps the rest`, `round-trips tabs`, `sets aside a file whose active tab is out of range or that holds more than 12 paths or 100 workspaces`.
- [ ] **Step 3: Boundary journey.** `verify/journeys/boundary.ts` gains, with the page's own `invoke` as the existing changes cases do, `files.list` refused `invalid-request` for 17 folders, a number, an extra key, `not-found` for a workspace that is not on record, and `unreadable` for `..`, `a/../../x`, `/etc/hosts`, `C:\\Windows`, `.git`, `.GIT/config` and a folder of 4097 characters. `files.read` the same paths answer `unreadable`, an ignored file written into the main folder answers `ignored`, a listed text file answers `text` with its content, and the same stamp answers `same`. `files.find` of a name written into the folder answers it, and an empty query is `invalid-request`.
- [ ] **Step 4: Implement.** Wire `main.ts`. `npx vitest run src/main`, all pass.
- [ ] **Step 5: Prove it.** `npm run --silent journeys` shows `pass boundary`, `./scripts/check` green.
- [ ] **Step 6: Commit.** `feat(files): files.list, files.read and files.find with saved tabs`.

---

### Task 3: The Files tab

The centre tab, the tree with letters, the open file tabs, the read-only viewer and every sentence for text files and non-files. Images draw in Task 7 and the tree follows the disk in Task 4, so here the tree lists when a folder opens and when the window asks again.

**Files:**
- Create: `src/renderer/files/files-view.tsx`, `src/renderer/files/file-tree.tsx`, `src/renderer/files/file-tabs.tsx`, `src/renderer/files/file-pane.tsx`, `src/renderer/files/file-words.ts`, `src/renderer/files/file-words.test.ts`, `src/renderer/files/use-file-tabs.ts`, `src/renderer/files/use-file-tabs.test.ts`
- Modify: `src/renderer/window/centre-tabs.tsx`, `src/renderer/changes/changes-view.tsx` (tabs props only), `src/renderer/window/app-window.tsx`, `src/renderer/commands/command-registry.ts`, `src/renderer/diff/side-view.tsx`, `src/renderer/ui/icon.tsx`, `verify/scenarios/mixed-changes/scenario.json`, `verify/scenario.ts`, `verify/driver.ts` (the `base64` write only)

**Interfaces:**
- Consumes: Tasks 1 and 2, `invoke`, `ChangedFile`, `VisibleName`, `visibleText`, `Button`, `CommandButton`, `Icon`, `useInterfaceState`.
- Produces:
  ```ts
  // centre-tabs.tsx
  export type CentreView = "changes" | "files";
  export function CentreTabs(props: { value: CentreView; onChange: (view: CentreView) => void }): JSX.Element;
  export function centreTabId(view: CentreView): string;
  export function centrePanelId(view: CentreView): string;
  // side-view.tsx
  interface SideViewProps { side: DiffSide | null; /* the rest as today */ }
  // use-file-tabs.ts
  export function useFileTabs(state: InterfaceState, update: (change: (current: InterfaceState) => InterfaceState, persist: boolean) => void, workspace: WorkspaceRef | null, listed: (ref: WorkspaceRef) => boolean): { paths: string[]; active: number | null; open(path: string): void; activate(index: number): void; close(index: number): void };
  export function tabsAfterOpen(entry: FileTabs | undefined, path: string): FileTabs;
  export function pruneTabs(files: readonly FileTabs[], listed: (ref: WorkspaceRef) => boolean): FileTabs[];
  // file-words.ts
  export function fileSentence(read: FileRead): string | undefined;
  export function folderSentence(state: "missing" | "unreadable" | "too-many" | "hung" | "failed"): string;
  export function moreEntries(count: number): string;
  export function rowLabel(path: string, kind: string, letter: ChangeLetter | undefined, tracked: boolean): string;
  ```
- `CentreTabs` is a `tablist` of two `tab`s with the arrow keys, Home and End moving the choice and focus, only the chosen tab in the tab order. Both views render it in their bar. `AppWindow` holds `centreView` state, `"changes"` first, and mounts `ChangesView` or `FilesView`. `useChanges` is called with view `"uncommitted"` while the Files tab shows, so one list poll serves the header and the letters, and the Changes commands, `changes.send-lines` and the conflict banner follow the centre tab as in Commands. The commands `files.show`, `changes.show` and `files.open` are added (the finder itself is Task 5, `files.open` here only switches the tab).
- `FilesView` bar, 40px, on `side`, wrapping like the Changes bar: `CentreTabs`, then at the right `Find a file` (a `CommandButton` for `files.open`, secondary, small, `files-find`) and `Send lines` (Task 6). Below it the tree at 260px on the left, or above the viewer at most 40% of the height under 640px, as the Changes list does, and the viewer on the right with the file tabs strip above it.
- `FileTree`. A `role="tree"` of `treeitem` rows 28px high, indent 12px per level, each row a chevron icon for a folder, the name through `VisibleName` in `fg` with the folder part of nothing, since rows hold a name only, and at the right the Git letter in Geist Mono 12, `addfg` for `A`, `delfg` for `D` and `dim` for the rest, taken from the Uncommitted list by full path. A folder row opens and closes with a click, Enter, Space, Right and Left. Up, Down, Home and End move focus through visible rows, Enter or a click on a file opens it as a tab. A repository row and a link row never expand, a link opens its target text. A `listed` folder shows its entries one level deeper, each of the other states one `dim` sentence row from `file-words.ts`, and `more` one `dim` row. The root is always open. At most 16 folders are open, the root counting as one, and opening another closes the one opened longest ago. Folders on the way to the active tab open by themselves when the tab changes. The listing is requested for every open folder in one `files.list` when a folder opens, when the workspace changes and when the Files tab mounts.
- `FileTabs`. A 32px strip on `side` labelled `Open files`, each tab at most 180px with the name through `VisibleName`, the tooltip the full path through `visibleText`, a close button shown on the selected tab and on hover, a roving tab stop, the arrow keys, Home and End moving the choice, Delete closing it. Opening a path already open selects it.
- `FilePane`. For the active tab it asks `files.read` with `known` null, shows `Opening the file…` first, and draws the answer. `text` and `link` use the lazy `SideView` with `side={null}` (a plain editor, no added or removed marks, testid `file-text`, accessible label the path through `visibleText`). A `link` shows `file-link-note` above it. Every other kind shows its sentence centred, `fg2` 13px, column of at most 360px, testid `file-sentence`. A boundary shows the editor failure sentence. With no tab open it shows `file-empty`.
- `SideView` with `side={null}` skips the side decoration and the gutter sign and keeps everything else, the reveal of hidden characters and the look-alike marks on every line, the language from the path and `selectedLines` with side `"modified"`. The data-testid is `file-text` for `null`, `diff` otherwise.
- Tabs and the interface state. `use-file-tabs.ts` reads this workspace's `fileTabs` from `state.files`, opens a path at the end, selects an open one, closes at an index with the active tab moving to its neighbour, and at 12 closes the leftmost first. Each change persists through `update(..., true)`, keeps the changed entry first in `files`, and drops every entry whose workspace `listed` says is gone and every entry past 100.
- Icons. `icon.tsx` gains `chevron-right` and `chevron-down`, drawn like the others, 16px grid, no rotation.
- Scenario. `mixed-changes` per Exact values. `scenario.json`'s upstream steps gain the three files, the alpha steps gain `debug.log` and `build/out.js`, `verify/scenario.ts` accepts `{ write: { path, base64 } }` with exactly one of `content` or `base64`, and the driver writes the decoded bytes.

- [ ] **Step 1: Implement** per the interfaces. `file-words.test.ts` proves `fileSentence` answers a sentence for every kind except `text`, `link`, `image` and `same`, and that none contains a colon, which catches a kind added to the contract with no words.
- [ ] **Step 2: Tests.** `use-file-tabs.test.ts` `opens a path once, closes the leftmost at the limit, moves the active tab on close, and prunes workspaces that are gone and keeps at most 100`, on `tabsAfterOpen` and `pruneTabs`.
- [ ] **Step 3: Prove it in the real app**, quiet through the driver only. `npm run --silent verify -- mixed-changes wait-for=app-window "click=<alpha row>" click=centre-tab-files wait-for=files-tree tree shot=files-light` and again with `theme=dark`. The tree shows `src`, `assets`, `docs`, `README.md` and the rest, shows `it's new.txt` with letter `A` and `README.md` with `M`, and does not show `build`, `debug.log` or `.git`. Click `src` then through to `needle-target.ts`, the viewer shows its text. Then `click=file-text` and `type=hello` with `press=Enter`, and `text=file-text` is unchanged, with the file on disk unchanged (the journey in Task 4 asserts this by command, here the run shows the text step). Both screenshots are read, light and dark.
- [ ] **Step 4: Prove it.** `./scripts/check` green, `npm run --silent journeys` all `pass` (the `changes`, `launch` and `projects` journeys follow the centre tab and the commands).
- [ ] **Step 5: Commit.** `feat(files): a Files tab with a tree, tabs and a read-only viewer`.

---

### Task 4: Refresh, and the files journey

The tree and the open file follow the disk without any action, and a journey proves the tab, the read-only rule and the remembered tabs.

**Files:**
- Move: `src/renderer/changes/list-schedule.ts` and `list-schedule.test.ts` to `src/renderer/ui/refresh-schedule.ts` and `refresh-schedule.test.ts`, imports updated in `use-changes.ts` and `file-diff.tsx`
- Create: `src/renderer/files/use-files.ts`, `verify/journeys/files.ts`
- Modify: `src/renderer/files/files-view.tsx`, `src/renderer/files/file-pane.tsx`, `src/renderer/window/app-window.tsx`, `verify/journeys.ts`

**Interfaces:**
- Consumes: the moved `createSchedule`, `pollDelay`, `nextSteps`, `invoke`.
- Produces:
  ```ts
  export function useFiles(
    workspace: WorkspaceRef | null,
    folders: readonly string[],
    active: string | undefined,
    finished: string,
  ): { listings: ReadonlyMap<string, FolderListing>; file: FileShown | undefined; error: string | null };
  export type FileShown = { path: string; read: FileRead };
  ```
- Each tick sends one `files.list` for the open folders and, when a file is active, one `files.read` with `known` the stamp of what the pane shows (null for a new path or a kind with no stamp), together. An answer of `same` keeps the shown file. The tick's key is the JSON of the folders and of the read's answer, and `files` is true when both answered, so the doubling from 2 to 30 seconds and the resets are spec 006's exactly. Window `focus`, `visibilitychange` to visible and a change of `finished` (the keys of the workspace's `done` sessions) refresh at once, selecting another file calms the schedule to the 2 second floor, and a hidden window, another workspace or another centre tab stops the timer. A listing equal to the shown one keeps the shown object, so nothing redraws. A list or read that failed or hung keeps the last good answer on screen with the sentence beside it, and `changing`, `hung` and `unavailable` are asked again on the next tick without a stamp.
- `FilePane` takes `file` from the hook instead of reading by itself, and the tab change reads at once.

- [ ] **Step 1: Move** the schedule with `git mv`, update the three imports, `npx vitest run src/renderer` passes unchanged.
- [ ] **Step 2: Implement** `useFiles` and wire the tree and pane. The workspace's `finished` string is the one `AppWindow` already builds.
- [ ] **Step 3: Write the journey** `files`, scenario `mixed-changes`, every wait through `waitUntil` or Playwright's waiting, rows found by `data-path`.
  1. Select alpha and click `centre-tab-files`. The root lists `src`, `assets`, `docs` and `README.md`, `README.md` reads `M`, `it's new.txt` reads `A`, and no row has `build`, `debug.log` or a `.git` path. No `securitypolicyviolation` event fired since load, from a listener added at the start.
  2. Expand `src`, `deep`, `er`, `than`, `usual` and click `needle-target.ts`. A tab appears and `file-text` shows its first line.
  3. Click `file-text`, press `a` and `Backspace` and `Enter`, and type `typed`. The editor's text is equal to before, the tab shows no change, and the file on disk read with `node:fs/promises` is byte for byte what it was.
  4. Append a line to that file on disk. Without any click the editor shows it. Write `fresh.txt` into `src` on disk. Without any click a row appears in the tree.
  5. Open `README.md` as a second tab, close the first with its button, open the first again, and press Delete on a focused tab. The strip follows.
  6. Open two files, `relaunch` the app, select alpha again, click Files. Both tabs are there and the same one is active, and the tree has opened the folders on the way to it.
  7. Write an ignored file `ignored.log` into the worktree and reach `files.read` for it through the page. It answers `ignored` (the boundary journey proves the channel, here the tree never shows it).
  8. `consoleErrors` is empty, `close()` reports no leftover.
- `journeys.ts` lists `files` right after `changes`.
- [ ] **Step 4: Check the journey can fail.** With the poll off for one run step 4 fails with a legible reason, then the poll is restored.
- [ ] **Step 5: Prove it.** `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 6: Commit.** `feat(files): follow the disk while the tab is visible` (with the schedule move as its own commit, `refactor: move the refresh schedule to ui`).

---

### Task 5: Open by name

One shortcut opens the finder, which finds a file deep in the tree by fuzzy name.

**Files:**
- Create: `src/renderer/files/use-file-search.ts`
- Modify: `src/renderer/palette/palette.tsx`, `src/renderer/window/app-window.tsx`, `src/renderer/commands/command-registry.ts` (already has `files.open`), `src/renderer/files/file-words.ts`, `verify/journeys/files.ts`

**Interfaces:**
- Consumes: Task 2's `files.find`, the palette.
- Produces:
  ```ts
  type PaletteMode = "commands" | "switcher" | "files";
  interface PaletteProps { /* as today, plus */ files: FileSearch; onOpenFile: (path: string) => void; onQuery: (query: string) => void }
  export type FileSearch = { query: string; state: "idle" | "searching" | "found" | "too-many" | "hung" | "failed"; paths: readonly string[] };
  export function useFileSearch(workspace: WorkspaceRef | null, active: boolean): { search: FileSearch; ask: (query: string) => void };
  ```
- `ask` waits 120 milliseconds after the last key, sends `files.find`, ignores an answer that is not for the latest query, and goes `idle` for an empty one. A new query supersedes the old on the main side as well. The palette's `files` mode shows the paths as options, the file name in `fg` and its folder in `dim` through `visibleText`, testids `file-result-<index>` with `data-path`, ranked in main so the palette does not rank them again. It shows the sentences from Copy for `idle`, `too-many`, `hung` and `failed`, and the existing `Nothing matches that.` for a `found` with no paths. Enter opens the active result through `onOpenFile`, which switches to the Files tab and opens the tab.
- `files.open` is `{ key: "f" }`, available while shown, and toggles the palette in `files` mode as `palette.switcher` does, and the Files tab becomes the centre tab when a result opens.

- [ ] **Step 1: Implement** per the interfaces. The palette's mode switch resets the query as it does today.
- [ ] **Step 2: Tests.** The shared `fuzzy-match.test.ts` moved in Task 1 keeps proving the matcher. `use-file-search` is glue and gets no test.
- [ ] **Step 3: Journey step.** `files` journey gains, after step 6, with the Files tab not selected first, `press` of the platform's shortcut for F, `type=needle`, a result `file-result-0` with `data-path` `src/deep/er/than/usual/needle-target.ts`, Enter, and `file-text` showing that file with the Files tab selected. A query with no match shows `palette-empty`, and `debug.log` and `build/out.js` are never offered.
- [ ] **Step 4: Prove it by the driver.** `npm run --silent verify -- mixed-changes ... click=centre-tab-changes press=Meta+f type=needle shot=find`, with the shortcut for the system the run is on, and read the screenshot.
- [ ] **Step 5: Prove it.** `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 6: Commit.** `feat(files): open a file by fuzzy name`.

---

### Task 6: Selected lines to the prompt

Selecting lines in a file and pressing Send lines, or Cmd+L, or Ctrl+Shift+L, types a reference into the Claude Code prompt.

**Files:**
- Modify: `src/renderer/window/app-window.tsx`, `src/renderer/files/files-view.tsx`, `src/renderer/files/file-pane.tsx`, `src/renderer/files/file-words.ts`, `verify/driver.ts`, `verify/journeys.ts`, `verify/cli.ts`, `verify/journeys/files.ts`

**Interfaces:**
- Consumes: `lineReference`, `sendToClaudeCode`, `useDiffSelection`.
- Produces: `AppSession.selectFileLines(start: number, end: number): Promise<void>` and the step `file-lines=<start>-<end>`, which click the line numbers of `[data-testid="file-text"] .line-numbers`, the end with Shift, and wait until the focus is inside `file-text`. `noFileLinesSentence = "Select some lines in the file first."`.
- `changes.send-lines` per Commands. Its `run` branches on the centre tab. On Files it reads the selection from the pane's `DiffHandle` with side `modified` and calls `lineReference({ path, side: "modified", view: "uncommitted", base: null, start, end })`, which gives `Lines 12 to 18 of src/app.ts in this workspace. `, refusing a hidden or `@` name and an over long path as for diffs, and sends it. Nothing selected answers the file sentence as an error toast. A link shows its target text, which a reference to lines of it is no use for, so the command is unavailable for a `link`. The `Send lines` button is the same command with testid `file-send-lines`, disabled while no text file shows.

- [ ] **Step 1: Implement** per the interfaces.
- [ ] **Step 2: Tests.** The reference text and refusals are `prompt-requests.test.ts` from spec 006 and are unchanged, so no new test.
- [ ] **Step 3: Prove it by the driver.** `npm run --silent verify -- mixed-changes ... file-lines=2-3 press=<the shortcut> send ...` as the `changes` journey does, so the stand-in Claude Code that reports one prompt gets the text, and the output shows the prompt holding `Lines 2 to 3 of "src/app.ts" in this workspace.` exactly as spec 006's diff reference reads for a modified file, and nothing submitted.
- [ ] **Step 4: Journey step.** `files` journey gains, after the find, open `src/app.ts`, `selectFileLines(2, 3)`, press the platform's shortcut, and the sessions pane's prompt holds the reference. With focus in the tree the shortcut does nothing, as for the diff, and the button works from anywhere.
- [ ] **Step 5: Prove it.** `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 6: Commit.** `feat(files): send selected lines to the Claude Code prompt`.

---

### Task 7: Images and the sentences

Images draw, and every sentence a file or folder can end in is proven on screen.

**Files:**
- Create: `src/renderer/files/image-view.tsx`
- Modify: `src/renderer/files/file-pane.tsx`, `verify/journeys/files.ts`

**Interfaces:**
- Consumes: `FileRead` answers of kind `image`, `imageType`.
- Produces: `ImageView({ type, data, name })` drawing one `<img>` with `src` `data:${type};base64,${data}`, the file's name through `visibleText` as its `alt`, `draggable={false}`, `decoding="async"`, scaled down to fit and never up (`max-w-full max-h-full`, centred on `side`), testid `file-image`. It is built from the contract's closed `type` and its validated base64 only, and the page builds no other URL anywhere. Only the active tab is mounted, so at most one image is decoded at a time.

- [ ] **Step 1: Implement** the view and the pane's `image` case.
- [ ] **Step 2: Journey steps.** `files` journey gains: open `assets/pixel.png` and `file-image` is visible with `naturalWidth` 1 and a `data:image/png` source, no `securitypolicyviolation`. Write into the alpha worktree a text file of 30000 lines and open it, `file-sentence` reads the large sentence and `page.evaluate(() => 1)` answers within 2 seconds. Write a file holding a NUL byte and one holding invalid UTF-8 and open each, the binary and the not-UTF-8 sentences. Write a PNG header that claims 10000 by 10000 into a file, the large sentence, which is the bomb refusal. Write `shape.svg` and it opens as text in the editor. Delete the open file on disk and without any click the pane reads the gone sentence. A folder holding a `.git` entry made by `git init` inside the worktree shows as a repository row that does not expand.
- [ ] **Step 3: Prove it by the driver.** `npm run --silent verify -- mixed-changes ... shot=image-light` and `theme=dark` for the image and for the large sentence, and read the screenshots.
- [ ] **Step 4: Prove it.** `npm run --silent journeys` all `pass`, `./scripts/check` green.
- [ ] **Step 5: Commit.** `feat(files): draw images and say why a file is not shown`.

---

### Task 8: Docs, skills and status Done

**Files:**
- Modify: `ARCHITECTURE.md`, `SATELLITE.md`, `DESIGN.md`, `.claude/skills/satellite-stack/SKILL.md`, `.claude/skills/satellite-verify/SKILL.md`, `AGENTS.md` only if the Map table needs a row (a new top-level folder does not), `specs/007-files/spec.md`, `specs/README.md`

- [ ] **Step 1: ARCHITECTURE.md.**
  - Bridge. Rows for `files.list`, `files.read` and `files.find` with what each does, the limits from Exact values and what a hostile page could do from here. The `interface.load` and `interface.save` rows gain the saved tabs. The error paragraph's `limit` gains 16 files reads waiting.
  - State. `interface.json` version 3 with `files`, the versions it reads, the bounds, that the page prunes it and an older build sets a version 3 file aside.
  - Projects, Reads paragraph. The new git commands, `check-ignore -z --stdin` and `ls-files -z --cached --others --exclude-standard`, what each can start (nothing, once fsmonitor is off, as the marker run showed), that neither writes and that `input` is the one new capability of the platform run.
  - Platform. `runTool`'s `input` option.
  - A new section `## Files` after Changes. The path rule in five steps, ignored files neither listed nor read and why, the tracked exception, the fail closed rule, the per folder check and its submodule answer, repository and link rows, the bounds, the name list, images (formats, header size check, the closed media type, no SVG, no file URL), per page ownership, the refresh and the stamp, and the two symlinked or repository-chosen ignore file leaks named in Rulings checked.
  - Diff. `SideView` with no side is the plain file view.
  - Folder layout. `src/main/files/`, `src/renderer/files/`, `src/shared/fuzzy-match.ts`, `src/renderer/ui/refresh-schedule.ts`, the palette row mentions the finder.
  - Decisions. Rows for the folder listing by `opendir` and `check-ignore` over a tree read or a whole-repository list, ignored files unreadable, images as `data:` URLs from a closed list with no SVG, tabs in `interface.json` over a new file.
- [ ] **Step 2: SATELLITE.md.** A `## Files` section after Changes, in sentences, the tab, the tree with letters and folders that load when opened, what is hidden and why, tabs and what is remembered, open by name on Cmd+F or Ctrl+Shift+F, the refresh, sending lines, images, and the sentence for binary, large and non-UTF-8 files. Principle checks stay as they are.
- [ ] **Step 3: DESIGN.md.** In App, one bullet for the Files view, the centre tab strip with two tabs, the 260px tree, row height and indent, the letter colours, the file tab strip, the centre sentence, the image on `side`, and the finder as the palette's third mode. Components names the file tabs next to the session tabs.
- [ ] **Step 4: Skills.** `satellite-stack`, `runTool` takes `input`, a feature that reads files for a page names a path and confines it with the five steps, `Segmented` unchanged, the schedule now lives in `ui/`. `satellite-verify`, the `file-lines` step, `AppSession.selectFileLines`, the `base64` write, the `files` journey row, the `boundary` row with the files refusals, `mixed-changes` with its ignored and deep files and its pixel, and feature map rows for 007.
- [ ] **Step 5: Status.** Spec and index to **Done**, and tick the spec's acceptance items. Leave `plan.md` to the controller.
- [ ] **Step 6: Check.** `./scripts/check` and `npm run --silent journeys` green, last lines in the report. Commit `docs: describe files and mark spec 007 done`.

---

## Acceptance map

| Acceptance item or scope bullet | Task | Proof |
| --- | --- | --- |
| The tree shows tracked and untracked files and hides ignored ones | 1, 3, 4 | `folder-listing.test.ts`, scenario `mixed-changes` in Task 3 Step 3, `files` journey step 1 |
| Open by name finds a file deep in the tree | 1, 5 | `name-index.test.ts`, the driver run in Task 5 Step 4, `files` journey find step |
| A file changed on disk updates in its open tab | 4 | `files` journey step 4 |
| No path from the interface can read outside the workspace folder, including through a symlink | 1, 2 | `file-read.test.ts`, `folder-listing.test.ts`, `files-handlers.test.ts`, `registry.test.ts`, the `boundary` journey |
| Selected lines arrive in the prompt as a reference | 6 | the driver run in Task 6 Step 3, `files` journey lines step |
| Typing in an open file changes nothing | 3, 4 | Task 3 Step 3 `type` run, `files` journey step 3 with the file on disk compared |
| Scope, the Files tab with Git letters | 3 | Task 3 screenshots, `files` journey step 1 |
| Scope, folders load when opened | 1, 3 | `listFolder` reads one folder, `files.list` bounds, the 16 folder limit |
| Scope, several files open as tabs, remembered per workspace | 2, 3, 4 | `interface-file.test.ts`, `use-file-tabs.test.ts`, `files` journey steps 5 and 6 |
| Scope, the tree and open files update from disk | 4 | `files` journey step 4 |
| Scope, images shown, other binary and very large files a sentence | 1, 7 | `image-size.test.ts`, `file-read.test.ts`, `files` journey Task 7 steps |
| Security, nothing in a repository is written and no program the repository chose starts | 1 | `ignore-check.test.ts` marker test, Rulings checked |
