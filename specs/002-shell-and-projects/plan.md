# Shell and projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three columns become a working shell. Projects are added from a folder dialog or a drop, listed in the sidebar with their main workspace and branch, removed by forgetting them, and restored on restart with the selection, the column widths and the theme. One command registry feeds buttons, shortcuts, the command menu and the quick switcher, and a real first run check names what is missing and the command that fixes it.

**Architecture:** The background process owns all state. Two JSON files in the Satellite home are read once through a zod schema, set aside when unreadable, and written atomically through one serialised writer per file. The interface never sends a path it chose itself. A folder comes from the native dialog the background process opens, or from a dropped file whose path only the preload can read, and either way it passes one repository check through `git`. The theme is applied with Electron's `nativeTheme.themeSource`, so CSS, the terminal, the diff and the native dialog all follow with no new styling code. The interface holds its state in React, with one small command registry and one palette component.

**Tech Stack:** As in spec 001. Electron 45, React 19, TypeScript 6, zod 4, Tailwind 4, Vitest 5, playwright-core 1.65. No new dependency of any kind.

**Spec:** `specs/002-shell-and-projects/spec.md`

## Verified facts

Checked in the code on `spec/001-foundation`, in the installed typings and in current docs while planning.

- **Electron 45.3.4 is installed, 45.4.1 is latest stable** (`npm view electron version`). No upgrade is part of this plan.
- **Folder drops.** `File.path` is gone. `webUtils.getPathForFile(file)` answers the path of a `File` backed by disk and an empty string for one made in JavaScript, and throws for anything that is not a `File` (electronjs.org web-utils). `webUtils` is one of the six modules a sandboxed preload may load (electronjs.org sandbox tutorial). The installed typings declare `getPathForFile(file: File): string`. So a drop needs one narrow preload function, nothing else.
- **Folder dialog.** `dialog.showOpenDialog(window, { properties: ["openDirectory"] })` resolves `{ canceled, filePaths }`, and passing the window makes it a sheet on macOS (electronjs.org dialog).
- **Theme.** Setting `nativeTheme.themeSource` to `light` or `dark` makes `prefers-color-scheme` match it in every renderer, sets `shouldUseDarkColors`, switches native menus, dialogs and window frames, and emits `updated`. `system` removes the override (electronjs.org native-theme). `app.css` already switches every token on `prefers-color-scheme`, and `terminal-theme.ts` and `monaco-environment.ts` already rebuild on its `change` event, so the override needs no CSS or listener change.
- **The brand columns.** BRAND.html chapter 09 draws `.s-app` as `248px minmax(0,1fr) var(--rw,440px)` and labels them `Left · 248` and `Right · 440`. The window's `minWidth` is 960 (`src/main/window/main-window.ts`).
- **`git rev-parse` shapes**, recorded with git 2.50.1 for `git -C <folder> rev-parse --path-format=absolute --is-bare-repository --is-inside-git-dir --git-dir --git-common-dir --show-toplevel`. Root of a working tree, exit 0 and five lines, `false`, `false`, `<root>/.git`, `<root>/.git`, `<root>`. A subfolder, the same five lines with the toplevel above it. Inside `.git`, exit 128 with `false`, `true`, two paths and `fatal: this operation must be run in a work tree` on stderr. A bare repository, exit 128 with `true`, `true`, two paths and the same stderr. A linked worktree, exit 0 with `<main>/.git/worktrees/<name>` as git dir and `<main>/.git` as common dir. A plain folder, exit 128 with no stdout and `fatal: not a git repository (or any of the parent directories): .git`. `git branch --show-current` prints the branch, also on an unborn branch, and an empty line when HEAD is detached. Neither command writes anything into the repository.
- **`gh auth status`.** gh 2.80 has `--active` and `--hostname` and no `--json`. The current manual lists `--json hosts`, so it is newer than many installs and this plan parses the text. Success prints `✓ Logged in to <host> account <login> (<source>)` with a masked `Token:` line, older releases print `Logged in to <host> as <login>`. With nothing signed in it prints `You are not logged into any GitHub hosts. To log in, run: gh auth login` and exits 1. Any account with a problem exits 1 and writes to stderr. It contacts GitHub to check the token, so it can be slow or fail offline.
- **Install commands** from current docs. Claude Code's recommended install is `curl -fsSL https://claude.ai/install.sh | bash` on macOS and Linux and `winget install Anthropic.ClaudeCode` on Windows, and `claude --version` prints `2.1.211 (Claude Code)` (code.claude.com setup).
- **Driver.** Playwright 1.65 understands the `ControlOrMeta` modifier, so `press=ControlOrMeta+K` is one step on every platform. The protocol's `Input.dispatchDragEvent` takes `data.files`, a list of paths to include in a drop (playwright-core `types/protocol.d.ts`).
- **Kit values** come from BRAND.html chapter 08 and 09 CSS (`.k-btn`, `.k-kbd`, `.k-pix`, `.k-av`, `.k-toast`, `.k-pal`, `.s-side`, `.s-row`, `.s-sec`, `.s-proj`, `.s-ws`, `.s-hd`, `.s-card`, `.s-chk`) and are copied into each part below. BRAND's own shortcuts sheet says that when Claude Code has focus every key goes to it and only ⌘ shortcuts reach Satellite.
- **Not confirmed.** Whether `Input.dispatchDragEvent` with a folder in `files` yields a `File` whose `webUtils.getPathForFile` answers that folder in Electron 45. Task 6 checks it first and falls back to a manual drop run if not. Whether a `File` passed through `contextBridge` arrives as a `File` the preload can hand to `webUtils` is shown by Electron's own docs example, and Task 6 proves it by a real drop.

### Rulings checked

- **Theme override, changed.** A data attribute on the root would duplicate the dark token block in CSS, and the terminal and diff would need a second signal to rebuild on. `nativeTheme.themeSource` does all of it, also for the native folder dialog and the window background, with no CSS change. The theme choice is still stored in the interface state.
- **Drop path, refined.** The interface can only learn a path for a `File` the user really dropped, but the bridge request that carries it can be forged by a page that runs hostile script. That page can already run any command through `terminal.write` and Claude Code's `!` shell, so `projects.drop` adds nothing it could not do, and the same repository check applies. This is recorded as a security decision. The dialog stays the path that never trusts the interface.
- **Ctrl shortcuts in the terminal.** On Windows and Linux, Ctrl+K and Ctrl+P are line editing keys inside Claude Code. While the terminal has focus they go to the terminal, as BRAND's shortcuts sheet says. Cmd shortcuts on macOS always reach Satellite.
- **Everything else stands** as the controller ruled, with the exact values below.

## Global Constraints

Every task is bound by `.superpowers/sdd/global-constraints.md`, `AGENTS.md`, `.claude/skills/satellite-conventions/SKILL.md`, `.claude/skills/satellite-stack/SKILL.md` (the bridge recipe), `.claude/skills/satellite-verify/SKILL.md`. No comments, no casts, no `any`, kebab-case, named exports, tests only where listed, no home-folder paths in any file, never push.

Exact values for this spec.

- **Files in the Satellite home.** `projects.json` and `interface.json`, mode `0600`. An unreadable file is renamed to `projects.unreadable-<Date.now()>.json` or `interface.unreadable-<Date.now()>.json` beside it. A write goes to `.<file>.<uuid>.tmp` in the same folder, then renames over the file. Leftover `.<file>.<uuid>.tmp` files are deleted on the first read.
- **`projects.json`.** `{ "version": 1, "projects": [{ "id": "<uuid>", "path": "<absolute real path of the working tree root>" }] }`, at most 200 projects, paths at most 4096 characters, ids and paths unique. The name shown is the folder's base name, never stored.
- **`interface.json`.** `{ "version": 1, "selected": { "projectId": "<uuid>", "workspace": "main" } | null, "columns": { "left": <int>, "right": <int> }, "theme": "system" | "light" | "dark" }`.
- **Versioning.** Both schemas are strict and `version` is `z.literal(1)`. A later spec that changes a file raises the integer and migrates the older shape on read. A file with an unknown version is set aside like a corrupt one.
- **Columns.** Left default 248, 200 to 360. Right default 440, 360 to 640. The centre never below 400. When the window is too narrow the right column gives way first, then the left, down to their minimums. Stored widths are what the user chose, the drawn widths are clamped.
- **Shared schemas** in `src/shared/bridge-contract.ts`. `themeChoice = z.enum(["system", "light", "dark"])`. `workspaceRef = z.strictObject({ projectId: z.uuid(), workspace: z.literal("main") })`. `interfaceState = z.strictObject({ selected: workspaceRef.nullable(), columns: z.strictObject({ left, right }), theme: themeChoice })` with the bounded ints above. `workspaceView = z.strictObject({ key: z.literal("main"), branch: z.string().min(1).max(255).nullable() })`. `projectView = z.strictObject({ id: z.uuid(), name: z.string().min(1).max(255), missing: z.boolean(), workspaces: z.array(workspaceView).max(1) })`. Exported types `ThemeChoice`, `WorkspaceRef`, `InterfaceState`, `WorkspaceView`, `ProjectView`, `ToolCheck`, and `interfaceLimits` and `defaultInterfaceState`. Spec 003 widens `workspace` and `key` to `z.union([z.literal("main"), z.uuid()])` and adds a `worktree` shape, without touching the rest.
- **Bridge channels added.** `interface.load`, `interface.save`, `projects.list`, `projects.choose`, `projects.drop`, `projects.remove`, `tools.check`. `tools.versions` is removed with the tool readout. Error code `refused` joins `bridgeErrorCode`.
- **Preload.** `window.satellite` gains exactly one function, `pathForFile(file: unknown): string`, which answers `""` for anything that is not a dropped file.
- **Environment.** `SATELLITE_VERIFY_FOLDER_DIALOG`, the absolute path of a file. When set, the folder dialog never opens. The file's trimmed content is the chosen folder, and a missing or empty file means canceled. Read only in `src/main/platform/folder-dialog.ts`.
- **Command ids, titles and shortcuts** (Mod is Cmd on macOS and Ctrl elsewhere). `palette.commands` "Open the command menu" Mod+K. `palette.switcher` "Go to a workspace" Mod+P. `project.add` "Add a project" Mod+O. `project.remove` "Remove project". `tools.check` "Check git, gh and Claude Code". `theme.system` "Follow the system theme". `theme.light` "Use the light theme". `theme.dark` "Use the dark theme". The command menu lists every available command except `palette.commands`, in this order, `project.add`, `project.remove`, `palette.switcher`, `tools.check`, `theme.system`, `theme.light`, `theme.dark`.
- **Test ids.** Kept, `app-window`, `column-projects`, `column-repository`, `column-sessions`, `start-claude`, `terminal`, `diff`. Removed, `tool-git`, `tool-gh`, `tool-claude`. New, `divider-left`, `divider-right`, `open-command-menu`, `open-switcher`, `add-project`, `no-projects`, `project-<name>`, `workspace-<name>-main`, `workspace-header`, `remove-project`, `folder-missing`, `nothing-selected`, `welcome` (Task 3 only), `tool-check`, `check-git`, `check-gh`, `check-claude`, `check-again`, `add-first-project`, `close-check`, `palette`, `palette-input`, `palette-empty`, `command-<id with dots as hyphens>` (as in `command-project-add`), `switch-<name>-main`, `toast`, `toast-dismiss`, `drop-overlay`.
- **Scenarios.** Updated `default`, `flood`. New `corrupt-state`, `claude-missing`, `not-signed-in`, `two-projects`. **Steps.** New `restart`, `choose-folder=<target>`, `drop=<target>`. **Journeys.** Updated `launch`, `boundary`. New `projects`.
- **Copy.** Every sentence is fixed in the task that shows it. No colons in prose, sentences end with a full stop, titles do not.

## Review Focus

1. **A state file written by a crash, a newer Satellite or a hand edit.** The app must start, set the file aside without deleting it, use defaults and say so once. Tests in Task 1 pin truncated JSON, an unknown version and a bad entry, and the `corrupt-state` scenario proves the start.
2. **The same repository added twice at once, or by two spellings of its path.** Two quick clicks, a symlinked path, different letter case on macOS or Windows, or a trailing slash must still give one project. Task 3 keys duplicates on git's own toplevel through `samePath` and re-checks right before inserting, with a test for `samePath`.
3. **A folder that stops being there.** Deleted, renamed or on an unmounted drive after it was added. The row must show it, selecting it must say so, removing it must work, and nothing may throw. Task 3 covers it with `missing` and the `folder-missing` sentence, proven by deleting a folder between two launches.
4. **Ctrl shortcuts on Windows and Linux while Claude Code has focus.** Ctrl+K and Ctrl+P must reach Claude Code, Cmd+K on macOS must reach Satellite, and AltGr (Ctrl+Alt) must never fire a command. Task 2's shortcut tests pin each case.
5. **A slow or offline `gh auth status`.** It contacts GitHub. The check must never hang the card or show a token, and an offline answer must read as unconfirmed, not as signed out with no reason. Task 4 bounds it at 10 seconds and its parser test pins the failed-account output and that no token text survives.

---

### Task 1: State files, resizable columns and the restart step

Sets the spec In progress, adds the state store and the interface state, makes both side columns resizable and remembered, applies the saved theme at start, and gives the driver `restart` and a seeded home.

**Files:**
- Modify: `specs/002-shell-and-projects/spec.md` (status), `specs/README.md` (002 row), both to **In progress**
- Create: `src/main/state/json-file.ts`, `src/main/state/json-file.test.ts`, `src/main/state/interface-file.ts`, `src/main/window/theme.ts`, `src/renderer/window/column-divider.tsx`, `src/renderer/window/columns.ts`, `src/renderer/window/interface-state.ts`, `verify/scenarios/corrupt-state/scenario.json`
- Modify: `src/shared/bridge-contract.ts`, `src/main/main.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/entry.tsx`, `src/renderer/window/app-window.tsx`, `src/renderer/styles/app.css`, `verify/scenario.ts`, `verify/driver.ts`, `verify/cli.ts`, `verify/journeys.ts`

**Interfaces:**
- Produces, main:
  - `readJsonFile<T>(file: string, schema: z.ZodType<T>, fallback: T): Promise<{ value: T; setAside: string | undefined }>`. Missing file gives the fallback with `setAside` undefined. Any other read error, invalid JSON or a schema failure renames the file to `<stem>.unreadable-<Date.now()>.json` and answers the fallback with the new base name, and if the rename fails too it still answers the fallback. It first deletes `.<base>.<uuid>.tmp` leftovers in the folder. Never throws.
  - `createJsonWriter(file: string): (value: unknown) => Promise<void>`. Writes are chained so they never overlap. Each writes `JSON.stringify(value, null, 2)` plus a newline to `.<base>.<randomUUID()>.tmp` opened with flag `wx` and mode `0o600`, syncs it, closes it and renames it over the file, retrying the rename up to 5 times 50 ms apart on `EPERM`, `EACCES` or `EBUSY`. On failure it deletes the temp file and rejects. A rejected write does not stop later writes.
  - `createInterfaceFile(home: string): { load(): Promise<{ state: InterfaceState; notice: string | null }>; save(state: InterfaceState): Promise<void> }`. The first `load` reads and caches, later loads answer the cache with `notice: null`. The file schema is `interfaceState.extend({ version: z.literal(1) })`, strict.
  - `interfaceHandlers(file, applyTheme: (theme: ThemeChoice) => void): Pick<BridgeHandlers, "interface.load" | "interface.save">`. `interface.save` applies the theme, updates the cache and writes. A failed write throws `BridgeFailure("failed", "Satellite couldn't save the layout. It keeps working and saves again on the next change.")`.
  - `applyThemeChoice(theme: ThemeChoice): void` in `src/main/window/theme.ts`, sets `nativeTheme.themeSource`.
- Produces, contract: the shared schemas, `interfaceLimits = { left: { min: 200, max: 360, initial: 248 }, right: { min: 360, max: 640, initial: 440 }, centreMin: 400 }`, `defaultInterfaceState`, error code `refused`, and channels `"interface.load": { request: empty, response: z.strictObject({ state: interfaceState, notice: z.string().max(300).nullable() }) }` and `"interface.save": { request: z.strictObject({ state: interfaceState }), response: empty }`.
- Produces, renderer: `fitColumns(chosen: { left: number; right: number }, windowWidth: number): { left: number; right: number }` in `columns.ts`. `useInterfaceState(initial: InterfaceState): { state: InterfaceState; update(next: InterfaceState, persist: boolean): void }` in `interface-state.ts`, where `persist` sends `interface.save` with the whole state and shows its failure through the caller's notify (Task 3 adds the toast, until then it logs to the console with `console.warn`, and that warn is removed in Task 3). `ColumnDivider({ side: "left" | "right", value: number, min: number, max: number, onChange(value: number): void, onCommit(value: number): void, testId: string })`.
- Produces, verify: scenario field `home?: { path: string; content: string }[]` written inside the Satellite home before launch with the same confinement as repo writes. `AppSession.relaunch(): Promise<void>` closes the app, keeps the temp folder and launches again with the same home, repo and log, after which `session.page` is the new page (make `page` a getter, and make the wrapper in `journeys.ts` forward it instead of spreading it). CLI step `restart` calls it.

- [ ] **Step 1: Status.** Set **In progress** in the spec and its index row.

- [ ] **Step 2: Reader and writer tests.** In `src/main/state/json-file.test.ts`, against real temp folders from `mkdtemp`, with a schema `z.strictObject({ version: z.literal(1), names: z.array(z.string()) })` and fallback `{ version: 1, names: [] }`.
  - `answers the fallback and sets nothing aside when the file is missing`
  - `sets aside truncated JSON and answers the fallback`, content `{"version":1,"names":["a"` gives the fallback, `setAside` matching `/^state\.unreadable-\d+\.json$/`, the set-aside file holding the original bytes and `state.json` gone
  - `sets aside a file with an unknown version`, `{"version":2,"names":[]}`
  - `sets aside a file whose entries fail the schema`, `{"version":1,"names":[3]}`
  - `answers the fallback when the path is a folder`, never rejecting
  - `deletes temp files a crash left behind`, a `.state.json.<uuid>.tmp` file is gone after a read
  - `keeps the last of many overlapping writes and leaves no temp file`, twenty writes started together, then the file parses to the twentieth value and the folder holds only `state.json`
  - `writes the file readable only by its owner`, mode `0o600`, skipped on Windows with `it.skipIf(process.platform === "win32")`
  
  Run `npx vitest run src/main/state/json-file.test.ts` and see it fail because the module does not exist.

- [ ] **Step 3: The store.** Implement `readJsonFile` and `createJsonWriter` per the interfaces, then the interface file and handlers. The notice when the interface file was set aside reads `Satellite couldn't read its saved layout, so it set that file aside and started fresh.` Run the test, it passes.

- [ ] **Step 4: Contract and wiring.** Add the schemas, limits, code and the two channels. In `main.ts` create the interface file from `prepareSatelliteHome()`'s result, `await` its first `load()` and call `applyThemeChoice` before `createMainWindow`, so the window background and first paint already match. Wire `interfaceHandlers`. Add both spies to `registry.test.ts`, plus `refuses interface state out of bounds` with `columns.left` 199 and 361, `columns.right` 641, `theme: "sepia"`, `selected.workspace: "other"` and an extra key, each `invalid-request` with no handler run.

- [ ] **Step 5: The columns.** `entry.tsx` awaits `invoke("interface.load", {})` alongside the fonts and passes `initial` and `notice` to `AppWindow` (`defaultInterfaceState` and the error message when it fails). `AppWindow` draws the grid as `${left}px minmax(0,1fr) ${right}px` from `fitColumns(state.columns, width)`, with the width from a `ResizeObserver` on `app-window`. `fitColumns` gives each column its chosen width clamped to its own limits, then while left plus right exceeds `windowWidth - 400` it takes from the right down to 360, then from the left down to 200. A `ColumnDivider` sits over each inner hairline.
  - Element `div` with `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label` "Resize the projects column" or "Resize the sessions column", `tabIndex={0}`, `data-testid`.
  - Absolutely placed, 6px wide, centred on the column's existing 1px `border-line` hairline, full height, `cursor-col-resize`, `touch-action: none`, no background at rest. Hover shows a 1px `bg-ctl` line, `focus-visible` and dragging show a 2px `bg-accent` line, no outline. Transition 120ms, none with `motion-reduce`.
  - Pointer down captures the pointer, moves update through `onChange` and pointer up calls `onCommit`. The right divider grows its column when moved left. ArrowLeft and ArrowRight change the value by 8 and commit at once, clamped to min and max. Only commits persist.
  
  The proving parts keep their places. Add nothing else to the columns.

- [ ] **Step 6: Driver.** Add `home` to `scenarioSchema` and write its files in `prepareFolders` with the same inside check as `writeInside` (reuse it, exported from `repo-recipe.ts`). Implement `relaunch` and the `restart` step with a 75 second timeout. Write `verify/scenarios/corrupt-state/scenario.json`, the `default` repo and stand-ins plus `home` holding `interface.json` with content `{"version":1,"columns":` and description "A fresh repo with a Satellite home whose saved layout was cut off mid-write." Until Task 3 adds toasts, the notice is drawn as one `p` with `text-[13px] text-dim` at the top of the centre column, test id `toast`, which Task 3 replaces.

- [ ] **Step 7: Prove it.**
  - `npm run --silent verify -- default wait-for=app-window click=divider-left press=ArrowRight press=ArrowRight press=ArrowRight press=ArrowRight shot=columns-light restart wait-for=app-window shot=columns-restored theme=dark shot=columns-dark` shows the projects column wider by 32 pixels in all three shots, the same width after the restart, and the terminal still filling the right column.
  - `npm run --silent verify -- default wait-for=app-window resize=980x700 shot=columns-narrow` shows the centre at 400 or more with the right column narrowed first.
  - `npm run --silent verify -- corrupt-state --keep wait-for=toast text=toast shot=corrupt-light theme=dark shot=corrupt-dark` answers the notice sentence, and `ls` on the printed `home` shows `interface.unreadable-<digits>.json` and a new `interface.json` only after a divider commit.
  - `./scripts/check` and `npm run --silent journeys` green.

- [ ] **Step 8: Commit.** `feat(state): remember the column widths in the Satellite home` and `test(verify): restart the app and seed its home in a scenario`.

---

### Task 2: The command registry, shortcuts and the command menu

One registry for every action, the platform shortcut matcher, the palette in command menu mode, and the theme commands.

**Files:**
- Create: `src/renderer/commands/shortcuts.ts`, `src/renderer/commands/shortcuts.test.ts`, `src/renderer/commands/command-registry.ts`, `src/renderer/commands/command-registry.test.ts`, `src/renderer/commands/commands-context.tsx`, `src/renderer/palette/fuzzy-match.ts`, `src/renderer/palette/fuzzy-match.test.ts`, `src/renderer/palette/palette.tsx`, `src/renderer/ui/icon.tsx`, `src/renderer/ui/key-hint.tsx`
- Modify: `src/renderer/ui/button.tsx`, `src/renderer/window/app-window.tsx`, `src/renderer/styles/app.css`, `src/renderer/proving/claude-pane.tsx`, `src/renderer/terminal/terminal-view.tsx` (only the `Button` call sites if the props change)

**Interfaces:**
- Consumes: `useInterfaceState` and `ThemeChoice` from Task 1.
- Produces:
  - `type KeyboardPlatform = "mac" | "other"`, `interface Shortcut { key: string; shift?: boolean }` (always with Mod), `interface KeyPress { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }`, `keyboardPlatform(): KeyboardPlatform` (from `navigator.userAgent` containing `Mac`), `matchesShortcut(press: KeyPress, shortcut: Shortcut, platform: KeyboardPlatform): boolean`, `shortcutLabel(shortcut: Shortcut, platform: KeyboardPlatform): string`.
  - `type CommandId = "palette.commands" | "palette.switcher" | "project.add" | "project.remove" | "tools.check" | "theme.system" | "theme.light" | "theme.dark"`, `interface Command { id: CommandId; title: string; shortcut?: Shortcut; available: boolean; run(): void }`, `interface CommandRegistry { readonly commands: readonly Command[]; get(id: CommandId): Command | undefined; forKey(press: KeyPress, platform: KeyboardPlatform): Command | undefined }`, `createCommandRegistry(commands: readonly Command[]): CommandRegistry`, throwing on a duplicate id or a duplicate shortcut.
  - `CommandsProvider({ registry, children })`, `useCommands(): CommandRegistry`, `CommandButton({ command: CommandId; children?: ReactNode; variant?; size?; icon?; testId? })` which renders `Button` with the command's title unless children are given, its shortcut label, `disabled` when not available, and `run` on click. Inside `CommandsProvider` one `keydown` listener on `window` in the capture phase runs `forKey`'s command when it is available, with `preventDefault` and `stopPropagation`, except when the platform is `other` and the event target is inside `.xterm`.
  - `fuzzyScore(query: string, text: string): number | undefined`, `rankMatches<T>(query: string, items: readonly T[], textOf: (item: T) => string, limit?: number): T[]` (default limit 50, empty query keeps the input order, ties keep the input order).
  - `Palette({ mode: "commands" | "switcher"; onClose(): void; switcher: readonly SwitcherItem[]; onOpenWorkspace(ref: WorkspaceRef): void })` with `interface SwitcherItem { ref: WorkspaceRef; label: string; project: string }`. Task 3 feeds `switcher`, until then it is empty.
  - `Button({ children?, onClick, testId?, variant?: "primary" | "secondary" | "ghost", size?: "default" | "small", icon?: IconName, shortcut?: string, disabled?: boolean, label?: string })`, primary and default by default so today's call sites keep working. `Icon({ name: IconName; size?: number })` with `type IconName = "plus" | "search" | "close" | "refresh" | "branch" | "folder" | "keys" | "check"`. `KeyHint({ keys: string; plain?: boolean })`.

- [ ] **Step 1: Shortcut tests.** In `shortcuts.test.ts`, with `{ key: "k" }`.
  - `matches Cmd+K on macOS and not Ctrl+K`
  - `matches Ctrl+K elsewhere and not Meta+K`
  - `never matches with Alt held, so AltGr on Windows fires nothing`, ctrl plus alt on `other`
  - `refuses a missing or extra Shift`, `{ key: "k", shift: true }` against a press without shift, and `{ key: "k" }` against a press with shift
  - `matches an uppercase key from Shift`, `key: "K"` with shift for `{ key: "k", shift: true }`
  - `falls back to the physical key on a non-Latin layout`, `key: "л"`, `code: "KeyK"` matches, while `key: "k"` with `code: "KeyL"` (a remapped Latin layout) matches by `key`
  - `labels shortcuts for each platform`, `⌘K`, `⌘⇧K`, `Ctrl+K`, `Ctrl+Shift+K`
  
  In `command-registry.test.ts`, `refuses two commands with one id`, `refuses two commands with one shortcut` and `finds the command for a key press`. In `fuzzy-match.test.ts`.
  - `matches a subsequence in any case`, `fuzzyScore("ADP", "Add a project")` defined
  - `refuses letters out of order or missing`, `fuzzyScore("xyz", "Add a project")` and `fuzzyScore("tc", "Check")` undefined
  - `ignores spaces in the query`, `"be ma"` matches `"beta main"`
  - `ranks consecutive word-start matches first`, `rankMatches("rem", ["Use the dark theme", "Remove project"], identity)` starts with `Remove project`
  - `keeps the input order for an empty query`
  
  Run them and see them fail.

- [ ] **Step 2: Shortcuts, registry, fuzzy.** `matchesShortcut` requires `metaKey && !ctrlKey` on `mac`, `ctrlKey && !metaKey` on `other`, `!altKey` and `shiftKey === (shortcut.shift ?? false)` everywhere, then compares `press.key.toLowerCase()` with the key, and only when `press.key` is not one ASCII letter or digit compares `press.code` with `Key<K>` or `Digit<n>`. The score walks the text once, matching each query letter at its next occurrence, with one point per letter, three more when it directly follows the previous match and two more when it starts the text or follows a space, `-`, `_`, `/` or `.`, minus a tenth of a point per skipped character between the first and last match. Run the tests, they pass.

- [ ] **Step 3: Parts.** `app.css` gains tokens, light then dark, `--shadow` (`0 16px 40px rgb(10 10 11 / 0.12)`, `0 16px 40px rgb(0 0 0 / 0.55)`), `--volt` (`#dcff3d` both), `--volt-edge` (`#6b7800`, `#dcff3d`), `--lilac` (`#c7b9ff` both), mapped as `--color-volt`, `--color-volt-edge`, `--color-lilac` and `--shadow-raised: var(--shadow)`.
  - **Button.** `inline-flex items-center justify-center gap-[7px] rounded-[6px] font-sans font-semibold whitespace-nowrap border border-transparent`. Default `h-7 px-3 text-[13px]`, small `h-6 px-[9px] text-[12px]`. With `label` and no children it is icon only and square, `w-7` or `w-6` with no padding, and `aria-label` is the label. Primary `bg-pri-bg text-pri-fg hover:brightness-110 active:brightness-90`. Secondary `border-ctl bg-bg text-fg hover:bg-hover`. Ghost `text-fg2 hover:bg-hover`. Pressed `active:translate-y-px`. Disabled `opacity-[0.38]` and no hover. Icons 14. The shortcut renders as `KeyHint` after the text, which inside primary is `text-current border-current opacity-55`. Focus ring `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`. Transition 120ms on background and filter, `motion-reduce:transition-none`.
  - **KeyHint.** `kbd`, `inline-flex items-center font-mono text-[11px] font-medium leading-[14px] text-dim border border-ctl rounded-[4px] px-[5px] py-px`. `plain` drops the border and padding, as in menus.
  - **Icon.** `svg` with `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.5}`, round caps and joins, `aria-hidden`, `flex-none`, size from the prop. Paths copied from the BRAND.html symbols `i-plus`, `i-search`, `i-refresh`, `i-branch`, `i-files` (as `folder`), `i-keys`, `i-check`, and `close` as `M4 4l8 8M12 4l-8 8`.

- [ ] **Step 4: The palette.** `Palette` draws, from `.k-pal`.
  - A fixed overlay at `inset-0 z-50` with a `bg-bg/60` scrim. A click on the scrim closes.
  - The panel `role="dialog"`, `aria-modal="true"`, `aria-label` "Command menu" or "Go to a workspace", test id `palette`, at `top-[12vh]`, centred, `w-[min(560px,calc(100%-32px))]`, `bg-raised border border-line rounded-[12px] shadow-raised overflow-hidden`.
  - The input row `h-11 px-[14px] gap-2 border-b border-line`, search icon 14 `text-dim`, the `input` with test id `palette-input`, `text-[14px] text-fg placeholder:text-dim bg-transparent outline-none`, placeholder "Type a command" or "Type part of a workspace or project name", then `KeyHint` `Esc` at the right. The input is focused on open. It carries `role="combobox"`, `aria-expanded="true"`, `aria-controls` the list id, `aria-autocomplete="list"` and `aria-activedescendant` the active option id.
  - The list `role="listbox"`, `p-[6px] max-h-[360px] overflow-y-auto`, with one group label `Commands` or `Workspaces` (`role="presentation"`, `px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim`). Options are `role="option"` with an id and `aria-selected`, `h-8 px-[9px] gap-[9px] rounded-[6px] text-[13px] font-medium text-fg2`, the title in `text-fg truncate`. The active option is `bg-sel` with the title `font-semibold`. A command option shows its shortcut as a plain `KeyHint` at the right and has test id `command-<id with dots as hyphens>`. Hover makes an option active, a click runs it. `palette-empty` reads `Nothing matches that.` in `px-[9px] py-2 text-[13px] text-dim`.
  - The footer `px-[14px] py-2 border-t border-line text-[11px] text-dim gap-[14px]`, with plain hints `↑↓` Move, `↵` Run (or Open in switcher mode), `Esc` Close.
  - Keys inside the input. ArrowDown and ArrowUp move the active option and wrap, scrolling it into view with `block: "nearest"`. Enter runs the active option. Escape closes. Tab and Shift+Tab are prevented, so focus never leaves the input. The active option resets to the first on every query change.
  - Closing restores focus to the element that had it when the palette opened, if it is still in the document. Running a command closes first, restores focus, then calls `run`.
  - The command menu lists `useCommands().commands` that are available, without `palette.commands`, ranked by title. No animation.

- [ ] **Step 5: Wire the registry.** `AppWindow` builds the commands with `useMemo` and wraps the window in `CommandsProvider`. `palette.commands` toggles the command menu. `theme.*` call `update({ ...state, theme }, true)`. The projects column gets, at its top with 8px padding, one `s-row` button `Commands` with the keys icon and the shortcut's `KeyHint`, test id `open-command-menu`, built as `h-7 px-2 gap-[9px] rounded-[6px] text-[13px] font-medium text-fg2 hover:bg-hover`, icon 15 `text-dim`, hint at `ml-auto`, focus ring as Button. The tool readout stays below until Task 4. The registry holds only the commands that exist so far, and each later task adds its own.

- [ ] **Step 6: Prove it.**
  - `npm run --silent verify -- default wait-for=app-window press=ControlOrMeta+K wait-for=palette shot=menu-light type=dark tree press=Enter wait=500 shot=theme-dark restart wait-for=app-window shot=theme-dark-restored` shows `command-theme-dark` as the active option in the tree, then the whole window dark, still dark after the restart. Do not use a `theme=` step in this run, because emulation hides the override.
  - `npm run --silent verify -- default wait-for=app-window click=open-command-menu wait-for=palette press=ArrowDown press=ArrowDown press=Escape tree` shows no `palette`.
  - `npm run --silent verify -- default click=start-claude wait-for=terminal wait=1000 press=ControlOrMeta+K wait-for=palette press=Escape type=hi log` shows the stand-in received `hi`, so focus went back to the terminal.
  - Shots of the open menu in light and dark (`theme=light`, `theme=dark` before opening) show the raised panel with its shadow, the input row, the active row in grey and the footer hints.
  - `./scripts/check` and the journeys green.

- [ ] **Step 7: Commit.** `feat(commands): one registry for buttons, shortcuts and the command menu`.

---

### Task 3: Projects, the sidebar and the quick switcher

Adds a project through the folder dialog, checks the repository, lists projects with their main workspace and branch, restores the selection, shows the empty states and the toast, and brings the sample diff back for a selected workspace.

**Files:**
- Create: `src/main/projects/repository-check.ts`, `src/main/projects/repository-check.test.ts`, `src/main/projects/projects-file.ts`, `src/main/projects/project-list.ts`, `src/main/projects/workspaces.ts`, `src/main/platform/folder-dialog.ts`, `src/renderer/projects/use-projects.ts`, `src/renderer/projects/sidebar.tsx`, `src/renderer/projects/workspace-header.tsx`, `src/renderer/window/empty-states.tsx`, `src/renderer/ui/pixel-avatar.tsx`, `src/renderer/ui/toast.tsx`, `verify/scenarios/two-projects/scenario.json`
- Modify: `src/shared/bridge-contract.ts`, `src/main/main.ts`, `src/main/window/main-window.ts`, `src/main/platform/paths.ts`, `src/main/platform/paths.test.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/window/app-window.tsx`, `src/renderer/palette/palette.tsx`, `verify/scenario.ts`, `verify/driver.ts`, `verify/cli.ts`, `verify/journeys/launch.ts`, `verify/scenarios/corrupt-state/scenario.json`

**Interfaces:**
- Consumes: `readJsonFile`, `createJsonWriter`, `useInterfaceState`, the registry, `Palette`, `runTool`, `resolveInside` style realpath handling.
- Produces, contract:
  - `"projects.list": { request: empty, response: z.strictObject({ projects: z.array(projectView).max(200), notice: z.string().max(300).nullable() }) }`
  - `"projects.choose": { request: empty, response: z.discriminatedUnion("outcome", [z.strictObject({ outcome: z.literal("added"), project: projectView }), z.strictObject({ outcome: z.literal("canceled") })]) }`
  - `"projects.remove": { request: z.strictObject({ projectId: z.uuid() }), response: empty }` (contract and handler here, the interface uses it in Task 5)
- Produces, main:
  - `samePath(a: string, b: string, platform = process.platform): boolean` in `paths.ts`, comparing `path.resolve` results, case-insensitively on Windows and macOS.
  - `type RevParse = { kind: "work-tree"; toplevel: string; linked: boolean } | { kind: "bare" } | { kind: "git-dir" } | { kind: "not-a-repository" } | { kind: "untrusted" } | { kind: "unknown" }` and `parseRevParse(run: ToolRun): RevParse` for the argument list in Verified facts. `bare` when line one is `true`, `git-dir` when line two is `true`, `work-tree` on exit 0 with five lines and `linked` when the git dir differs from the common dir, `untrusted` when stderr contains `dubious ownership`, `not-a-repository` when it contains `not a git repository`, else `unknown`.
  - `checkRepository(folder: string, home: string): Promise<{ ok: true; root: string } | { ok: false; refusal: string }>`. In order. `folder` must be absolute and its `realpath` must exist, otherwise `That folder no longer exists. Choose another one.`. It must be a directory, otherwise `Drop a folder, not a file.`, and must not be inside `home` (`That folder belongs to Satellite itself. Add a repository from somewhere else.`). Then `runTool("git", ["-C", real, "rev-parse", ...])` with a 5 second limit, where no git throws `BridgeFailure("tool-missing", "Satellite needs git to read the folder. Install git, then try again.")`. Then by kind, with `<name>` the folder's base name and `<root>` the toplevel's. `not-a-repository`, `<name> is not a git repository. Choose the folder a repository was cloned into.` `bare`, `<name> is a bare repository with no working files. Add a folder with a checkout instead.` `git-dir`, `That folder is inside a repository's .git folder. Add the repository's own folder instead.` `linked`, `<name> is a worktree of another repository. Add the repository's main folder instead.` A toplevel that is not `samePath` with the real folder, `<name> is inside the repository <root>. Add <root> itself instead.` `untrusted`, `git doesn't trust <name> because another user owns it.` `unknown`, `git couldn't read <name>. Nothing was added.` On success `root` is the realpath of the toplevel.
  - `chooseFolder(window: BrowserWindow | undefined): Promise<string | undefined>` in `folder-dialog.ts`, per the environment rule, else `dialog.showOpenDialog` with `properties: ["openDirectory"]`, `title: "Add a project"`, `buttonLabel: "Add project"`, answering the first path or undefined.
  - `mainWindow(): BrowserWindow | undefined` in `main-window.ts`.
  - `mainWorkspace(path: string): Promise<WorkspaceView>` in `workspaces.ts`, reading `git -C <path> branch --show-current` with a 5 second limit, trimmed, empty or failed giving `branch: null`. Spec 003 adds worktree workspaces in this file.
  - `createProjects({ home, chooseFolder, window }: { home: string; chooseFolder: (window: BrowserWindow | undefined) => Promise<string | undefined>; window: () => BrowserWindow | undefined }): { handlers: Pick<BridgeHandlers, "projects.list" | "projects.choose" | "projects.remove">; add(folder: string): Promise<ProjectView>; flush(): Promise<void> }`, flushed at quit. Holds the list in memory after one `readJsonFile`, with the file schema `{ version: 1, projects }` from Global Constraints whose paths must be absolute and whose ids and paths are unique. `list` stats every path (`missing` when it is not a directory) and reads branches eight at a time. `add` runs `checkRepository`, then, synchronously against the current list, refuses a duplicate (`<name> is already in Satellite.`) and a full list (`BridgeFailure("limit", "Satellite holds up to 200 projects. Remove one, then add this one.")`), appends `{ id: randomUUID(), path: root }`, writes, and on a failed write takes it back out and throws `BridgeFailure("failed", "Satellite couldn't save the project list. Nothing changed.")`. Refusals are `BridgeFailure("refused", sentence)`. One dialog at a time, a second `choose` while one is open answers `refused` with `The folder dialog is already open.` `remove` drops the id and writes, and answers `not-found` with `That project is not in Satellite.` for an unknown id. Notice when the file was set aside, `Satellite couldn't read its saved projects, so it set that file aside and started with an empty list.`, given once with the first `list`.
- Produces, renderer:
  - `useProjects(notify): { projects: ProjectView[] | undefined; add(): Promise<WorkspaceRef | undefined>; remove(projectId: string): Promise<boolean>; refresh(): void }`. `refresh` calls `projects.list`, skips when one is in flight, and runs on mount and on every window `focus` event.
  - `notify(message: string, tone: "info" | "error"): void`, the shell's toast.
  - `Toast({ message, tone, onDismiss })`, `PixelAvatar({ seed: string })`, `Sidebar(...)`, `WorkspaceHeader({ project: ProjectView; workspace: WorkspaceView })`, `NoProjects()`, `NothingSelected()`, `FolderMissing({ name })`.
  - Command `project.add`, registered here. `palette.switcher` is already registered by Task 2 and toggles the switcher, so this task feeds it.
- Produces, verify: scenario field `folders?: { name: string; steps: RepoStep[] }[]` (names kebab-case), each built in `<temp>/folders/<name>` with the repo's git environment. `<temp>/folder-dialog.txt` and `SATELLITE_VERIFY_FOLDER_DIALOG` pointing at it on every launch. `AppSession.folder(name: string): string` and `AppSession.answerFolderDialog(path: string | undefined): Promise<void>`. Step `choose-folder=<target>`, where `repo` is the working repo, `cancel` writes an empty answer, and anything else is `<temp>/folders/<target>`, which may name a subfolder like `alpha/src` or a folder that does not exist. Targets match `/^[a-z0-9-]+(?:\/[a-z0-9.-]+)*$/`.

- [ ] **Step 1: Repository and path tests.** `repository-check.test.ts` feeds `parseRevParse` the recorded outputs from Verified facts, with `/Users/<name>/` style paths.
  - `reads the root of a working tree`
  - `reads a subfolder's toplevel`, `recognises a bare repository`, `recognises the inside of a .git folder`, `recognises a linked worktree`, `recognises a folder that is not a repository`, `recognises a folder owned by another user` (stderr `fatal: detected dubious ownership in repository at '/srv/repo'`)
  - `reads Windows paths`, toplevel `C:/Users/<name>/repo` parses as a work tree
  - `refuses each kind of folder with its sentence`, `checkRepository` against real folders made with `mkdtemp` and real `git init`, `git init --bare` and `git worktree add`, covering a subfolder, a plain folder, a bare repository, a `.git` folder, a linked worktree, a missing path, a file, a relative path and a folder inside the home, each asserting its exact sentence, and the root of a repository answering `ok` with its real path
  
  `paths.test.ts` gains `treats two spellings of one folder as the same`, a trailing separator, and different case on `win32` and `darwin`. Run them and see them fail.

- [ ] **Step 2: Main side.** Implement per the interfaces and wire `projects.list`, `projects.choose` and `projects.remove`. Registry test spies plus `refuses a project id that is not a uuid`.

- [ ] **Step 3: Parts.**
  - **PixelAvatar.** `span` with `aria-hidden`, `grid grid-cols-5 size-4 p-[2px] rounded-[4px] bg-sel flex-none`, 25 cells. The seed is hashed with 32-bit FNV-1a (offset 2166136261, prime 16777619, `Math.imul`, unsigned). Cell `(row, col)` is on when bit `row * 3 + (col < 3 ? col : 4 - col)` is set. On cells take `bg-accent`, `bg-lilac` or `bg-volt` by `(hash >>> 16) % 3`.
  - **Toast.** Fixed at `bottom-4 left-1/2 -translate-x-1/2 z-40`, `flex items-center gap-[10px] pl-3 pr-[10px] py-[10px] rounded-[10px] bg-raised border border-line shadow-raised text-[13px] font-medium text-fg max-w-[min(420px,calc(100%-32px))]`, test id `toast`. Errors start with the 8px needs-you pixel and have `role="alert"`, info has `role="status"`. A small ghost icon-only Button with the close icon, label `Dismiss`, test id `toast-dismiss`, ends it. One toast at a time, a new one replaces it. It leaves after 6 seconds, paused while hovered or focused within. No animation. This replaces Task 1's notice paragraph, and the `console.warn` from Task 1 becomes `notify(message, "error")`.
  - **Sidebar.** The projects column becomes `bg-side flex flex-col gap-px px-2 pb-2 pt-2 overflow-y-auto`. From the top, the `open-command-menu` row from Task 2, then a second row `Go to a workspace` with the search icon and Mod+P, test id `open-switcher`. Then the section header, `flex items-center justify-between px-2 pt-[14px] pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim` reading `Projects`, with a small ghost icon-only `CommandButton` for `project.add` with the plus icon, label `Add a project`, test id `add-project`. The tool readout keeps its place at the bottom until Task 4. With no projects, `No projects yet.` in `px-2 py-1 text-[13px] text-dim`, test id `no-projects`. Each project is a `div` `h-7 px-2 gap-[9px] flex items-center text-[13px] font-semibold text-fg` with its avatar and name, test id `project-<name>`, and when missing a readout `MISSING` in `ml-auto font-pixel text-[12px] uppercase text-dim`. Its main workspace follows as a `button`, `h-7 pl-[33px] pr-2 gap-[9px] rounded-[6px] text-[13px] font-medium text-fg2 hover:bg-hover`, with a 6px idle pixel and the branch name in a truncating `span`, or `detached` when the branch is null and `unavailable` when missing, test id `workspace-<name>-main`. Selected is `bg-sel text-fg` with the name `font-semibold` and `aria-current="true"`. The list sits in `nav` with `aria-label="Projects"`, and a project's rows in a `ul` with `aria-label` the project's name.
  - **WorkspaceHeader.** `h-11 flex items-center gap-[10px] pl-4 pr-[10px] border-b border-line whitespace-nowrap min-w-0`, test id `workspace-header`. An `h1` `text-[14px] font-semibold` with the project's name, then the branch icon 13 and the branch in `font-mono text-[12px] text-dim truncate`. Task 5 adds the remove button at the right.
  - **Empty states.** `NoProjects`, centred like `NothingSelected` below, test id `welcome`, an `h2` reading `Add your first project`, a `p` reading `Satellite holds every repository you work on in one window. Choose a folder to begin.`, and a primary `CommandButton` for `project.add` with the text `Add your first project`, test id `add-first-project`. Task 4 replaces it with the check card. `NothingSelected`, centred, `max-w-[320px] text-center`, an `h2` `text-[17px] font-semibold` reading `Pick a workspace`, and a `p` `text-[13px] text-fg2 mt-1` reading `Choose one on the left, or press ⌘P to jump straight to it.`, with the shortcut label from the registry for this platform, test id `nothing-selected`. `FolderMissing`, the same layout, `<name> isn't where it was` and `Put the folder back and Satellite finds it again, or remove the project.`, test id `folder-missing`.

- [ ] **Step 4: The shell.** `project.add` runs `add()`. A refusal or failure becomes an error toast with the bridge's sentence, `added` selects the new main workspace and persists the selection. `palette.switcher` already toggles the palette in switcher mode, and Mod+K inside it switches to commands through the registry, since the palette keeps its place and resets when its `mode` changes. The switcher lists every workspace of every project that is not missing, `label` the branch or `detached`, ranked on `${label} ${project}`, each option a 6px idle pixel, the label and the project name as a readout `ml-auto font-pixel text-[12px] uppercase text-dim`, test id `switch-<name>-main`, and Enter selects it. Selecting a workspace persists `selected`. On load a `selected` whose project is gone is dropped and persisted. The centre shows, in order, `NoProjects` when there are no projects, `NothingSelected` when nothing is selected, then for the selected workspace the header and either `FolderMissing` or the sample diff. Task 4 puts the check card in front of these. Notices from `interface.load` and `projects.list` arrive as info toasts.

- [ ] **Step 5: Harness.** `folders`, the dialog answer file and env, `choose-folder`, `folder()` and `answerFolderDialog()`. `two-projects` builds the working repo like `default` and `folders` `alpha` (a repo on `main` with one commit and a `src/index.ts` file), `beta` (a repo on `develop` with one commit) and `notes` (a `README.md` and no git), with the default stand-ins and auth answer, described as "Two repositories and a plain folder beside the working repo, with gh signed in." Add `projects.json` with content `[` to `corrupt-state`'s home. `launch` answers the dialog with the working repo, clicks `add-first-project`, waits for `diff` and keeps today's diff checks.

- [ ] **Step 6: Prove it.**
  - `npm run --silent verify -- two-projects wait-for=add-first-project choose-folder=notes click=add-first-project wait-for=toast text=toast choose-folder=alpha/src click=add-first-project wait-for=toast text=toast choose-folder=alpha click=add-first-project wait-for=workspace-header choose-folder=beta click=add-project wait-for=workspace-beta-main choose-folder=alpha click=add-project wait-for=toast text=toast shot=projects-light theme=dark shot=projects-dark` answers `notes is not a git repository. Choose the folder a repository was cloned into.`, then `src is inside the repository alpha. Add alpha itself instead.`, then `alpha is already in Satellite.`, and the shots show both projects with avatars, `main` and `develop`, beta selected with its header and the diff.
  - `npm run --silent verify -- two-projects choose-folder=alpha press=ControlOrMeta+O wait-for=workspace-alpha-main choose-folder=beta press=ControlOrMeta+O wait-for=workspace-beta-main press=ControlOrMeta+P wait-for=palette type=alp shot=switcher-light press=Enter restart wait-for=workspace-header text=workspace-header tree shot=restored` shows the switcher with alpha first, then after the restart both projects and alpha selected.
  - `npm run --silent verify -- two-projects choose-folder=cancel click=add-first-project wait=500 tree` shows no toast and no project.
  - `npm run --silent verify -- corrupt-state wait-for=toast text=toast` answers a set-aside sentence.
  - A folder that goes missing is proven in the `projects` journey in Task 5, which can rename a folder between two launches.
  - `./scripts/check` and the journeys green.

- [ ] **Step 7: Commit.** `feat(projects): add a repository from a folder and list it in the sidebar`, `feat(palette): jump to any workspace with the quick switcher`, `test(verify): answer the folder dialog and build several folders`.

---

### Task 4: The first run check

`tools.check` replaces `tools.versions`, `gh` sign-in is read safely, and the centre shows the check card while there is no project.

**Files:**
- Create: `src/main/tools/tool-check.ts`, `src/main/tools/tool-check.test.ts`, `src/main/tools/gh-auth.ts`, `src/main/tools/gh-auth.test.ts`, `src/main/platform/install-commands.ts`, `src/renderer/setup/tool-check.tsx`, `src/renderer/ui/status-pixel.tsx`, `verify/scenarios/claude-missing/scenario.json`, `verify/scenarios/not-signed-in/scenario.json`
- Modify: `src/shared/bridge-contract.ts`, `src/main/main.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/window/app-window.tsx`, `src/renderer/window/empty-states.tsx`, `verify/scenario.ts`, `verify/driver.ts`, `verify/stand-ins/claude.ts`, `verify/scenarios/default/scenario.json`, `verify/scenarios/flood/scenario.json`, `verify/journeys/launch.ts`
- Delete: `src/main/tools/tool-versions.ts`, `src/renderer/proving/tool-readout.tsx`

**Interfaces:**
- Consumes: `runTool`, `Tool` from the platform module, `CommandButton` and `Button` from Task 2.
- Produces:
  - Contract `"tools.check": { request: empty, response: toolCheck }` where `toolCheck = z.strictObject({ git: toolState, gh: ghState, claude: toolState })`, `toolState = z.discriminatedUnion("state", [z.strictObject({ state: z.literal("ready"), version: z.string().min(1).max(200) }), z.strictObject({ state: z.literal("missing"), fix: z.string().min(1).max(200) })])` and `ghState` the same plus `z.strictObject({ state: z.literal("signed-out"), reason: z.enum(["none", "failed"]), fix: z.literal("gh auth login") })`, and `ready` for gh also carries `account: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).nullable()`.
  - `parseGhAuthStatus(run: ToolRun): { signedIn: true; account: string | null } | { signedIn: false; reason: "none" | "failed" }` in `gh-auth.ts`. Signed in only when the exit code is 0 and a line matches `/Logged in to \S+ (?:account|as) ([A-Za-z0-9-]{1,39})\b/`, taking the first, with `account: null` when exit 0 has no such line. `none` when the output contains `not logged into any`, otherwise `failed`. It reads stdout and stderr and keeps nothing else.
  - `versionNumber(line: string): string`, the first `/\d+(?:\.\d+)+/` match, or the trimmed line cut to 200 characters.
  - `checkTools(): Promise<ToolCheck>`. Runs `git --version`, `gh --version` and `claude --version` with a 5 second limit, then `gh auth status --active` with a 10 second limit when gh is there, all in parallel. A missing tool, a non-zero `--version` or a timeout is `missing` with `installCommand(tool)`. A timeout of the auth check is `failed`. Errors are logged as one sentence naming the tool, never its output.
  - `installCommand(tool: Tool): string` in the platform module. macOS `xcode-select --install`, `brew install gh`, `curl -fsSL https://claude.ai/install.sh | bash`. Windows `winget install --id Git.Git -e`, `winget install --id GitHub.cli -e`, `winget install Anthropic.ClaudeCode`. Linux `sudo apt install git`, `sudo apt install gh`, `curl -fsSL https://claude.ai/install.sh | bash`.
  - `ToolCheckCard({ firstRun: boolean; onClose?(): void })`, which fetches on mount and on Check again. `StatusPixel({ state: "idle" | "ready" | "needs-you"; size?: 6 | 8 })`.
  - Command `tools.check` "Check git, gh and Claude Code", which shows the card in the centre in revisit mode.
  - Scenario `claude` becomes `z.union([<today's object>, z.strictObject({ missing: z.literal(true) })])`. When missing, the driver sets `SATELLITE_CLAUDE` to a JSON array naming `<temp>/missing-claude`, which does not exist.

- [ ] **Step 1: Parser tests.** `gh-auth.test.ts` with recorded text (masked tokens as `gho_************************************`, never anything token shaped).
  - `reads the account from the current format`, `github.com\n  ✓ Logged in to github.com account octo-verify (keyring)\n  - Active account: true\n  - Token: gho_****…\n` exit 0 gives `octo-verify`
  - `reads the account from the older format`, `✓ Logged in to github.com as octo-verify (oauth_token)`
  - `reports no sign-in`, stderr `You are not logged into any GitHub hosts. To log in, run: gh auth login` exit 1 gives `none`
  - `reports a failed sign-in as unconfirmed`, stderr `github.com\n  X Failed to log in to github.com account octo-verify (keyring)\n  - The token in keyring is invalid.\n` exit 1 gives `failed`
  - `keeps no token text`, `JSON.stringify` of every result above contains neither `gho_` nor `Token`
  
  `tool-check.test.ts`, `reads the version number from each tool`, with `git version 2.50.1`, `gh version 2.80.0 (2025-09-23)` and `2.1.211 (Claude Code)`. Run them and see them fail.

- [ ] **Step 2: Main side.** Implement per the interfaces, remove `tools.versions` from the contract, `main.ts` and the registry test, and add the `tools.check` spy.

- [ ] **Step 3: The card.** `StatusPixel` is a `span` with `aria-hidden`, square, `rounded-[2px]`, 6 or 8 pixels (default 8), idle `bg-dim`, ready `bg-volt` with `shadow-[inset_0_0_0_1.5px_var(--volt-edge)]`, needs you `bg-signal`. `ToolCheckCard` follows `.s-card` and `.s-chk`.
  - Centred in the centre column with 24px padding and its own scrolling. The card is `w-[min(500px,100%)] bg-bg border border-line rounded-[12px] px-[34px] pt-[34px] pb-[30px] flex flex-col gap-[18px]`, test id `tool-check`.
  - The title `h2` is `font-display font-bold text-[40px] leading-[0.95] tracking-[-0.045em]`, `welcome to satellite` on first run or `your tools` when revisited. Below it a `p` `text-[14px] text-fg2 -mt-2` with `Three checks, then add your first project.` or `Satellite runs your own git, gh and Claude Code.`
  - The rows sit in `border border-line rounded-[10px] overflow-hidden`. Each row is `min-h-12 px-3 py-3 gap-3` with a `border-t border-line` except the first, and test ids `check-git`, `check-gh`, `check-claude`. A row holds an 8px pixel, the name (`Git`, `GitHub CLI`, `Claude Code`, `font-semibold`) and the detail (`text-[12.5px] text-dim`). Ready shows a volt pixel and a `✓` readout at the right in `font-pixel text-[13px] uppercase text-dim`. While checking it shows an idle pixel and `Checking`.
  - Details. Ready, `2.50.1 found` for git and Claude Code, and for gh `Signed in as octo-verify` or `Signed in` without an account. Missing git, `git is not installed, or Satellite cannot find it.` Missing gh, `GitHub CLI is not installed, or Satellite cannot find it.` Missing claude, `Claude Code is not installed, or Satellite cannot find it.` Signed out with `none`, `GitHub CLI is not signed in.` Signed out with `failed`, `GitHub CLI couldn't confirm its sign-in. Check the connection, or sign in again.`
  - Failing rows use the signal pixel, then a second line under the name, `Run this in a terminal, then check again.` in `text-[12.5px] text-fg2`, and the command in a `code` block, `font-mono text-[12px] text-fg bg-side border border-ctl rounded-[6px] px-2 py-1 select-all break-all`.
  - The footer is `flex items-center gap-[10px]`, with the readout `0N / 03` (ready count, two digits) in `font-pixel text-[13px] uppercase text-dim mr-auto` and `aria-label` "N of 3 tools ready", then a ghost Button `Check again` with the refresh icon, test id `check-again`. On first run a primary `Add your first project` follows, test id `add-first-project`, a `CommandButton` for `project.add`. When revisited a ghost `Close` follows instead, test id `close-check`.
  - The live result is announced, so the rows container has `aria-live="polite"`.
  
  The first-run card replaces `NoProjects` in the centre, keeping the `add-first-project` test id, and the revisited card, opened by `tools.check`, comes before everything else in the centre until it is closed or a workspace is selected. Remove the tool readout from the projects column.

- [ ] **Step 4: Scenarios.** Add `{ "args": ["auth", "status", "--active"], "stdout": "github.com\n  ✓ Logged in to github.com account octo-verify (keyring)\n  - Active account: true\n" }` to `default` and `flood`. `claude-missing` is `default` with `"claude": { "missing": true }`, described as "A fresh repo where Claude Code is not installed." `not-signed-in` is `default` whose auth answer is `stderr` `You are not logged into any GitHub hosts. To log in, run: gh auth login\n` with `exitCode` 1, described as "A fresh repo where gh is installed and signed out." The claude stand-in narrows the union and exits 1 if started for a missing scenario.

- [ ] **Step 5: Journey.** In `launch`, replace the tool readout checks with `check-git` matching `/\d+\.\d+/` and `check-gh` containing `octo-verify`. Task 3 already made it add the working repo before the diff checks.

- [ ] **Step 6: Prove it.**
  - `npm run --silent verify -- default wait-for=tool-check text=tool-check shot=check-light theme=dark shot=check-dark` reads three ready rows, `Signed in as octo-verify` and `03 / 03`.
  - `npm run --silent verify -- claude-missing wait-for=tool-check text=check-claude shot=claude-missing-light theme=dark shot=claude-missing-dark` reads the missing sentence and this platform's install command.
  - `npm run --silent verify -- not-signed-in wait-for=tool-check text=check-gh shot=signed-out-light theme=dark shot=signed-out-dark` reads `GitHub CLI is not signed in.` and `gh auth login`.
  - `npm run --silent verify -- default wait-for=tool-check press=ControlOrMeta+K type=check press=Enter wait-for=close-check shot=check-revisit` shows `your tools`.
  - `./scripts/check` and the journeys green.

- [ ] **Step 7: Commit.** `feat(tools): check git, gh and Claude Code on first run`.

---

### Task 5: Remove a project and the projects journey

Forgetting a project from the workspace header or the command menu, and one journey that proves the spec's persistence, refusal, switcher and untouched-folder items.

**Files:**
- Create: `verify/journeys/projects.ts`
- Modify: `src/renderer/window/app-window.tsx`, `src/renderer/projects/workspace-header.tsx`, `src/renderer/projects/use-projects.ts`, `verify/journeys.ts`

**Interfaces:**
- Consumes: `projects.remove`, `useProjects().remove`, `notify`, `CommandButton`, `AppSession.relaunch`, `folder`, `answerFolderDialog`.
- Produces: command `project.remove` "Remove project", available when a workspace is selected, acting on the selected workspace's project. `projectsJourney: Journey` with scenario `two-projects`.

- [ ] **Step 1: Remove.** `project.remove` calls `remove(projectId)`. On success the selection becomes null and persists, the list refreshes, and an info toast reads `Satellite forgot <name>. Its folder is untouched.` A failure shows the bridge's sentence as an error toast. No confirmation. The header gains a small ghost `CommandButton` for `project.remove` at `ml-auto`, test id `remove-project`. The `FolderMissing` view keeps the header, so a missing project can be removed the same way.

- [ ] **Step 2: The journey.** `verify/journeys/projects.ts`, in this order, each assertion with a message that says what went wrong, waits with `waitUntil`.
  1. Snapshot `folder("alpha")`, every file under it including `.git`, as sorted relative paths with size and SHA-256 of the bytes.
  2. Answer `notes`, click `add-first-project`, assert the toast reads the not-a-repository sentence and `no-projects` is still visible.
  3. Answer `alpha`, press `ControlOrMeta+O`, then `beta` the same way. Assert both workspace rows show `main` and `develop`.
  4. Press `ControlOrMeta+P`, type `alp`, press Enter, assert `workspace-alpha-main` has `aria-current="true"`.
  5. Run `git switch -c feature` in `folder("beta")` with `execFile` and the same clean git environment the recipe uses, dispatch a `focus` event on the window, and wait for `workspace-beta-main` to read `feature`.
  6. Focus `divider-left`, press ArrowRight four times, and read the projects column's width as 280.
  7. `relaunch()`. Assert both projects, alpha selected and the projects column at 280.
  8. Open the command menu, type `remove`, assert `command-project-remove` is listed, press Enter. Assert the toast reads `Satellite forgot alpha. Its folder is untouched.` and `project-alpha` is gone.
  9. Snapshot alpha again and assert it equals step 1 entry by entry.
  10. Rename `folder("beta")` away, `relaunch()`, assert `project-beta` shows `MISSING`, click its row, assert `folder-missing`, remove it, assert `no-projects`.
  11. Assert no console errors.
  
  Add it to `journeys.ts` after `boundary` and before `quit`. Before trusting it, turn off one guard at a time for one run (skip the duplicate check, write into the repo during add with a throwaway file, skip saving the selection) and see the journey fail with a legible reason, then restore.

- [ ] **Step 3: Prove it.**
  - `npm run --silent journeys` prints `pass launch`, `pass boundary`, `pass projects`, `pass quit`.
  - `npm run --silent verify -- two-projects choose-folder=alpha click=add-first-project wait-for=workspace-header click=remove-project wait-for=toast text=toast shot=removed-light theme=dark shot=removed-dark` answers the forget sentence and shows the first-run card again.
  - **Every command runs from the menu.** With alpha added and selected, open the command menu and run each listed command by typing part of its title and pressing Enter, one run per command (`project.add` with `choose-folder=beta`, `project.remove`, `palette.switcher` showing the switcher, `tools.check` showing `your tools`, and each theme with a shot). A `tree` right after opening lists exactly the seven `command-*` options from Global Constraints. Paste the outputs into the task report.
  - `./scripts/check` green.

- [ ] **Step 4: Commit.** `feat(projects): remove a project and leave its folder untouched` and `test(verify): prove projects survive a restart and their folders stay unchanged`.

---

### Task 6: Drop a folder on the window

The one preload addition, the drop channel, the drop overlay, the driver's drop step and the boundary journey's new cases.

**Files:**
- Modify: `src/preload/preload.ts`, `src/shared/satellite-api.ts`, `src/shared/bridge-contract.ts`, `src/main/projects/project-list.ts`, `src/main/main.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/window/app-window.tsx`, `verify/driver.ts`, `verify/cli.ts`, `verify/journeys/boundary.ts`, `verify/journeys/projects.ts`
- Create: `src/renderer/projects/drop-overlay.tsx`

**Interfaces:**
- Consumes: `createProjects(...).add`, `notify`, the selection update from Task 3.
- Produces: `SatelliteApi.pathForFile(file: unknown): string`. Contract `"projects.drop": { request: z.strictObject({ path: z.string().min(1).max(4096) }), response: z.strictObject({ project: projectView }) }`, handled by the same `add`. `AppSession.dropFolder(path: string): Promise<void>` and step `drop=<target>` with the same targets as `choose-folder`.

- [ ] **Step 1: Check the driver can drop a folder.** Before anything else, in a scratch run, open a CDP session with `page.context().newCDPSession(page)` and send `Input.dispatchDragEvent` `dragEnter`, `dragOver` and `drop` at the centre of the window with `data: { items: [], files: [<folder>], dragOperationsMask: 1 }`, then read `webUtils.getPathForFile` of the dropped file through a temporary preload build. If the folder's path comes back, continue. If not, keep the step out of the harness, prove drops with one manual run on macOS in Step 6, and say so in the report and in `satellite-verify`.

- [ ] **Step 2: Preload.** `pathForFile` calls `webUtils.getPathForFile` inside `try` and answers `""` on any throw or for anything else, so a page learns nothing about files it was not given. `satellite-api.ts` adds it to the interface. Nothing else changes in the preload.

- [ ] **Step 3: Channel.** Add `projects.drop`, its handler calling `add(path)` so it meets the same check and refusals, its spy, and `refuses a dropped path that is empty or too long` (empty, 4097 characters, a number). `checkRepository` already refuses a relative path, with `That folder no longer exists. Choose another one.`

- [ ] **Step 4: The overlay.** `window` listens for `dragover` and `drop` and always calls `preventDefault`, so a drop never navigates. A drag carrying `Files` over the projects or the repository column shows the overlay, and the sessions column never does, so spec 004 can own drops on the terminal. The overlay is `absolute inset-0 z-30 grid place-items-center bg-bg/80 border-2 border-dashed border-accent rounded-[10px] m-2 pointer-events-none`, with `Drop a folder to add it as a project` in `text-[15px] font-semibold text-fg`, test id `drop-overlay`. It hides on `dragleave` out of the window and on `drop`. A drop of more than one item is refused with `Drop one folder at a time.` An empty path from `pathForFile` is refused with `Satellite couldn't read where that came from. Use Add a project instead.` Otherwise the path goes to `projects.drop` and the outcome is handled exactly like `project.add`.

- [ ] **Step 5: Journeys.** `boundary` expects `window.satellite` to expose exactly `invoke`, `onEvent` and `pathForFile`, asserts `pathForFile(new File(["x"], "x.txt"))` and `pathForFile("/etc")` both answer `""`, and asserts `projects.drop` with `{ path: "relative/folder" }` answers code `refused` and adds no project. `projects` adds beta by `dropFolder` instead of the dialog when Step 1 passed. Run each new check once with its guard off (return the raw `getPathForFile` result for the made-up file, skip the absolute check) and see it fail.

- [ ] **Step 6: Prove it.**
  - `npm run --silent verify -- two-projects wait-for=tool-check drop=beta wait-for=workspace-beta-main drop=notes wait-for=toast text=toast shot=dropped-light theme=dark shot=dropped-dark` adds beta and answers the not-a-repository sentence for notes.
  - Without the drop step, one manual `npm run dev` with a temporary `SATELLITE_HOME`, dropping a repository from Finder, with a screenshot.
  - `npm run --silent journeys` all pass and `./scripts/check` green.

- [ ] **Step 7: Commit.** `feat(projects): add a project by dropping its folder on the window`.

---

### Task 7: Docs, the feature map and status Done

Every doc this spec made wrong, fixed in one change.

**Files:**
- Modify: `ARCHITECTURE.md`, `SATELLITE.md`, `DESIGN.md`, `.claude/skills/satellite-stack/SKILL.md`, `.claude/skills/satellite-verify/SKILL.md`, `specs/002-shell-and-projects/spec.md`, `specs/README.md`, `README.md` only if it describes the tool readout

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: ARCHITECTURE.md.**
  - Parts and Folder layout gain `src/main/state/`, `src/main/projects/`, `src/renderer/commands/`, `src/renderer/palette/`, `src/renderer/projects/`, `src/renderer/setup/`, drop `src/renderer/proving/tool-readout.tsx` and `src/main/tools/` now reads "The first run check".
  - Bridge. The preload line says `window.satellite` holds `invoke`, `onEvent` and `pathForFile`, with why `pathForFile` is safe. One row each for `interface.load`, `interface.save`, `projects.list`, `projects.choose`, `projects.drop`, `projects.remove`, `tools.check`, and the `tools.versions` row removed. The `projects.drop` row states the forged-path reasoning from Rulings checked. The `refused` code joins the Errors line.
  - A new State section. The two files, their shapes, strict schemas with one version integer, set aside never deleted, atomic and serialised writes, mode `0600`, nothing written into a repository, project ids random.
  - Projects. What the repository check accepts and refuses and that it runs `git rev-parse` and `git branch --show-current` only, which never write.
  - Platform. `SATELLITE_VERIFY_FOLDER_DIALOG` and why reading it in a packaged app grants nothing an environment override does not already, and `installCommand`.
  - Look. The theme through `nativeTheme.themeSource`.
  - Decisions gain rows for the theme override, the dialog plus drop, plain JSON, Ctrl shortcuts going to the terminal on Windows and Linux, and our own fuzzy matcher over a library.
- [ ] **Step 2: Skills.** `satellite-stack`. The folder map, the preload line ("It never grows" becomes the three functions and that a fourth is a security decision), the theme paragraph, the parts list in Interface parts (`Button` variants, `Icon`, `KeyHint`, `StatusPixel`, `PixelAvatar`, `Toast`), and how to register a command (one entry in the registry with id, title, optional shortcut, `available`, `run`, and `CommandButton` for buttons). `satellite-verify`. The `home`, `folders` and missing `claude` scenario fields, the steps `restart`, `choose-folder`, `drop` (or the note from Task 6 Step 1), the new scenarios, the updated `launch` and `boundary` rows, the `projects` journey row, and feature map rows for 002.
- [ ] **Step 3: DESIGN.md.** The app token table gains `volt`, `volt-edge`, `lilac` and `shadow`. The App section says the theme follows the system unless the user chooses light or dark.
- [ ] **Step 4: SATELLITE.md.** Nothing in it describes a feature as unbuilt, so add only what is now true and missing, if anything, such as the first run check under App or Layout. Do not restate the spec.
- [ ] **Step 5: Status.** Spec and index to **Done**. Leave `plan.md` to the controller.
- [ ] **Step 6: Check.** `./scripts/check` and `npm run --silent journeys` green, last lines in the report. Commit `docs: describe projects, state and commands and mark spec 002 done`.

---

## Acceptance map

| Acceptance item | Task | Proof |
| --- | --- | --- |
| Adding a repository folder shows it in the sidebar, and it is still there after a restart | 3, 5 | `two-projects` driver runs in Task 3 Step 6, `projects` journey steps 3 and 7 |
| Adding a folder that is not a repository is refused with a sentence that says why | 3, 5 | `two-projects` driver run answering the `notes` sentence, `repository-check.test.ts`, `projects` journey step 2 |
| Removing a project leaves its folder byte for byte unchanged | 5 | `projects` journey steps 1, 8 and 9 |
| Every command in the registry appears in the command menu and runs from it | 2, 5 | driver runs in Task 5 Step 3, one per command, with the tree of seven options |
| The quick switcher reaches a workspace in another project | 3, 5 | driver run with `ControlOrMeta+P` in Task 3 Step 6, `projects` journey step 4 |
| With `claude` missing or `gh` signed out, the first run check names the problem and the fix | 4 | scenarios `claude-missing` and `not-signed-in` in Task 4 Step 6, `gh-auth.test.ts` |
| A corrupt state file never stops the app from starting | 1, 3 | `json-file.test.ts`, scenario `corrupt-state` for both files |
| Scope, columns resizable within limits and remembered | 1, 5 | Task 1 Step 7 runs, `projects` journey steps 6 and 7 |
| Scope, drop a folder | 6 | `drop=` driver run or the manual run, `boundary` journey cases |
| Scope, light and dark with a command | 2 | Task 2 Step 6 run across a restart |
| Scope, empty states | 3, 4 | `no-projects`, the first-run card shots, `nothing-selected` and `folder-missing`, `projects` journey step 10 |
