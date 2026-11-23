---
name: satellite-stack
description: "Use when adding or changing code in any part of Satellite, to know where it goes, how the processes talk, how to run, build and package it, and which dependency rules apply."
---

# Satellite stack

Electron, TypeScript, React and Tailwind in one ESM npm package on the Node named in `.nvmrc`. electron-vite builds it into `out/`, electron-builder packages it into `release/`. `ARCHITECTURE.md` says why each boundary is where it is, and skill `satellite-conventions` holds the rules every line follows. This skill is how to put code in the right place and prove it.

## Folder map

The Folder layout section of `ARCHITECTURE.md` maps every folder and the files that matter, so the map lives in one place.

## Where a new feature goes

One folder per feature on each side, named for the domain thing, tests beside the code.

- `src/main/<feature>/` holds its handlers and logic, for example `src/main/changes/change-list.ts` with `change-list.test.ts` beside its parser.
- `src/renderer/<feature>/` holds its views, for example `src/renderer/changes/changes-view.tsx`.
- A feature that reads a repository keeps its reads in its own folder, as `src/main/changes/` does, on top of `runGit` and `readGit`, with a read queue when reads can pile up and a per-page cache that `owner.onGone` drops. Text from a repository reaches React only through `VisibleName` or Monaco's models, and a name the page sends goes through a key the page was given first. A feature that reads files for a page, as `src/main/files/` does, takes a relative path, runs it through the five steps of the Files section of `ARCHITECTURE.md` (`isChangePath`, a link-free walk, the real path check, a no-follow open and a recheck) by reusing the confined reader of `src/main/changes/file-sides.ts`, and never reads from an absolute path.
- A feature that reads the machine's processes, as `src/main/processes/` does, takes its rows from the table reader in the platform module, which reads short names for the table that decides and full commands only for the listed ids, lists by a pure rule over a table so a hand-made table in `process.test-fixture.ts` can test it, and keeps what crosses to the page bounded and cut.
- A feature that reads GitHub, as `src/main/pull-request/` does, runs `gh` only through `runTool("gh", args, { cwd, timeoutMs, signal })` with arguments from one builder file, `gh-arguments.ts`, whose `callOf` accepts only what the builders make, so no other file builds a `gh` argument and the verify stand-in can tell the calls apart. Only values that passed a pattern may enter an argument. Every run goes through the one queue in `gh-pace.ts`, reads stay in memory and nothing is stored, and the answer is parsed loosely into a strict contract shape. A page-side hook asks and the background process paces, as `usePullRequests` does. Text a pull request says reaches React only through `MarkdownText`, `VisibleName` or `visibleText`, never into an argument, a prompt or a notification, and a prepared request carries pointers only.
- Its messages go in `src/shared/bridge-contract.ts`, its rows in the `ARCHITECTURE.md` Bridge table.
- `src/renderer/guide/` is the first-run guide. A control it points at carries `data-guide` with its step's name, one element per name, and the layer finds it by that attribute, never by a test id.
- A part two features share moves to `src/renderer/ui/`. Code both processes need goes in `src/shared/` and imports nothing from Electron, Node or the DOM.

The renderer imports only from `src/renderer/` and `src/shared/`. Main never imports from the renderer.

## Adding a bridge request

Names are `<feature>.<verb>`. In this order.

1. **Contract.** Add the entry to `bridgeRequests` in `src/shared/bridge-contract.ts`. Request and response are `z.strictObject`, every string has a `max`, every number is a bounded `z.int()`, ids are `z.uuid()`, a choice is `z.literal` or `z.enum`. A limit both processes use, like `terminalWriteChars`, goes in `bridgeLimits` and the schema reads it from there. A path or a name from the interface is data that the handler confines, never a value it runs.

   ```ts
   "terminal.resize": {
     request: z.strictObject({ id: terminalId, cols, rows }),
     response: empty,
   },
   ```

2. **Handler.** In the feature folder, typed `BridgeHandler<"x.y">`, or `Pick<BridgeHandlers, ...>` for a group. `BridgeHandler`, `BridgeHandlers`, `BridgeOwner` and `BridgeFailure` live in `src/main/bridge/registry.ts`. It gets the parsed request and the page's `BridgeOwner`. Throw `BridgeFailure(code, sentence)` for an outcome the user sees. The code is one of the `bridgeErrorCode` enum in the contract, and a new kind of outcome adds its code there. Any other throw is logged and answered `failed`. Anything the handler starts for a page ends in `owner.onGone(...)`, and anything it holds for one page answers `not-found` to every other page.

   ```ts
   throw new BridgeFailure("not-found", "That terminal is not running.");
   ```

3. **Wire it.** Add it to the map passed to `registerBridge` in `src/main/main.ts`. `BridgeHandlers` needs every channel, so typecheck fails until it is there.
4. **Registry test.** Add its spy to `spies()` in `src/main/bridge/registry.test.ts`, which `satisfies BridgeHandlers` and fails typecheck without it. When its input has a shape worth attacking, add the payloads that must be refused to a test that asserts `invalid-request` and that no handler ran.
5. **Call it.** The renderer calls `invoke("x.y", payload)` from `src/renderer/bridge/bridge-client.ts` and gets a `BridgeResult`. On `!result.ok` it shows `result.error.message`, a sentence written for people.

   ```ts
   void invoke("tools.check", {}).then(setResult);
   ```

   React 19 ignores a state update after unmount, so a request whose answer only sets state needs no unmount guard. One that starts something, like `terminal.start`, has a matching cleanup in the effect.

6. **Record it.** One row in the Bridge table of `ARCHITECTURE.md`, with what it does, its limits and why it is safe. Ask what a page that runs hostile script could do with exactly this message. If the answer is more than the row says, narrow the schema or the handler.
7. **Prove it** in the app (skill `satellite-verify`). A new kind of refusal gets a case in the `boundary` journey.

An event is the same, with `bridgeEvents` instead. The handler sends it with `owner.emit("x.done", payload)`, so it reaches only the page that owns it. Add the event's empty `Set` to `listeners` in `src/renderer/bridge/bridge-client.ts`, which typecheck asks for. The client holds one IPC listener for every subscriber, parses each event once, and drops and logs one that fails its schema, naming the event and the failing fields, never the payload. The renderer listens with `subscribe("x.done", listener)`, which returns the unsubscribe for the effect's cleanup. Subscribe before the request that makes the events, as `TerminalView` does before `terminal.start`.

Never add an IPC channel or an `ipcMain` handler. Everything goes through `satellite:bridge` and `satellite:event`. `window.satellite` holds three functions, `invoke`, `onEvent` and `pathForFile`, which only reads a dropped file's path and sends nothing. A fourth is a security decision for the maintainer, recorded in the Bridge section of `ARCHITECTURE.md`.

## The platform module

`src/main/platform/` is the only code that spawns a process, imports `node:child_process` or `node-pty`, finds an executable or branches on `process.platform`. Five small branches live elsewhere, the macOS app menu, quiet verification on macOS in `src/main/window/verification.ts`, the home folder that `src/main/processes/command-text.ts` shortens to `~` case-insensitively on Windows, and in the interface the shortcut keys in `src/renderer/commands/shortcuts.ts`, the image paste sequence in `src/renderer/terminal/terminal-keys.ts` and the code font in `src/renderer/ui/code-type.ts`, which read the system from the page's user agent because they have no other way to know it. Test files and their fixtures spawn and branch freely. A feature calls in.

- `resolveTool("gh")` and `runTool("git", ["status", "--porcelain=v2"], { timeoutMs })` take a `Tool` and an argument array, never a shell string. `runTool` takes an optional `cwd`, the folder the tool starts in, which the pull request's `gh` runs pass, and an optional `input`, text written to the tool's standard input and then closed, which a git read passes as `input` in its extras, and answers `{ exitCode, stdout, stderr }`, or `undefined` when the tool is missing, and throws `ToolStopped` when it runs past its time limit, 30 seconds unless the caller asks for less, is aborted or prints more than 16 MiB, after ending the tool's whole process tree, its `reason` saying which. When the tree does not end, it throws `AbandonedRun`, whose `exited` settles once the process really exits, so a caller never starts the same command again while the first still runs.
- git on a project or workspace goes through `src/main/workspaces/git-command.ts`. `gitArgs(folder, args)` puts the safe options and `-C <folder>` first, and `runGit(folder, args, timeoutMs, signal?, { gitVariables?, filtersOf?, lazyFetch?, bytes?, input? })` runs it, setting only environment variables on the closed `gitVariables` list in `tools.ts` and reading output byte for byte as latin1 when `bytes` is set, answers `undefined` for a run that failed to finish, throws `tool-missing` when git is gone, and starts nothing in a folder where a git is stuck. `readGit` takes the same arguments and names why a run failed to finish instead, `time`, `stopped`, `output`, `stuck` or `failed`. Use its time limits, and put any value from the interface or a repository after `--end-of-options` or as a full `refs/...` name. Every git run already has `GIT_NO_LAZY_FETCH=1`, and only the workspace checkout passes `lazyFetch`. A run that rehashes working files, such as `status`, `diff` against the worktree or `worktree remove`, passes `filtersOf: <folder>` so the repository's own clean and process filters are blanked through `src/main/workspaces/repository-config.ts`, and on a git that ignores the no-fetch variable a partial clone's reads throw its refusal. A feature passes `gitVariables` only as the changes reads do, the replace and graft variables for stored objects and the other three for the conflict check's scratch repository in `src/main/changes/conflict-check.ts`, and a new name joins the closed list in `tools.ts` only with a recorded reason. A new git command lists the programs a repository's config can make it start, its writes and its optional index lock in the Reads paragraph or the Workspaces section of `ARCHITECTURE.md` before it ships. Adding a project is the one git call outside it, through `runTool` in `src/main/projects/repository-check.ts`.
- `chooseFolder(window)` opens the native folder dialog, or reads the verify answer file, and answers a path or `undefined`. A path that reaches `git` always goes after `-C` in the argument array.
- `openInBrowser(href)` opens an address `links.open` already checked in the system browser, or appends it to the verify links file.
- `installCommand(tool)` answers the fixed install step for a missing tool on this platform, a `command` or an `address`.
- `childEnvironment()` is the user's login shell environment without `ELECTRON_` variables and the AppImage launch variables, with `XDG_CURRENT_DESKTOP` restored. Every child gets it.
- `resolveInside(root, requested)` answers the real path inside `root`, symlinks followed, or `undefined`. Every path from the interface or a repo that belongs inside a known folder goes through it. A folder to add as a project has no such root, so it goes through `checkRepository` in `src/main/projects/repository-check.ts` instead. `samePath(a, b)` compares two paths the way the platform does, case-insensitively on macOS and Windows, and `isInsidePath(parent, child)` asks whether one holds the other with the same case folding. `isFullyQualified` refuses Windows device paths, and `isNetworkPath` names a Windows share.
- `file-system.ts` holds the file system's platform rules, `isSafeFileName`, `isShortName`, `isTooLongForCheckouts`, `isLinkedFolder` and `restrictToUser`, which gives a folder Satellite makes mode `0700` off Windows, and the small helpers features share, `errorCode`, `isMissing`, `folderIdentity` with `sameIdentity` on 64-bit device and inode, and the `noFollow`, `nonBlocking` and `noTerminal` open flags. A new Windows file rule goes here.
- `system-notices.ts` owns notifications and the app icon count. `showNotice(text, onClick)` shows Satellite's words and answers a `ShownNotice` or `undefined`, `setAppBadge(count)` sets the count, clamped to 0 to 4200 and skipped on Windows, and `prepareSystemNotices()` sets the Windows app identity at start. Under `SATELLITE_VERIFY_NOTICES` notifications and the count go to that file instead, the Windows identity is still set, and `windowCountsInFront` and `windowTookFocus` make the window count as never in front.
- `spawnPty(command, { cwd, cols, rows, env })` answers a `PtyProcess` with its `pid` whose `kill()` ends the whole tree on every platform.
- `readProcessTable()` in `process-table.ts` is the only way to read what runs, and `readListeningPorts(pids)` in `listening-ports.ts` the only way to read ports. Both take no argument from a page, run `ps`, `lsof`, `ss` or PowerShell by absolute path and answer an empty list when a read fails, so code that acts on a table treats an empty one as a failure. A feature signals a process only through `endSubtree(target)` in `process-tree.ts`, and only for a process `ownedProcess` in `src/main/processes/` proved descends from a running session, never with `process.kill` on its own and never to a group.
- `claudeEnvironment(env)` is what Claude Code starts with, the child environment minus the deny list of names that point at whatever started Satellite, with `127.0.0.1` added to `NO_PROXY` when a proxy is set.

`src/main/sessions/` owns launching `claude`. `claudeArgs` in `claude-launch.ts` builds every argument from fixed flags, a UUID and the settings file, and `hookSettings` the hooks in that file, so nothing else builds Claude Code's arguments or hooks, and `src/main/terminal/terminal-sessions.ts` is the one caller. A new hook event joins `hookEvents` only when Claude Code runs HTTP hooks for it, and the listener, the status machine and the Sessions section of `ARCHITECTURE.md` change with it.
- `satelliteHome()` and `prepareSatelliteHome()` own `~/.satellite` and `SATELLITE_HOME`. All state lives there, never in a user's repo.

A new tool joins the `Tool` union. Its override variable, a JSON array of strings, goes in `toolOverrideVariables` when verify needs a stand-in for it.

## Look and colour scheme

`DESIGN.md` owns every visual rule. `src/renderer/styles/app.css` defines its app tokens as CSS variables, light in `:root` and dark under `prefers-color-scheme: dark`, and maps them in `@theme inline` after `--color-*: initial`, so the only colours Tailwind knows are the tokens.

- Components use token utilities only, `bg-bg`, `bg-side`, `text-fg`, `text-dim`, `border-line`, `bg-pri-bg text-pri-fg`, `outline-accent`. A raw colour never appears in a component.
- Every enabled control shows the pointer through one rule in the base layer of `app.css`, a list of the elements and roles the app's controls use that turns back to the arrow on `:disabled` and `aria-disabled="true"`. A new kind of control is one more selector there, never a cursor class on a component, and anything clickable is a real `button` or sits inside an element with its role, as a tree row sits in its `treeitem`, never a bare `div` with a click handler, a scrim aside. Two cursors stay outside the rule, the resize cursor of a divider as a utility, and the pointer on a diff's thread marks, a Monaco gutter decoration, as an unlayered `.thread-mark` rule, since Monaco's own styles are unlayered and beat the base layer.
- Type is `font-sans` (Funnel Sans, app text at 13px), `font-display`, `font-mono` (Geist Mono) and `font-pixel` (readouts, uppercase). The terminal and the Monaco viewers take the system's code font and size from `codeType` in `src/renderer/ui/code-type.ts`, never a bundled family.
- The colour scheme follows `prefers-color-scheme`, which the background process points at the saved theme choice, `system`, `light` or `dark`, through `nativeTheme.themeSource` at start and on every `interface.save`, so DOM parts need nothing and no part reads the choice itself. A part that takes colours as options, like the terminal and the diff editor, reads tokens with `getComputedStyle(document.documentElement).getPropertyValue("--bg")` and rebuilds on `matchMedia("(prefers-color-scheme: dark)")` `change`, as `terminal-theme.ts` and `monaco-environment.ts` do. Monaco needs six digit hex, so its theme passes each token through a canvas.
- Fonts come from the `@fontsource` packages imported at the top of `app.css` and are bundled. `entry.tsx` waits for each family in `fontFamilies` before the first render, so a new family goes in that list. Nothing loads from the network.
- File kind icons come from the icon set, a dev dependency named in `package.json`. Its SVGs are bundled as files, never inlined (`assetsInlineLimit` refuses `.svg`), loaded lazily with the Files tab and drawn as `<img>` from the app's own origin, so `img-src 'self'` covers them. Its licence is added in `scripts/third-party-licenses.ts`.

## Interface parts

`src/renderer/ui/` holds the shared parts, each a named export.

- `Button`, the `primary`, `secondary`, `ghost` and `danger` variants in the `default` and `small` sizes, `danger` for the one action that loses work, such as Archive anyway, with an optional `icon`, `shortcut` hint, `title` for its tooltip and `label`, the accessible name, which an icon-only button needs. A disabled button keeps focus through `aria-disabled` and ignores clicks.
- `Dialog`, the modal panel with a title, an optional description, a body and a footer. It takes focus on open, makes everything beside it inert, keeps Tab and Shift+Tab inside, closes on Escape or a click outside only while `closable`, and returns focus to what had it on open.
- `Segmented`, a radio group of two or more options with a label, a value, options each carrying a `testId`, and an `onChange`, the arrow keys moving the choice with focus. Changes uses it for its view and its layout, and Settings for the theme and notifications.
- `refresh-schedule.ts` in `src/renderer/ui/`, the polling schedule with a backoff that takes a pace, 2 to 30 seconds by default and 30 to 300 for the pull request, with resets and a hidden stop, which `useChanges`, `useFiles` and `usePullRequests` all run on. A new view that follows the disk reuses it and never adds a watcher.
- `Icon`, the line icons by `IconName`.
- `KeyHint`, a key cap such as `⌘K`, framed or `plain`.
- `StatusPixel`, the square status pixel in the state colours of `DESIGN.md`, `idle` grey, `working` ultraviolet, `ready` volt, `done` lilac or `needs-you` signal.
- `PixelAvatar`, a project's generated avatar from a seed, its id.
- `Toast`, an `info`, `notice` or `error` toast with a dismiss button, raised through the `Notify` function the window passes down. One shows at a time inside one polite status region, which a dialog and the command menu leave out of the `inert` they put on everything else, so a toast under them is still announced and dismissable with the mouse, and a press on a toast never takes focus, so the menu or dialog keeps the keys, an error goes to the front, and an `info` toast, a plain confirmation, goes ahead of the notices still waiting and is dropped rather than shown late when it waited more than 10 seconds, while a `notice`, which reports something Satellite forgot, stopped or could not read, and an error, which reports a failure or a refusal, always show (`window/toast-queue.ts`).
- `withUniqueTestIds`, which suffixes repeated test ids with `-2`, `-3`, so two projects of one name stay apart.

Every action is a command, so the button, the shortcut and the command menu all run the same thing. To add one, add its id to `CommandId` in `src/renderer/commands/command-registry.ts`, then one entry to the list `AppWindow` passes to `createCommandRegistry`, with `id`, a plain `title`, an optional `shortcut` such as `{ key: "o" }`, `available` and `run`. The registry refuses a repeated id or shortcut, and a `run` that throws or rejects shows a sentence in a toast. The command menu lists every available command but `palette.commands` itself. Draw its button with `CommandButton` from `src/renderer/commands/commands-context.tsx`, which takes the title, the shortcut hint and the availability from the registry, and with `tooltip` adds the shortcut to the tooltip it shows. A shortcut names one key. It is Cmd plus that key on macOS and Ctrl+Shift plus that key on Windows and Linux, everywhere, the terminal included, never with Alt, so plain Ctrl keys always reach Claude Code. The one exception is Open settings, `{ key: ",", ctrlAlone: true }`, which takes Ctrl+Comma there because it is the standard and the terminal sends nothing for it. A shortcut on a key other than a letter or digit adds its physical key to `physicalCode` in `shortcuts.ts`. A held key runs a command once, nothing fires while an input method is composing, and a press for a command that is not available falls through to the focused element. While any dialog, Settings included, is open every command is unavailable, so no shortcut reaches past it, and a command that opens one of them closes the command menu first. To add a part, take its rules from the Components section of `DESIGN.md` and its drawing from `BRAND.html` chapter 08, then write one file in `src/renderer/ui/` with a named export, token utilities only, the focus ring `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent` on anything focusable, and a `testId` prop passed to `data-testid`. Test ids are kebab-case and are how verify finds things. State stays in the component with React hooks, and there is no state library. Copy follows the Voice section of `DESIGN.md`.

## Imports and TypeScript

- Relative imports carry their extension, `./registry.ts` or `../ui/button.tsx`, so the same file runs under Vite, Vitest and plain Node. No path aliases.
- Type-only imports use `import type` or an inline `type`. `verbatimModuleSyntax` and `erasableSyntaxOnly` refuse enums, namespaces and parameter properties.
- Strict mode plus `noUncheckedIndexedAccess`, so `array[0]` may be `undefined`, and `noPropertyAccessFromIndexSignature`, so environment reads are `process.env["SATELLITE_HOME"]`.
- Three projects. `tsconfig.json` covers main, preload, shared, `lint/`, `scripts/` and the configs with Node types. `src/renderer/tsconfig.json` covers the renderer and shared with DOM types. `verify/tsconfig.json` covers `verify/` and `src/main/platform/`. `verify/markdown-parser.test.ts` tests the renderer's Markdown parser from there, because it runs the parser in a real `node:worker_threads` worker and the renderer project has no Node types. A new top-level folder of TypeScript joins one of them.

## Lint stops you on

- Any comment. Only a tool directive with its reason after ` -- ` passes, like `// eslint-disable-next-line <rule> -- <why>`, and never one that disables `satellite/no-comments`.
- A default export, `export { x as default }` and `export * as default`. Config files are the exception a tool needs.
- Any type assertion, `as` or angle brackets. Narrow with a schema, a type guard or `satisfies`.
- A file or folder that is not kebab-case, and any `index.ts` or `index.tsx`.
- Everything in typescript-eslint's strict and stylistic type-checked sets and the React hooks rules, at zero warnings.

## Dependencies

- The Pull request tab's Markdown rests on `unified`, `remark-parse`, `remark-gfm`, `remark-rehype` and `hast-util-to-jsx-runtime`, with the `hast` and `mdast` types, all MIT dev dependencies pinned exactly and bundled into the renderer. The licence step lists every bundled package in the notices by itself, and `electron.vite.config.ts` aliases `decode-named-character-reference` to its plain build because the browser build needs a `document` that the worker has none of.
- `dependencies` holds only what the main process loads from `node_modules` at run time, `node-pty` and `zod`. Everything else, the renderer's libraries included, is a dev dependency, because the renderer is bundled and a runtime dependency lands in the packaged app.
- A new runtime dependency is the maintainer's call. Dev dependencies are yours.
- `.npmrc` saves exact versions. Check the latest with `npm view <pkg> version` and the current docs. A machine whose npm refuses very fresh releases keeps the newest one it accepts.

## Scripts

| Command | Does |
| --- | --- |
| `npm ci` | Installs, and `postinstall` restores the macOS pty helper's executable bit and installs the Electron binary unless `ELECTRON_SKIP_BINARY_DOWNLOAD` is set |
| `npm run dev` | `electron-vite dev`, the app with the renderer on a local dev server and hot reload |
| `npm run build` | `electron-vite build` into `out/`, the renderer minified |
| `npm run package` | `electron-builder --publish never`, packages for this machine from `out/` into `release/`. Build first |
| `npm run verify -- <scenario> [step ...]` | Launches the real app in a scenario and prints JSON, skill `satellite-verify` |
| `npm run journeys` | Builds once and runs every journey `verify/journeys.ts` lists |
| `npm run format`, `npm run format:check` | Prettier at 100 columns. Markdown and HTML are left alone |
| `npm run lint` | ESLint, zero warnings |
| `npm run typecheck` | `tsc` over the three projects |
| `npm test` | Vitest over `src/`, `lint/` and `verify/` |
| `./scripts/check` | Guards, guard tests, format check, lint, typecheck and tests. Every step runs, and it ends with `check: all green` |
| `node scripts/checksums.ts <folder> <label>` | Writes `SHA256SUMS-<label>.txt` for the packages in a folder |

## Run and prove

`npm run dev` opens the app with the user's real tools. Proof goes through the driver against the built app, `npm run --silent verify -- default`, which builds, launches with a temporary home and stand-ins, and prints the window as JSON with screenshots (skill `satellite-verify`). Built and dev runs share `out/`, so one run per checkout at a time.

The app reads `SATELLITE_HOME`, an absolute path that replaces `~/.satellite`, and `SATELLITE_GH`, `SATELLITE_CLAUDE` and `SATELLITE_GIT`, a JSON array with the executable then its leading arguments. `ELECTRON_RENDERER_URL` aims the window at the dev server only when the app is not packaged. `SATELLITE_VERIFY_FOLDER_DIALOG`, the absolute path of a file, answers the folder dialog with that file's content, which is how verify adds a project. `SATELLITE_VERIFY_LINKS`, the absolute path of a file, makes `openInBrowser` append each address there instead of opening the browser. `SATELLITE_VERIFY_NOTICES`, the absolute path of a file, makes `system-notices.ts` append each notification, close and app icon count there as a JSON line instead of reaching the system, and the window then always counts as not in front. The first two are honoured only while Satellite can signal the process `SATELLITE_VERIFY_DRIVER_PID` names, the same check quiet mode uses, which proves a live process of the same user and not that it is the driver. The notices file is honoured when that check passes at its first use and stays chosen for the run.

## Native modules and packaging

- **node-pty** is N-API, so one build runs in Node and Electron and packaging never rebuilds it (`npmRebuild: false`). macOS and Windows use its bundled builds. Linux has none, so `npm ci` compiles it with node-gyp, which needs python3, make and a C++ compiler, and the Linux package then needs a glibc at least as new as the build machine's. Only `src/main/platform/pty.ts` imports it.
- **The spawn helper.** node-pty ships its macOS `spawn-helper` without the executable bit, and every spawn then fails with `posix_spawnp failed`. `npm run postinstall` restores it. `npm rebuild node-pty` does not.
- **Electron's binary** is fetched by `postinstall`, since the electron package installs nothing by itself. CI's check job skips it with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, because it never launches the app.
- **Windows kills.** node-pty's own kill forks a helper, and with the run-as-Node fuse off a fork starts a second Satellite. `PtyProcess.kill()` ends the tree with the start-checked stop in `process-tree.ts` first and calls node-pty's kill only when the exit never comes. Nothing uses `taskkill`, whose tree flag follows parent ids with no start check. Never call node-pty's kill directly.
- **Packaging.** `electron-builder.yml` ships `out/` and `package.json` as `app.asar`, unpacks only node-pty's native files with smart unpacking off, keeps only this platform's node-pty build, drops tests, source maps and `node-addon-api`, puts `third-party-licenses.md` in the resources folder and flips the fuses. A runtime dependency with native code needs the same `asarUnpack` and `files` treatment, and its licence reaches the notices by itself because `scripts/third-party-licenses.ts` adds every runtime dependency. macOS packages are ad-hoc signed. To package one Mac architecture, `npm run build`, then `npx electron-builder --mac --arm64 --publish never`.
- **Release.** `.github/workflows/release.yml` proves and packages macOS, Windows and Linux, and `ARCHITECTURE.md` Packaging and fuses says how. Pushing a branch named `platforms/<slug>` runs the same matrix without publishing, which is how Windows and Linux are proven before a merge.
