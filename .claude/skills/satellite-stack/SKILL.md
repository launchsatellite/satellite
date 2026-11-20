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

- `src/main/<feature>/` holds its handlers and logic, for example `src/main/git/git-status.ts` with `git-status.test.ts` beside its parser.
- `src/renderer/<feature>/` holds its views, for example `src/renderer/changes/changes-view.tsx`.
- Its messages go in `src/shared/bridge-contract.ts`, its rows in the `ARCHITECTURE.md` Bridge table.
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
   void invoke("tools.versions", {}).then(setVersions);
   ```

   React 19 ignores a state update after unmount, so a request whose answer only sets state needs no unmount guard. One that starts something, like `terminal.start`, has a matching cleanup in the effect.

6. **Record it.** One row in the Bridge table of `ARCHITECTURE.md`, with what it does, its limits and why it is safe. Ask what a page that runs hostile script could do with exactly this message. If the answer is more than the row says, narrow the schema or the handler.
7. **Prove it** in the app (skill `satellite-verify`). A new kind of refusal gets a case in the `boundary` journey.

An event is the same, with `bridgeEvents` instead. The handler sends it with `owner.emit("x.done", payload)`, so it reaches only the page that owns it. Add the event's empty `Set` to `listeners` in `src/renderer/bridge/bridge-client.ts`, which typecheck asks for. The client holds one IPC listener for every subscriber, parses each event once, and drops and logs one that fails its schema, naming the event and the failing fields, never the payload. The renderer listens with `subscribe("x.done", listener)`, which returns the unsubscribe for the effect's cleanup. Subscribe before the request that makes the events, as `TerminalView` does before `terminal.start`.

Never add an IPC channel, a preload function or an `ipcMain` handler. Everything goes through `satellite:bridge` and `satellite:event`.

## The platform module

`src/main/platform/` is the only code that spawns a process, imports `node:child_process` or `node-pty`, finds an executable or branches on `process.platform`. The macOS app menu is the one other platform branch. A feature calls in.

- `resolveTool("gh")` and `runTool("git", ["status", "--porcelain=v2"], { timeoutMs })` take a `Tool` and an argument array, never a shell string. `runTool` answers `{ exitCode, stdout, stderr }`, or `undefined` when the tool is missing, and throws when it runs past its time limit, 30 seconds unless the caller asks for less, after ending the tool's whole process tree.
- `chooseFolder(window)` opens the native folder dialog, or reads the verify answer file, and answers a path or `undefined`. A path that reaches `git` always goes after `-C` in the argument array.
- `childEnvironment()` is the user's login shell environment without `ELECTRON_` variables and the AppImage launch variables, with `XDG_CURRENT_DESKTOP` restored. Every child gets it.
- `resolveInside(root, requested)` answers the real path inside `root`, symlinks followed, or `undefined`. Every path from the interface or a repo goes through it.
- `spawnPty(command, { cwd, cols, rows, env })` answers a `PtyProcess` whose `kill()` ends the whole tree on every platform.
- `satelliteHome()` and `prepareSatelliteHome()` own `~/.satellite` and `SATELLITE_HOME`. All state lives there, never in a user's repo.

A new tool joins the `Tool` union. Its override variable, a JSON array of strings, goes in `toolOverrideVariables` when verify needs a stand-in for it.

## Look and colour scheme

`DESIGN.md` owns every visual rule. `src/renderer/styles/app.css` defines its app tokens as CSS variables, light in `:root` and dark under `prefers-color-scheme: dark`, and maps them in `@theme inline` after `--color-*: initial`, so the only colours Tailwind knows are the tokens.

- Components use token utilities only, `bg-bg`, `bg-side`, `text-fg`, `text-dim`, `border-line`, `bg-pri-bg text-pri-fg`, `outline-accent`. A raw colour never appears in a component.
- Type is `font-sans` (Funnel Sans, app text at 13px), `font-display`, `font-mono` (Geist Mono) and `font-pixel` (readouts, uppercase).
- The colour scheme follows `prefers-color-scheme`, which the background process points at the saved theme choice through `nativeTheme.themeSource`, so DOM parts need nothing. A part that takes colours as options, like the terminal and the diff editor, reads tokens with `getComputedStyle(document.documentElement).getPropertyValue("--bg")` and rebuilds on `matchMedia("(prefers-color-scheme: dark)")` `change`, as `terminal-theme.ts` and `monaco-environment.ts` do. Monaco needs six digit hex, so its theme passes each token through a canvas.
- Fonts come from the `@fontsource` packages imported at the top of `app.css` and are bundled. `entry.tsx` waits for each family in `fontFamilies` before the first render, so a new family goes in that list. Nothing loads from the network.

## Interface parts

`Button` in `src/renderer/ui/button.tsx` draws primary, secondary and ghost buttons in two sizes, with an optional icon, shortcut hint and `label` for an icon-only button. An action people can also reach from the keyboard is a command. Register it once in the registry `AppWindow` builds, with its title, optional shortcut and availability, and draw its button with `CommandButton` from `src/renderer/commands/commands-context.tsx`, so the button, the shortcut and the command menu all run the same thing. Shortcuts are Cmd on macOS and Ctrl elsewhere, never with Alt, and on Windows and Linux they stay with the terminal while it has focus. A held key runs a command once, nothing fires while an input method is composing, and a press for a command that is not available falls through to the focused element. To add a part, take its rules from the Components section of `DESIGN.md` and its drawing from `BRAND.html` chapter 08, then write one file in `src/renderer/ui/` with a named export, token utilities only, the focus ring `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent` on anything focusable, and a `testId` prop passed to `data-testid`. Test ids are kebab-case and are how verify finds things. State stays in the component with React hooks, and there is no state library. Copy follows the Voice section of `DESIGN.md`.

## Imports and TypeScript

- Relative imports carry their extension, `./registry.ts` or `../ui/button.tsx`, so the same file runs under Vite, Vitest and plain Node. No path aliases.
- Type-only imports use `import type` or an inline `type`. `verbatimModuleSyntax` and `erasableSyntaxOnly` refuse enums, namespaces and parameter properties.
- Strict mode plus `noUncheckedIndexedAccess`, so `array[0]` may be `undefined`, and `noPropertyAccessFromIndexSignature`, so environment reads are `process.env["SATELLITE_HOME"]`.
- Three projects. `tsconfig.json` covers main, preload, shared, `lint/`, `scripts/` and the configs with Node types. `src/renderer/tsconfig.json` covers the renderer and shared with DOM types. `verify/tsconfig.json` covers `verify/` and `src/main/platform/`. A new top-level folder of TypeScript joins one of them.

## Lint stops you on

- Any comment. Only a tool directive with its reason after ` -- ` passes, like `// eslint-disable-next-line <rule> -- <why>`, and never one that disables `satellite/no-comments`.
- A default export, `export { x as default }` and `export * as default`. Config files are the exception a tool needs.
- Any type assertion, `as` or angle brackets. Narrow with a schema, a type guard or `satisfies`.
- A file or folder that is not kebab-case, and any `index.ts` or `index.tsx`.
- Everything in typescript-eslint's strict and stylistic type-checked sets and the React hooks rules, at zero warnings.

## Dependencies

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
| `npm run journeys` | Builds once and runs `launch`, `boundary` and `quit` |
| `npm run format`, `npm run format:check` | Prettier at 100 columns. Markdown and HTML are left alone |
| `npm run lint` | ESLint, zero warnings |
| `npm run typecheck` | `tsc` over the three projects |
| `npm test` | Vitest over `src/`, `lint/` and `verify/` |
| `./scripts/check` | Guards, guard tests, format check, lint, typecheck and tests. Every step runs, and it ends with `check: all green` |
| `node scripts/checksums.ts <folder> <label>` | Writes `SHA256SUMS-<label>.txt` for the packages in a folder |

## Run and prove

`npm run dev` opens the app with the user's real tools. Proof goes through the driver against the built app, `npm run --silent verify -- default`, which builds, launches with a temporary home and stand-ins, and prints the window as JSON with screenshots (skill `satellite-verify`). Built and dev runs share `out/`, so one run per checkout at a time.

The app reads `SATELLITE_HOME`, an absolute path that replaces `~/.satellite`, and `SATELLITE_GH` and `SATELLITE_CLAUDE`, a JSON array with the executable then its leading arguments. `ELECTRON_RENDERER_URL` aims the window at the dev server only when the app is not packaged.

## Native modules and packaging

- **node-pty** is N-API, so one build runs in Node and Electron and packaging never rebuilds it (`npmRebuild: false`). macOS and Windows use its bundled builds. Linux has none, so `npm ci` compiles it with node-gyp, which needs python3, make and a C++ compiler, and the Linux package then needs a glibc at least as new as the build machine's. Only `src/main/platform/pty.ts` imports it.
- **The spawn helper.** node-pty ships its macOS `spawn-helper` without the executable bit, and every spawn then fails with `posix_spawnp failed`. `npm run postinstall` restores it. `npm rebuild node-pty` does not.
- **Electron's binary** is fetched by `postinstall`, since the electron package installs nothing by itself. CI's check job skips it with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, because it never launches the app.
- **Windows kills.** node-pty's own kill forks a helper, and with the run-as-Node fuse off a fork starts a second Satellite. `PtyProcess.kill()` ends the tree with `taskkill` first and calls node-pty's kill only when the exit never comes. Never call node-pty's kill directly.
- **Packaging.** `electron-builder.yml` ships `out/` and `package.json` as `app.asar`, unpacks only node-pty's native files with smart unpacking off, keeps only this platform's node-pty build, drops tests, source maps and `node-addon-api`, puts `third-party-licenses.md` in the resources folder and flips the fuses. A runtime dependency with native code needs the same `asarUnpack` and `files` treatment, and its licence reaches the notices by itself because `scripts/third-party-licenses.ts` adds every runtime dependency. macOS packages are ad-hoc signed. To package one Mac architecture, `npm run build`, then `npx electron-builder --mac --arm64 --publish never`.
- **Release.** `.github/workflows/release.yml` packages and runs the journeys on macOS, Windows and Linux. A `v*` tag drafts a release when all three pass. Pushing a branch named `platforms/<slug>` runs the same matrix without publishing, which is how Windows and Linux are proven before a merge.
