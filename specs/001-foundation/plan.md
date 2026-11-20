# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Electron app that opens the three empty columns, runs the real Claude Code in a terminal component and a read-only Monaco diff, joined to a hardened background process by one schema-checked bridge, with the green checkpoint, CI, a release matrix and an agent-driven verify harness.

**Architecture:** One npm package, ESM, built by electron-vite into `out/` and packaged by electron-builder into `release/`. `src/main/` is the background process (feature folders plus `platform/`, the only code that knows executables, shells, paths and spawning). `src/preload/` exposes two functions over one IPC channel pair. `src/renderer/` is the sandboxed interface served from a custom `app://` protocol. `src/shared/` holds the bridge contract as zod schemas. `verify/` drives the real app over the Chrome DevTools Protocol with stand-in `gh` and `claude`.

**Tech Stack:** Node 24, Electron 45, electron-vite 6 on Vite 8, React 19, TypeScript 6.0, zod 4, node-pty 1.1, xterm.js 6, Monaco 0.57, Tailwind 4, Vitest 5, playwright-core 1.65, ESLint 10 with typescript-eslint 8, Prettier 3, electron-builder 26.

**Spec:** `specs/001-foundation/spec.md`

## Verified facts

Checked with `npm view`, package tarballs, official docs and the GitHub API while planning.

- **Electron 45.4.1** is latest stable and ships Node 24.22.3 and Chromium 156 (releases.electronjs.org). Node 24 LTS is 24.22.3 (nodejs.org dist index). Node 24 runs `.ts` files by type stripping, so `verify/` and `scripts/*.ts` run with plain `node`.
- **electron-vite 6.0.0** is a stable release with Vite 6, 7 and 8 as peers and is actively released (GitHub releases). Dependencies in `dependencies` are externalized for main and preload by default (`build.externalizeDeps`). A sandboxed preload must disable externalization and be CommonJS, because ESM preloads only run unsandboxed (electron-vite docs, dependency handling and development pages). Default entries include `src/main/main.ts` and `src/preload/preload.ts`, so no `index.ts` is needed.
- **TypeScript.** `latest` is 7.0.2, the native compiler, but typescript-eslint 8.73.0 declares `typescript >=4.8.4 <6.1.0`. Typed lint needs the JavaScript compiler API, so this plan pins **TypeScript 6.0.3**. TypeScript 6 defaults `types` to `[]`, so each tsconfig lists its types.
- **Playwright's `_electron.launch`** passes `--inspect=0` and waits for `Debugger listening on` before anything else (playwright-core 1.65.1 `coreBundle.js`, `ElectronLauncher.launch`). With the `EnableNodeCliInspectArguments` fuse off that line never appears, so `_electron.launch` cannot drive the packaged app. The driver therefore starts the app with `--remote-debugging-port=0`, reads `DevTools listening on ws://…` from stderr and uses `chromium.connectOverCDP`. `playwright-core` is enough, no browser download.
- **node-pty 1.1.0** (latest stable) is N-API, so one binary works in Node and Electron without a rebuild. Its tarball ships prebuilds for darwin-arm64, darwin-x64, win32-arm64 and win32-x64 only. Linux compiles from source at install with node-gyp (python3, make, a C++ compiler, all present on GitHub's Ubuntu runners). The darwin `spawn-helper` files in the tarball are mode 644, which makes every macOS spawn fail with `posix_spawnp failed`, so a postinstall step restores the executable bit. node-pty 1.2.0-beta.18 fixes both but is a beta. node-pty rewrites `app.asar` to `app.asar.unpacked` for its helper, so it must be unpacked from the asar.
- **xterm.js 6.0.0** has no kitty keyboard protocol option (typings). `@xterm/addon-unicode-graphemes` 0.4.0 describes itself as experimental. Claude Code's terminal docs say Shift+Enter needs a key binding in editor-embedded terminals and that Option+Enter (ESC then CR) inserts a newline everywhere. The same docs say Claude Code's own setup turns GPU acceleration off in editor-embedded terminals to prevent garbled text.
- **Monaco 0.57.0** is MIT and maps `monaco-editor/*` to `esm/vs/*.js`. The core API is `monaco-editor/editor/editor.api` and the editor worker is `monaco-editor/editor/editor.worker`. It depends on `marked` and `dompurify` internally.
- **Fonts.** `@fontsource-variable/funnel-display`, `@fontsource-variable/funnel-sans`, `@fontsource-variable/geist-mono` and `@fontsource/geist-pixel`, all 5.3.0 and OFL-1.1, ship woff2 files, so nothing is vendored. Family names are `Funnel Display Variable`, `Funnel Sans Variable`, `Geist Mono Variable` and `Geist Pixel`.
- **electron-builder 26.18.0** has an `electronFuses` option covering every fuse below and computes ASAR integrity for macOS and Windows. With `mac.identity` unset and no certificate it skips signing with no ad-hoc fallback, which leaves a fuse-flipped arm64 binary unlaunchable. `identity: "-"` ad-hoc signs and needs `hardenedRuntime: false` (app-builder-lib typings). Electron Forge 8.0.1 exists but has no first-party AppImage maker, and electron-builder makes dmg, zip, nsis, AppImage and deb natively.
- **ASAR integrity** works on macOS from Electron 16 and Windows from Electron 30, not on Linux (Electron docs). The docs do not say whether it needs signing. Not confirmed from docs, so the packaged journeys plus `@electron/fuses read` prove it per platform.
- **Electron security checklist** has 20 items (electronjs.org security tutorial). This plan covers every one that applies. Items 2, 5, 11 and 12 concern remote content and webviews, and Satellite loads neither, but permission requests are still denied and webviews refused.
- **GitHub Actions.** `ubuntu-latest` is 24.04, `macos-latest` is macOS 26 arm64, `windows-latest` is Server 2025 (runner-images README). Pinned labels `ubuntu-24.04`, `macos-26`, `windows-2025` are used. Latest actions are checkout v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, setup-node v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1`, upload-artifact v7.0.2 `cf430e030ddbb5b0abf93d22962f4752f3646cd9`, download-artifact v8.0.2 `9000827ccba6bdab643e8b6fd33ac0654aef8333`. `workflow_dispatch` only fires when the workflow file exists on the default branch (GitHub docs).
- **ESLint 10** loads `eslint.config.ts` through `jiti` 2.2 or later, or only behind an unstable flag (ESLint docs), so `jiti` is a dev dependency.
- **Not confirmed.** Whether ConPTY delivers the stand-in's resize event on the Windows runner, and whether the lockfile stays under the guards' 1 MB limit. Both are checked by running, see Task 5 and Task 1.

## Global Constraints

Binding for every task: `.superpowers/sdd/global-constraints.md`, `AGENTS.md`, `.claude/skills/satellite-conventions/SKILL.md`. Everything there applies, including no comments, kebab-case, named exports, no casts, tests only where they pay, no home-folder paths in files, never push.

Stack values, exact:

- **Runtime.** `.nvmrc` holds `24`. `package.json` has `"type": "module"`, `"engines": { "node": ">=24 <25" }`, `"main": "out/main/main.js"`, `"private": true`, `"version": "0.1.0"`, `"productName": "Satellite"`, `"author": "Satellite"`.
- **Install with `--save-exact`.** `dependencies` holds only what the main process loads from `node_modules` at run time, `node-pty@1.1.0` and `zod@4.6.7`. Everything the renderer bundles is a dev dependency, so it never lands in the asar twice.
- **Dev dependencies.** `electron@45.4.1`, `electron-vite@6.0.0`, `vite@8.3.8`, `@vitejs/plugin-react@6.3.0`, `electron-builder@26.18.0`, `@electron/fuses@2.1.3`, `react@19.3.1`, `react-dom@19.3.1`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `typescript@6.0.3`, `@types/node@24.19.2`, `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`, `@xterm/addon-unicode11@0.9.0`, `monaco-editor@0.57.0`, `tailwindcss@4.3.5`, `@tailwindcss/vite@4.3.5`, `@fontsource-variable/funnel-display@5.3.0`, `@fontsource-variable/funnel-sans@5.3.0`, `@fontsource-variable/geist-mono@5.3.0`, `@fontsource/geist-pixel@5.3.0`, `vitest@5.1.1`, `playwright-core@1.65.1`, `eslint@10.15.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.73.0`, `eslint-plugin-react-hooks@7.1.1`, `eslint-plugin-check-file@3.3.2`, `jiti@2.7.0`, `prettier@3.10.1`. Re-run `npm view <pkg> version` before installing and take a newer patch if one appeared. Anything not listed needs a reason in the task report.
- **npm scripts.** `dev` = `electron-vite dev`, `build` = `electron-vite build`, `package` = `electron-builder --publish never`, `format` = `prettier --write .`, `format:check` = `prettier --check .`, `lint` = `eslint --max-warnings 0 .`, `typecheck` = `tsc -p tsconfig.json && tsc -p src/renderer/tsconfig.json && tsc -p verify/tsconfig.json`, `test` = `vitest run`, `verify` = `node verify/cli.ts`, `journeys` = `node verify/journeys.ts`, `postinstall` = `node scripts/fix-pty-helper-mode.ts`.
- **Folders.** `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, `verify/`, `lint/` (the local lint rule), `packaging/` (electron-builder resources), `scripts/`. Build outputs `out/` and `release/`, driver output `verify-output/`, all gitignored.
- **Imports.** Relative imports carry their `.ts` or `.tsx` extension everywhere, so the same files run under Vite, Vitest and plain Node. `verbatimModuleSyntax` and `erasableSyntaxOnly` are on, so no enums, no namespaces, no parameter properties, and type-only imports use `import type`.
- **Environment variables.** `SATELLITE_HOME` (absolute path, default `~/.satellite`), `SATELLITE_CLAUDE` and `SATELLITE_GH` (a JSON array of strings, the executable then leading arguments), `SATELLITE_VERIFY_SCENARIO` and `SATELLITE_VERIFY_LOG` (read only by stand-ins, never by the app).
- **Bridge names.** IPC channels `satellite:bridge` (invoke) and `satellite:event` (push). Renderer global `window.satellite`. Request channels `tools.versions`, `terminal.start`, `terminal.write`, `terminal.resize`, `terminal.close`. Events `terminal.data`, `terminal.exit`.
- **Protocol.** Scheme `app`, origin `app://satellite`, entry `app://satellite/index.html`. Electron `userData` is `<SATELLITE_HOME>/app-data`.
- **Test ids.** `app-window`, `column-projects`, `column-repository`, `column-sessions`, `tool-git`, `tool-gh`, `tool-claude`, `start-claude`, `terminal`, `diff`.
- **Guards.** The command guard matches text, so write files containing `gh release` or a dot-env name with the file tools, never through the shell. Every committed file stays under 1 MB.

## Review Focus

1. **Launched from the Dock, Finder or a desktop menu**, the app inherits a minimal PATH and would miss `claude` and `gh`. The platform module reads the login shell's environment once, falls back to its own on failure, and a parser test pins the noisy-shell case (Task 3).
2. **A paste far larger than one bridge message** (100 KB) must arrive whole and in order. The renderer chunks and queues writes, and the launch journey compares what the stand-in received (Tasks 5 and 7).
3. **Closing the window or reloading the interface while Claude Code runs** must leave no process behind. The launch journey checks the stand-in's process id is gone after reload and after quit (Tasks 5 and 7).
4. **Paths with spaces, unicode, symlinks and Windows short names** in the Satellite home, the temp folders and the protocol root. `resolveInside` tests cover them and the Windows journey runs from the runner's short-name temp folder (Tasks 2 and 8).
5. **Channel names like `__proto__`, `constructor` or `toString`, and payloads with extra keys**, must reach no handler. The registry looks channels up in a `Map` and uses strict objects, and the registry test names each case (Task 3).

---

### Task 1: Toolchain and the green checkpoint

Sets the spec In progress, installs the toolchain and makes `./scripts/check` run format, lint, typecheck and tests locally and in CI.

**Files:**
- Modify: `specs/001-foundation/spec.md` (status line), `specs/README.md` (index row), both to **In progress**
- Create: `package.json`, `package-lock.json` (generated), `.nvmrc`, `.npmrc`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.ts`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `lint/no-comments.ts`, `lint/no-comments.test.ts`, `scripts/fix-pty-helper-mode.ts`
- Modify: `scripts/check`, `.github/workflows/ci.yml`, `.gitignore`

**Interfaces:**
- Produces: every npm script in Global Constraints (scripts that need later files may exist from the start, they are first run in their task). `noComments: Rule.RuleModule` from `lint/no-comments.ts`, registered as rule `satellite/no-comments`.

- [ ] **Step 1: Status.** Change `Status **Approved**` to `Status **In progress**` in the spec and the 001 row of the index.

- [ ] **Step 2: Package.** Write `package.json` with the fields and scripts from Global Constraints. `.npmrc` holds `save-exact=true`. Install every listed dependency at the listed version. Check `package-lock.json` is under 1 MB (`wc -c package-lock.json`). If it is not, stop and report, the guard is the maintainer's.

- [ ] **Step 3: pty helper mode.** `scripts/fix-pty-helper-mode.ts` sets mode `0o755` on `node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` and `.../darwin-x64/spawn-helper` when they exist and does nothing otherwise, so it runs on every platform. Run `npm rebuild node-pty` and show `ls -l` on both files reads `-rwxr-xr-x`.

- [ ] **Step 4: TypeScript.** `tsconfig.base.json` sets `target` `ES2024`, `module` `preserve`, `moduleResolution` `bundler`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`, `isolatedModules`, `resolveJsonModule`, `skipLibCheck`. Root `tsconfig.json` extends it with `lib` `["ES2024"]`, `types` `["node"]`, `include` `["src/main", "src/preload", "src/shared", "lint", "scripts", "*.config.ts"]`. Task 2 adds `src/renderer/tsconfig.json`, Task 4 adds `verify/tsconfig.json`. Until then `typecheck` runs only the root project, and each task extends the script when its project appears.

- [ ] **Step 5: The no-comments rule test.** `lint/no-comments.test.ts` runs ESLint's `RuleTester` under Vitest (assign `RuleTester.describe`, `RuleTester.it`, `RuleTester.itOnly` from `vitest`). Valid cases are code with no comments, `// eslint-disable-next-line no-console -- the CLI prints its result`, `/* eslint-disable max-lines -- generated table */`, `// @ts-expect-error -- the library types miss this overload`, and a shebang line. Invalid cases, each with one error `comment`, are `// explain the next line`, `/** jsdoc */`, `// eslint-disable-next-line no-console` with no reason, `// @ts-expect-error` with no reason, `// TODO later`. Run it and see it fail because the rule does not exist.

- [ ] **Step 6: The rule.** `lint/no-comments.ts` exports `noComments`. It reports every comment from `sourceCode.getAllComments()` except type `Shebang` and comments whose trimmed text starts with `eslint-disable`, `eslint-enable` or `@ts-expect-error` and contains ` -- ` followed by at least one non-space character. Message `Comments are not allowed. Let names and types carry the meaning, or give a tool directive its reason after " -- ".`. Run the test, it passes.

- [ ] **Step 7: ESLint config.** `eslint.config.ts` default-exports `defineConfig(...)` from `eslint/config` with, in order:

```ts
{ ignores: ['out/', 'release/', 'verify-output/', 'node_modules/'] },
js.configs.recommended,
tseslint.configs.strictTypeChecked,
tseslint.configs.stylisticTypeChecked,
{ languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  linterOptions: { reportUnusedDisableDirectives: 'error' },
  plugins: { satellite: { rules: { 'no-comments': noComments } }, 'check-file': checkFile },
  rules: {
    'satellite/no-comments': 'error',
    'no-restricted-syntax': ['error',
      { selector: 'ExportDefaultDeclaration', message: 'Use a named export.' },
      { selector: 'ExportSpecifier[exported.name="default"]', message: 'Use a named export.' }],
    '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    'check-file/filename-naming-convention': ['error', { '**/*.{ts,tsx}': 'KEBAB_CASE' }, { ignoreMiddleExtensions: true }],
    'check-file/folder-naming-convention': ['error', { 'src/**/': 'KEBAB_CASE', 'verify/**/': 'KEBAB_CASE', 'lint/**/': 'KEBAB_CASE', 'scripts/**/': 'KEBAB_CASE' }],
    'check-file/filename-blocklist': ['error', { '**/index.{ts,tsx}': '*.ts' }],
  } },
{ files: ['src/renderer/**/*.tsx', 'src/renderer/**/*.ts'], ...the react-hooks plugin's flat recommended config (check its README for the export name) },
{ files: ['*.config.ts'], rules: { 'no-restricted-syntax': 'off' } },
```

Plain `.js` and `.mjs` files do not exist in this repo, so typed rules see every file.

- [ ] **Step 8: Prettier and Vitest.** `.prettierrc.json` is `{ "printWidth": 100 }`. `.prettierignore` lists `*.md`, `*.html`, `package-lock.json`, `out`, `release`, `verify-output`, `.superpowers`. `vitest.config.ts` default-exports `defineConfig({ test: { include: ['src/**/*.test.ts', 'lint/**/*.test.ts', 'verify/**/*.test.ts'], environment: 'node' } })`.

- [ ] **Step 9: The checkpoint.** In `scripts/check` replace the line about the stack's checks arriving with four run lines, `run format npm run --silent format:check`, `run lint npm run --silent lint`, `run typecheck npm run --silent typecheck`, `run tests npm run --silent test`. `.gitignore` replaces its last comment line with `node_modules/`, `out/`, `release/`, `verify-output/` under a `# build outputs and caches` heading.

- [ ] **Step 10: CI.** In `.github/workflows/ci.yml`, after checkout, add setup-node pinned as `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` with `node-version-file: .nvmrc` and `cache: npm`, then `- run: npm ci` with `env: ELECTRON_SKIP_BINARY_DOWNLOAD: '1'` (the check never launches Electron), then the existing `./scripts/check`. Keep `permissions: contents: read`, concurrency and timeout as they are.

- [ ] **Step 11: Prove.** `npm run format`, then `./scripts/check` and show its last lines ending `check: all green`. Temporarily add a `// note` comment to `lint/no-comments.ts`, show `npm run lint` refusing it, remove it.

- [ ] **Step 12: Commit.** `chore(stack): add the toolchain and run it from the checkpoint`, then `ci: install dependencies before the checkpoint` for the workflow change.

---

### Task 2: The hardened window with three columns

The app opens one window with the three empty columns in light and dark, served from `app://`, with every hardening item in place.

**Files:**
- Create: `electron.vite.config.ts`, `src/shared/content-security-policy.ts`, `src/main/main.ts`, `src/main/window/main-window.ts`, `src/main/window/app-protocol.ts`, `src/main/window/hardening.ts`, `src/main/platform/satellite-home.ts`, `src/main/platform/paths.ts`, `src/main/platform/paths.test.ts`, `src/preload/preload.ts` (empty bridge for now, filled in Task 3), `src/renderer/tsconfig.json`, `src/renderer/index.html`, `src/renderer/entry.tsx`, `src/renderer/window/app-window.tsx`, `src/renderer/styles/app.css`, `src/renderer/ui/button.tsx`, `ARCHITECTURE.md`
- Modify: `package.json` (`typecheck` gains the renderer project)

**Interfaces:**
- Produces:
  - `contentSecurityPolicy(mode: 'production' | 'development'): string` in `src/shared/content-security-policy.ts`
  - `satelliteHome(): string`, `prepareSatelliteHome(): string` (creates it with mode `0o700`, synchronous because it runs before `app` is ready), `userHomeFolder(): string` in `src/main/platform/satellite-home.ts`
  - `resolveInside(root: string, requested: string): Promise<string | undefined>` in `src/main/platform/paths.ts`
  - `appOrigin = 'app://satellite'`, `registerAppScheme(): void`, `handleAppProtocol(rendererRoot: string): void`, `rendererEntryUrl(): string` in `src/main/window/app-protocol.ts`
  - `hardenSession(session: Session): void`, `hardenWebContents(): void` in `src/main/window/hardening.ts`
  - `createMainWindow(entryUrl: string): BrowserWindow` in `src/main/window/main-window.ts`
  - `AppWindow()` in `src/renderer/window/app-window.tsx` rendering `data-testid` `app-window` with three `<section>` columns `column-projects` (aria-label `Projects`), `column-repository` (`Repository`), `column-sessions` (`Sessions`)
  - `Button({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string })` in `src/renderer/ui/button.tsx`, the primary button from `DESIGN.md` (28 high, radius 6, `pri-bg` and `pri-fg`, ultraviolet 2px focus ring)
  - Tailwind utilities for every `DESIGN.md` app token, `bg-bg`, `text-fg`, `border-line` and so on, and font utilities `font-sans`, `font-display`, `font-mono`, `font-pixel`

- [ ] **Step 1: The path test.** `src/main/platform/paths.test.ts` builds a temp tree with `fs.mkdtemp` holding `root/a.txt`, `root/space folder/zoë.txt`, `outside/secret.txt`, a symlink `root/escape` to `outside/secret.txt` and a symlink `root/inner` to `root/a.txt`. Tests named for the failure they catch: `refuses a path that climbs out with ..`, `refuses an absolute path outside the root`, `refuses a symlink that points outside the root`, `allows a symlink that stays inside`, `returns undefined for a missing file`, `resolves names with spaces and unicode`. Expected values are `undefined` or the realpath of the target. On Windows symlink creation may need privileges, so skip only the two symlink cases there with `it.skipIf(process.platform === 'win32')`. See it fail.

- [ ] **Step 2: `resolveInside`.** Realpath the root and the joined candidate, then accept the candidate only when `path.relative(realRoot, realCandidate)` neither starts with `..` nor is absolute. Missing files return `undefined`. Run the test, it passes.

- [ ] **Step 3: Home.** `satelliteHome()` returns `SATELLITE_HOME` when set, refusing a relative value with an error that names the variable, else `join(homedir(), '.satellite')`.

- [ ] **Step 4: CSP.** Production is `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`. Development changes `script-src` to `'self' 'unsafe-inline'` (the React refresh preamble) and `connect-src` to `'self' ws://localhost:*` (hot reload). `'unsafe-inline'` styles are needed because Monaco and xterm insert style elements, record that in `ARCHITECTURE.md`.

- [ ] **Step 5: electron-vite config.**

```ts
export default defineConfig({
  main: {},
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    server: { headers: { 'Content-Security-Policy': contentSecurityPolicy('development') } },
  },
})
```

Confirm after `npm run build` that `out/main/main.js`, `out/preload/preload.cjs` and `out/renderer/index.html` exist, and fix `main` in `package.json` if the main file name differs.

- [ ] **Step 6: Protocol.** `registerAppScheme` calls `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])` before ready. `handleAppProtocol` serves only `GET` for host `satellite`, maps `/` to `index.html`, decodes the path, confines it with `resolveInside(rendererRoot, path)`, answers 404 for anything refused, and otherwise returns `net.fetch(pathToFileURL(file))` with headers `Content-Security-Policy` (production) and `X-Content-Type-Options: nosniff` added. `rendererEntryUrl` returns `process.env.ELECTRON_RENDERER_URL` only when `!app.isPackaged`, else `app://satellite/index.html`, so an environment variable can never point a packaged app at remote content.

- [ ] **Step 7: Hardening.** `hardenSession` denies every request through `setPermissionRequestHandler`, `setPermissionCheckHandler`, `setDevicePermissionHandler` and `setDisplayMediaRequestHandler`. `hardenWebContents` registers `app.on('web-contents-created')` and, for each contents, prevents `will-navigate`, `will-frame-navigate` and `will-attach-webview`, and sets `setWindowOpenHandler(() => ({ action: 'deny' }))`.

- [ ] **Step 8: Window and entry.** `createMainWindow` makes a 1440 by 900 window (minimum 960 by 600), title `Satellite`, `show: false` until `ready-to-show`, `backgroundColor` `#08080A` or `#FFFFFF` from `nativeTheme.shouldUseDarkColors`, and `webPreferences` `{ preload: join(import.meta.dirname, '../preload/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false }`. `main.ts` in order calls `app.setPath('userData', join(prepareSatelliteHome(), 'app-data'))`, `registerAppScheme()`, then on ready `hardenSession(session.defaultSession)`, `hardenWebContents()`, `handleAppProtocol(join(app.getAppPath(), 'out/renderer'))`, `createMainWindow(rendererEntryUrl())`, and quits on `window-all-closed` on every platform. Keep Electron's default application menu, because it carries the Edit roles that make Cmd+C and Cmd+V work on macOS.

- [ ] **Step 9: Interface.** `src/renderer/tsconfig.json` extends the base with `lib` `["ES2024", "DOM", "DOM.Iterable"]`, `types` `["vite/client"]`, `jsx` `react-jsx`, and includes `.` plus `../shared`. Extend `typecheck`. `app.css` imports the four Fontsource packages, then `tailwindcss`, sets `color-scheme: light dark`, defines every token from the `DESIGN.md` App tokens table as `--<token>` on `:root` with the light value and inside `@media (prefers-color-scheme: dark)` with the dark value, and maps them in `@theme inline` after `--color-*: initial;` so the default palette is gone and only tokens exist. Fonts map to `--font-sans` (`"Funnel Sans Variable"`), `--font-display` (`"Funnel Display Variable"`), `--font-mono` (`"Geist Mono Variable"`), `--font-pixel` (`"Geist Pixel"`). Body is Funnel Sans 13 on `bg` with `fg`. `entry.tsx` awaits `document.fonts.load` for the four families, so xterm and Monaco measure the right glyphs later, then renders `AppWindow`. `AppWindow` is a full-height grid of a 260px left column, a flexible centre and a 520px right column, separated by `line` hairlines, with `side` behind the left column.

- [ ] **Step 10: ARCHITECTURE.md.** Create it with sections Parts, Security boundary (every hardening item, the CSP and why styles are inline, the protocol and its confinement, why a packaged app ignores `ELECTRON_RENDERER_URL`, `userData` inside the Satellite home) and Folder layout. Later tasks extend it.

- [ ] **Step 11: Prove.** `npm run build` output, then `npm run dev` and show its log reaching the window with no renderer console errors. The screenshots for this window come from the driver in Task 4. `./scripts/check` green.

- [ ] **Step 12: Commit.** `feat(window): open a hardened window with three columns`.

---

### Task 3: The bridge and the platform module

One typed bridge, validated before any handler runs, and one platform module that finds and runs `git`, `gh` and `claude`. Proven by the left column showing each tool's version.

**Files:**
- Create: `src/shared/bridge-contract.ts`, `src/shared/satellite-api.ts`, `src/main/bridge/registry.ts`, `src/main/bridge/registry.test.ts`, `src/main/bridge/bridge-ipc.ts`, `src/main/platform/executable-search.ts`, `src/main/platform/executable-search.test.ts`, `src/main/platform/user-environment.ts`, `src/main/platform/user-environment.test.ts`, `src/main/platform/tools.ts`, `src/main/platform/tools.test.ts`, `src/main/tools/tool-versions.ts`, `src/renderer/bridge/bridge-client.ts`, `src/renderer/bridge/satellite-global.d.ts`, `src/renderer/proving/tool-readout.tsx`
- Modify: `src/preload/preload.ts`, `src/main/main.ts`, `src/renderer/window/app-window.tsx`, `ARCHITECTURE.md`

**Interfaces:**
- Consumes: `appOrigin`, `rendererEntryUrl` (Task 2).
- Produces:
  - In `src/shared/bridge-contract.ts`:
    - `bridgeLimits = { terminalWriteChars: 65536, terminals: 16, cols: { min: 2, max: 500 }, rows: { min: 1, max: 300 } }`
    - `bridgeRequests` with a `request` and a `response` zod schema per channel, all `z.strictObject`. `tools.versions` takes `{}` and answers `{ git, gh, claude }`, each `string | null` (max 200 characters). `terminal.start` takes `{ id: z.uuid(), program: z.literal('claude'), cols, rows }` with integer bounds from `bridgeLimits`. `terminal.write` takes `{ id, data }` with `data` 1 to 65536 characters. `terminal.resize` takes `{ id, cols, rows }`. `terminal.close` takes `{ id }`. The four terminal channels answer `{}`.
    - `bridgeEvents` with `terminal.data` as `{ id, data: string }` and `terminal.exit` as `{ id, exitCode: int }`
    - Types `BridgeChannel`, `BridgeRequest<C>`, `BridgeResponse<C>` (both `z.output` of the schemas), `BridgeEventName`, `BridgeEventPayload<E>`, `BridgeErrorCode = 'unknown-channel' | 'invalid-request' | 'refused-sender' | 'not-found' | 'tool-missing' | 'limit' | 'failed'`, `BridgeResult<T> = { ok: true; value: T } | { ok: false; error: { code: BridgeErrorCode; message: string } }`, and `bridgeResultSchema<T extends z.ZodType>(value: T)`
    - `bridgeIpc = { invoke: 'satellite:bridge', event: 'satellite:event' }`
  - `SatelliteApi = { invoke(channel: string, payload: unknown): Promise<unknown>; onEvent(listener: (event: string, payload: unknown) => void): () => void }` in `src/shared/satellite-api.ts`
  - In `src/main/bridge/registry.ts`, which never imports `electron` so it tests in plain Node:
    - `BridgeOwner = { readonly id: number; emit<E extends BridgeEventName>(event: E, payload: BridgeEventPayload<E>): void; onGone(listener: () => void): void }`
    - `BridgeHandler<C> = (request: BridgeRequest<C>, owner: BridgeOwner) => Promise<BridgeResponse<C>>` and `BridgeHandlers = { [C in BridgeChannel]: BridgeHandler<C> }`
    - `class BridgeFailure extends Error` with a `code: BridgeErrorCode` field, thrown by handlers for outcomes the user sees
    - `createBridgeRouter(handlers: BridgeHandlers): (channel: unknown, payload: unknown, owner: BridgeOwner) => Promise<BridgeResult<unknown>>`
  - `registerBridge(handlers: BridgeHandlers, allowedOrigin: string): void` in `src/main/bridge/bridge-ipc.ts`
  - In `src/main/platform/tools.ts`:
    - `Tool = 'git' | 'gh' | 'claude'`, `ResolvedCommand = { readonly file: string; readonly args: readonly string[] }`, `ToolRun = { readonly exitCode: number; readonly stdout: string; readonly stderr: string }`
    - `toolOverrideVariables = { gh: 'SATELLITE_GH', claude: 'SATELLITE_CLAUDE' }`
    - `parseToolOverride(variable: string, value: string | undefined): ResolvedCommand | undefined`
    - `resolveTool(tool: Tool): Promise<ResolvedCommand | undefined>`
    - `runTool(tool: Tool, args: readonly string[], options?: { cwd?: string; timeoutMs?: number }): Promise<ToolRun | undefined>`, which answers `undefined` when the tool is missing
    - `childEnvironment(): Promise<Record<string, string>>`
  - `executableCandidates(name: string, platform: NodeJS.Platform, env: Record<string, string | undefined>): string[]` and `findExecutable(name: string, env: Record<string, string | undefined>): Promise<string | undefined>` in `src/main/platform/executable-search.ts`
  - `parseEnvironmentBlock(output: string): Record<string, string> | undefined` and `userEnvironment(): Promise<Record<string, string>>` in `src/main/platform/user-environment.ts`
  - `toolVersions(): Promise<BridgeResponse<'tools.versions'>>` in `src/main/tools/tool-versions.ts`
  - In `src/renderer/bridge/bridge-client.ts`:
    - `invoke<C extends BridgeChannel>(channel: C, request: BridgeRequest<C>): Promise<BridgeResult<BridgeResponse<C>>>`
    - `subscribe<E extends BridgeEventName>(event: E, listener: (payload: BridgeEventPayload<E>) => void): () => void`

- [ ] **Step 1: The registry test.** `src/main/bridge/registry.test.ts` builds a router whose handlers are `vi.fn` spies and a fake owner. Tests named `refuses a request with a wrong shape before any handler runs` (`terminal.resize` with `cols: 'wide'`, with `rows` missing, with an extra key `shell: 'sh'`, each answering `ok: false` with code `invalid-request` while the spy is never called), `refuses unknown channels including prototype keys` (`nope`, `__proto__`, `constructor`, `toString`, code `unknown-channel`), `refuses a channel that is not a string` (`42`, `null`), `refuses terminal data over the size limit` (65537 characters), `refuses a terminal id that is not a uuid`, `passes a valid request to its handler and returns its value`, and `turns a BridgeFailure into its code and message and any other error into failed without its stack`. See them fail.

- [ ] **Step 2: Contract and router.** Write `bridge-contract.ts`, then `createBridgeRouter`, which builds a `Map` from channel to a per-channel route. Each route is created by a generic `bridgeRoute<C>(channel, handler)` that parses the payload with `bridgeRequests[channel].request.safeParse` and only then calls the handler. That keeps the types correlated without a cast. If the checker still cannot correlate, restructure, never cast. Unexpected errors are logged in main with their stack and answered as `failed` with `Something went wrong in Satellite. Try again.`. Run the test, it passes.

- [ ] **Step 3: IPC.** `registerBridge` handles `bridgeIpc.invoke` with `ipcMain.handle`. It refuses with `refused-sender` unless `event.senderFrame` is the sender's main frame and `new URL(frame.url).origin` equals `allowedOrigin`, which is `appOrigin` or, in development, the origin of `ELECTRON_RENDERER_URL`. It adapts each `WebContents` to one cached `BridgeOwner` whose `emit` sends `bridgeIpc.event` with `(event, payload)`, and whose `onGone` fires on `destroyed`, on `render-process-gone`, and on `did-start-navigation` for the main frame when the navigation is not same-document. That last case is a reload.

- [ ] **Step 4: Preload.** `preload.ts` calls `contextBridge.exposeInMainWorld('satellite', api)` with an `api: SatelliteApi` whose `invoke` forwards to `ipcRenderer.invoke(bridgeIpc.invoke, channel, payload)` and whose `onEvent` adds an `ipcRenderer.on(bridgeIpc.event, …)` listener and returns its remover. It exposes nothing else and imports only `electron` and the contract's constant.

- [ ] **Step 5: Platform tests.** The `executable-search.test.ts` tests are named `finds only exe and com files on Windows`, `reads the Windows Path key whatever its case`, `splits Windows paths on semicolons and posix paths on colons`, and `skips empty and relative path entries` (a relative entry would search the current folder). The `user-environment.test.ts` tests are named `reads the block between markers when the shell prints noise around it`, `keeps values that contain newlines and equals signs`, `returns undefined when a marker is missing`, and `drops PWD, OLDPWD, SHLVL and _`. The `tools.test.ts` tests are named `reads a JSON array override as executable and leading arguments`, `refuses an override that is not a non-empty array of strings and names the variable`, and `ignores an unset override`. Use made-up folders like `/opt/tools/bin`, never a home folder. See them fail.

- [ ] **Step 6: Platform.** Write `executable-search.ts`. On `win32` it reads the env key matching `path` case-insensitively and tries `<dir>\<name>.exe` then `<dir>\<name>.com` only. Batch files are never run, because running them needs a shell that re-parses arguments. Write `user-environment.ts`. On macOS and Linux it runs once, cached, `execFile(shell, ['-i', '-l', '-c', 'printf __SATELLITE_ENV__; command env -0; printf __SATELLITE_ENV__'])` with stdin ignored, a 5 second timeout and a 1 MiB buffer, where `shell` is `process.env.SHELL`, then `os.userInfo().shell`, then `/bin/sh`. It merges the parsed block over `process.env` and falls back to `process.env` on any failure. On Windows it returns `process.env`. Write `tools.ts`. `resolveTool` uses the override variable from `process.env` when set, else `findExecutable` against `userEnvironment()`. `runTool` uses `execFile` with an argument array, `shell: false`, `windowsHide: true`, `childEnvironment()`, a 30 second default timeout and a 16 MiB `maxBuffer`. `childEnvironment()` is `userEnvironment()` without any key starting with `ELECTRON_`. Run the tests, they pass.

- [ ] **Step 7: Versions.** `toolVersions` runs `--version` on the three tools at once and keeps the first stdout line, trimmed to 200 characters, or `null` when the tool is missing or exits non-zero. Wire `registerBridge` in `main.ts` with handlers for `tools.versions` and, for now, terminal handlers that throw `BridgeFailure('not-found', …)`. Task 5 replaces them.

- [ ] **Step 8: Renderer.** `satellite-global.d.ts` declares `window.satellite: SatelliteApi`. `bridge-client.ts` parses every answer with `bridgeResultSchema(bridgeRequests[channel].response)` and every event payload with its schema, so the renderer trusts nothing unchecked and needs no cast. An answer that does not parse becomes `failed` with `Satellite got an answer it could not read.`. `tool-readout.tsx` sits in the left column and shows three Geist Pixel readouts in capitals, test ids `tool-git`, `tool-gh`, `tool-claude`, such as `GIT 2.50.1` or `GH NOT FOUND`.

- [ ] **Step 9: ARCHITECTURE.md.** Add a Bridge section with one row per channel and event, giving what it does, its limits and why it is safe. Add a Platform section covering the overrides, the login-shell environment, and `.exe` only on Windows.

- [ ] **Step 10: Prove.** `npm run dev` shows real versions in the left column. `SATELLITE_GH='["/bin/echo","gh version stand-in"]' npm run dev` shows the override. `./scripts/check` green.

- [ ] **Step 11: Commit.** `feat(bridge): validate every message before a handler runs`, then `feat(platform): find and run git, gh and claude`.

---

### Task 4: The verify harness

One driver command launches the app in a scenario with a temporary home and returns the window as structured data plus screenshots.

**Files:**
- Create: `verify/tsconfig.json`, `verify/scenario.ts`, `verify/repo-recipe.ts`, `verify/driver.ts`, `verify/cli.ts`, `verify/stand-ins/stand-in-log.ts`, `verify/stand-ins/claude.ts`, `verify/stand-ins/gh.ts`, `verify/scenarios/default/scenario.json`, `.claude/skills/satellite-verify/SKILL.md`
- Modify: `package.json` (`typecheck` gains `verify/tsconfig.json`), `AGENTS.md` (Skills row for `satellite-verify`)

**Interfaces:**
- Consumes: `resolveInside` (Task 2), the test ids (Tasks 2 and 3).
- Produces:
  - `scenarioSchema`, a zod strict object `{ description: string, repo: RepoStep[], gh: GhAnswer[], claude: { version: string, script: ClaudeStep[] } }`, where `RepoStep = { write: { path: string, content: string } } | { git: string[] }`, `GhAnswer = { args: string[], stdout?: string, stderr?: string, exitCode?: int }` and `ClaudeStep = { print: string } | { wait: int }`. Also `Scenario`, and `loadScenario(name: string): Promise<{ dir: string; file: string; scenario: Scenario }>`, which accepts only kebab-case names under `verify/scenarios/`. Spec 004 adds a hook step to `ClaudeStep`.
  - `buildRepo(target: string, steps: RepoStep[], gitEnv: Record<string, string>): Promise<void>` in `verify/repo-recipe.ts`
  - `StandInEvent = { type: 'start'; tool: 'claude' | 'gh'; pid: number; args: string[] } | { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number }`, plus `appendStandInEvent(event: StandInEvent): void` and `readStandInEvents(file: string): Promise<StandInEvent[]>` in `verify/stand-ins/stand-in-log.ts`
  - In `verify/driver.ts`:
    - `AppTarget = { kind: 'built' } | { kind: 'dev' } | { kind: 'packaged'; executable: string }`
    - `LaunchOptions = { scenario: string; target: AppTarget; realClaude?: boolean }`
    - `AppSession = { page: Page; home: string; repo: string; standInEvents(): Promise<StandInEvent[]>; consoleErrors: string[]; screenshot(name: string): Promise<string>; close(): Promise<void> }`
    - `buildApp(): Promise<void>`, `launchApp(options: LaunchOptions): Promise<AppSession>`, `outputDir: string`
  - CLI `npm run verify -- <scenario> [--dev | --app <executable>] [--real-claude] [--keep] [step ...]` with steps `tree`, `text=<testid>`, `click=<testid>`, `type=<text>`, `press=<key>`, `paste=<text>` (or `paste-size=<n>` for n generated characters), `resize=<width>x<height>`, `theme=light|dark`, `wait=<ms>`, `wait-for=<testid>`, `shot=<name>`, `log`. With no steps it runs `wait-for=app-window tree shot=window`.

- [ ] **Step 1: Scenario and stand-ins.** `verify/tsconfig.json` extends the base with `lib` `["ES2024", "DOM"]` (Playwright callbacks run in the page), `types` `["node"]`, and includes `.` and `../src/main/platform`. The `default` scenario's repo recipe writes `README.md`, runs `git init -b main`, `git add .` and `git commit -m "first commit"`. It answers `gh --version` with `gh version 2.99.0 (stand-in)`, and its claude has version `2.0.0 (Claude Code stand-in)` and the script `[{ "print": "Claude Code stand-in\r\n" }, { "print": "> " }]`. `claude.ts` reads `SATELLITE_VERIFY_SCENARIO`. With `--version` it prints the version and exits 0. Otherwise it logs `start`, plays the script, then puts stdin in raw mode, logs every chunk as `input`, echoes it (ESC CR echoes as a new line), logs `resize` on `process.stdout` `resize`, and exits on Ctrl+C or Ctrl+D. `gh.ts` logs `start` and answers the first `gh` entry whose `args` equal its own. Unknown args print `stand-in gh has no answer for <args>` to stderr and exit 1. Both append JSON lines to `SATELLITE_VERIFY_LOG`.

- [ ] **Step 2: Driver.** `launchApp` makes `mkdtemp(join(tmpdir(), 'satellite-verify-'))` holding `home/`, `repo/` and `stand-ins.jsonl`, builds the repo with `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<temp>/gitconfig` (name `Satellite Verify`, email `verify@satellite.invalid`) and `GIT_TERMINAL_PROMPT=0`, then spawns the target with `--remote-debugging-port=0` and an env of `process.env` plus `SATELLITE_HOME`, `SATELLITE_VERIFY_SCENARIO`, `SATELLITE_VERIFY_LOG`, and `SATELLITE_CLAUDE` and `SATELLITE_GH` set to `JSON.stringify([process.execPath, <absolute stand-in path>])`, which is the real Node that runs the driver. It leaves out `SATELLITE_CLAUDE` when `realClaude` is set, and removes `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS`. `built` runs the `electron` package's binary with the repo root, `dev` runs `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=0`, and `packaged` runs the executable. The driver waits up to 60 seconds for `DevTools listening on (ws://\S+)` on stderr, calls `chromium.connectOverCDP`, picks the page whose URL starts with the app origin, and waits for `app-window`. It records console errors and `pageerror` events. `close()` calls `window.close()` in the page, waits up to 10 seconds for the process to exit, then kills the tree (`taskkill /pid <pid> /T /F` on Windows, `SIGKILL` elsewhere), and deletes the temp folder unless `--keep` is set. `screenshot` writes `verify-output/<scenario>-<timestamp>/<name>.png`.

- [ ] **Step 3: CLI.** `cli.ts` parses the arguments, runs `buildApp()` (which is `electron-vite build`) for the `built` target only, launches, and runs the steps in order. `tree` returns `page.locator('body').ariaSnapshot()` plus, for each `[data-testid]`, `{ testId, visible, text }` with text cut at 2000 characters. `theme` uses `page.emulateMedia({ colorScheme })`. `resize` uses `page.setViewportSize`. `paste` dispatches a `ClipboardEvent('paste')` carrying a `DataTransfer` on the focused element, because the system clipboard needs a permission the app denies. `log` returns the stand-in events. It prints one JSON object `{ scenario, home, repo, steps: [{ step, ok, value?, error? }], consoleErrors, screenshots }` and exits 1 if any step failed.

- [ ] **Step 4: Skill.** Write `.claude/skills/satellite-verify/SKILL.md` with frontmatter `name: satellite-verify` and `description: "Use when proving a change in the real Satellite window, writing a scenario or a stand-in step, or adding a journey."`. It covers the command and every step, the three targets, scenario fields, stand-ins and their log, the temporary home, `verify-output/`, a feature map table (feature, scenario, journey) with the rows that exist, and the rule that `--real-claude` runs the user's own Claude Code, which updates its own state, so it needs the user's go-ahead every time. Add its row to the Skills table in `AGENTS.md`.

- [ ] **Step 5: Prove (acceptance 1 and 8).** Show the JSON output of `npm run verify -- default`. Then run `npm run verify -- default --dev theme=light shot=dev-light theme=dark shot=dev-dark tree` and attach both screenshots of the three columns. `./scripts/check` green.

- [ ] **Step 6: Commit.** `feat(verify): drive the real app in a scenario`.

---

### Task 5: The terminal component with the real Claude Code

The right column starts `claude` in a terminal Satellite owns, with typing, Shift+Enter, paste and resize working.

**Files:**
- Create: `src/main/platform/pty.ts`, `src/main/terminal/terminal-sessions.ts`, `src/renderer/terminal/terminal-view.tsx`, `src/renderer/terminal/terminal-theme.ts`, `src/renderer/proving/claude-pane.tsx`
- Modify: `src/main/main.ts`, `src/renderer/window/app-window.tsx`, `ARCHITECTURE.md`

**Interfaces:**
- Consumes: `resolveTool`, `childEnvironment`, `userHomeFolder`, `BridgeHandlers`, `BridgeFailure`, `BridgeOwner`, `bridgeLimits`, `invoke`, `subscribe`, `Button`.
- Produces:
  - In `src/main/platform/pty.ts`, the only file that imports `node-pty`:
    - `PtyProcess = { readonly pid: number; write(data: string): void; resize(cols: number, rows: number): void; kill(): void; onData(listener: (data: string) => void): void; onExit(listener: (exitCode: number) => void): void }`
    - `spawnPty(command: ResolvedCommand, options: { cwd: string; cols: number; rows: number; env: Record<string, string> }): PtyProcess`, with name `xterm-256color` and env plus `TERM=xterm-256color` and `COLORTERM=truecolor`
  - `createTerminalSessions(): { handlers: Pick<BridgeHandlers, 'terminal.start' | 'terminal.write' | 'terminal.resize' | 'terminal.close'>; closeAll(): void }` in `src/main/terminal/terminal-sessions.ts`
  - `TerminalView({ terminalId }: { terminalId: string })` in `src/renderer/terminal/terminal-view.tsx`, with test id `terminal`, reused by spec 004
  - `terminalTheme(): ITheme` in `src/renderer/terminal/terminal-theme.ts`, read from the CSS tokens

- [ ] **Step 1: Sessions.** `terminal.start` refuses a duplicate id (`invalid-request`), more than `bridgeLimits.terminals` live terminals (`limit`, `Satellite already runs 16 terminals. Close one first.`), and a missing `claude` (`tool-missing`, `Satellite can't find Claude Code. Install it, then start it again.`). Otherwise it spawns the resolved command in `userHomeFolder()` with `childEnvironment()`, forwards data and exit to the owner as `terminal.data` and `terminal.exit`, and kills the owner's terminals on `owner.onGone`. Write, resize and close answer `not-found` for an id the same owner does not hold. `closeAll` runs on `before-quit`. Main imports node-pty through `pty.ts` with a named import, and node-pty stays external because it is in `dependencies`.

- [ ] **Step 2: View.** On mount `TerminalView` creates `new Terminal({ fontFamily: '"Geist Mono Variable", monospace', fontSize: 13, scrollback: 5000, allowProposedApi: true, cursorBlink: true, theme: terminalTheme() })`, loads `FitAddon` and `Unicode11Addon` (`unicode.activeVersion = '11'`), opens and fits, subscribes to `terminal.data` and `terminal.exit` for its id, and only then invokes `terminal.start`. The renderer picks the id, so no early output is lost. Keep the default DOM renderer. User input goes through `onData`, split into `bridgeLimits.terminalWriteChars` chunks and sent through one promise queue per terminal, so order holds. `attachCustomKeyEventHandler` sends `\x1b\r` on keydown of Shift+Enter with no other modifier and returns `false` for both its keydown and keypress. A `ResizeObserver` fits on the next animation frame and invokes `terminal.resize` only when columns or rows changed. A `(prefers-color-scheme: dark)` listener resets `options.theme`. A start error or the exit event shows one sentence in the pane (the error's message, or `Claude Code ended.`). Unmount disposes xterm and invokes `terminal.close`.

- [ ] **Step 3: Pane.** `claude-pane.tsx` fills the right column with `Button` `Start Claude Code` (test id `start-claude`). Pressing it mounts a `TerminalView` with `crypto.randomUUID()`.

- [ ] **Step 4: ARCHITECTURE.md.** Record terminal ownership and cleanup, the limits, the DOM renderer, `unicode11` and the Shift+Enter sequence, and the spawn-helper fix, each with what was rejected.

- [ ] **Step 5: Prove with the stand-in.** `npm run verify -- default click=start-claude wait-for=terminal text=terminal type=hello press=Shift+Enter type=world paste-size=100000 resize=1100x760 wait=500 log shot=terminal`. The `log` shows `hello`, `\x1b\r`, `world`, input totalling 100000 pasted characters, and a `resize` with the new columns. Also show the spawn failing with `posix_spawnp failed` once on macOS with the helper mode reset to 644 (`chmod 644` on the arm64 helper), then passing after `npm rebuild node-pty`.

- [ ] **Step 6: Prove with the real Claude Code (acceptance 2).** This touches the user's own Claude Code state, so the controller asks the user first and runs it only with their go-ahead. On macOS run `npm run verify -- default --real-claude click=start-claude wait=5000 shot=claude-prompt type=hello press=Shift+Enter type=world shot=claude-shift-enter paste=pasted-text shot=claude-paste resize=1000x700 wait=800 shot=claude-resize`. It never presses Enter on a prompt, so nothing is sent to the model. If Claude Code asks whether to trust the folder, stop and ask the user. Attach the four screenshots.

- [ ] **Step 7: Commit.** `feat(terminal): run Claude Code in a terminal Satellite owns`.

---

### Task 6: The read-only diff component

The centre column shows a read-only side-by-side diff of two texts, with Monaco and its worker bundled locally.

**Files:**
- Create: `src/renderer/diff/monaco-environment.ts`, `src/renderer/diff/diff-view.tsx`, `src/renderer/proving/sample-diff.tsx`
- Modify: `src/renderer/window/app-window.tsx`, `ARCHITECTURE.md`

**Interfaces:**
- Produces:
  - `DiffView({ original, modified, language }: { original: string; modified: string; language?: string })` in `src/renderer/diff/diff-view.tsx`, test id `diff`, reused by spec 006
  - `applyMonacoTheme(): void` in `src/renderer/diff/monaco-environment.ts`, which also sets `self.MonacoEnvironment = { getWorker: () => new EditorWorker() }` once, with `EditorWorker` from `monaco-editor/editor/editor.worker?worker`

- [ ] **Step 1: Environment.** Import the API from `monaco-editor/editor/editor.api` (no languages, which spec 006 adds). `applyMonacoTheme` defines and sets theme `satellite`, reading the current CSS tokens for `editor.background` (`bg`), `editor.foreground` (`fg`), `editorLineNumber.foreground` (`dim`), `editorGutter.background` (`bg`), `diffEditor.insertedLineBackground` (`add`), `diffEditor.removedLineBackground` (`del`) and the inserted and removed text backgrounds (`addfg` and `delfg` at low alpha). It runs again on each colour-scheme change.

- [ ] **Step 2: View.** `createDiffEditor` with `readOnly: true`, `originalEditable: false`, `domReadOnly: true`, `renderSideBySide: true`, `automaticLayout: true`, `minimap: { enabled: false }`, `scrollBeyondLastLine: false`, `renderOverviewRuler: false`, `fontFamily: '"Geist Mono Variable", monospace'`, `fontSize: 13`. Models are created from the props with `language ?? 'plaintext'`, updated when the props change, and disposed with the editor on unmount.

- [ ] **Step 3: Sample.** `sample-diff.tsx` fills the centre column with a `DiffView` of two short fixed texts, about 12 lines with one changed, one added and one removed line.

- [ ] **Step 4: Prove (acceptance 3).** `npm run verify -- default wait-for=diff theme=light shot=diff-light theme=dark shot=diff-dark tree` shows both sides, and `consoleErrors` is empty, so the worker loaded under the CSP and no worker fallback warning appeared. Attach the screenshots.

- [ ] **Step 5: Commit.** `feat(diff): show a read-only side by side diff`.

---

### Task 7: The journeys

A few fixed scripts over the driver that prove the first run and the security boundary, against the built app now and the packaged app at release.

**Files:**
- Create: `verify/journeys.ts`, `verify/journeys/launch.ts`, `verify/journeys/boundary.ts`
- Modify: `.claude/skills/satellite-verify/SKILL.md` (journeys and the feature map)

**Interfaces:**
- Consumes: `launchApp`, `buildApp`, `AppSession`, `AppTarget` (Task 4).
- Produces: `Journey = { name: string; scenario: string; run(session: AppSession): Promise<void> }`, with `launchJourney` and `boundaryJourney` exported from their files. Also `npm run journeys -- [--app <executable>]`, which builds once for the built target, runs every journey in order with `node:assert/strict`, saves one screenshot per journey, prints `pass <name>` or `fail <name> <reason>`, and exits 1 on any failure.

- [ ] **Step 1: Launch journey.** It asserts the three columns are visible, `tool-git` names a version, and `tool-gh` contains `stand-in`. It clicks `start-claude` and waits for `Claude Code stand-in` in `terminal`. It types `hello`, presses Shift+Enter and pastes 100000 generated characters, then checks the stand-in log received all of it in order. It resizes and checks a `resize` event. It checks `diff` contains `.monaco-diff-editor` with an original and a modified side. It reloads the page and checks the first stand-in's pid stops existing within 5 seconds (`process.kill(pid, 0)` throws). It starts Claude Code again, closes the session, checks the app process exited and that stand-in's pid is gone. Throughout, `consoleErrors` stays empty.

- [ ] **Step 2: Boundary journey (acceptance 5).** From `page.evaluate` it asserts that `typeof require`, `typeof process`, `typeof module` and `typeof Buffer` are `'undefined'` and that `Object.keys(window.satellite)` is exactly `['invoke', 'onEvent']`. `window.open('https://example.com')` must return `null`, and no new page appears in the CDP browser within 1 second. After `location.assign('https://example.com')` and after `location.assign('file:///')`, `location.href` must still be the app URL after 1 second. `fetch('https://example.com')` must reject, which is the CSP, so no network is needed. `fetch('app://satellite/%2e%2e/%2e%2e/package.json')` must answer 404. `navigator.mediaDevices.getUserMedia({ audio: true })` must reject, and `Notification.requestPermission()` must resolve `'denied'`. `window.satellite.invoke('terminal.resize', { id: 'x' })` must resolve `ok: false` with code `invalid-request`, and `window.satellite.invoke('__proto__', {})` with `unknown-channel`.

- [ ] **Step 3: Prove.** Show `npm run journeys` printing `pass launch` and `pass boundary`. Temporarily turn one guard off (allow `will-navigate`), show `fail boundary`, then restore it. `./scripts/check` green.

- [ ] **Step 4: Commit.** `test(verify): prove the first run and the security boundary`.

---

### Task 8: Packaging and the release workflow

Unsigned packages for three platforms with fuses and checksums, proven by the journeys against each packaged app.

**Files:**
- Create: `electron-builder.yml`, `packaging/icon.png` (copy of `.superpowers/brand-exports/app-icon-macos-1024.png`), `scripts/checksums.ts`, `.github/workflows/release.yml`
- Modify: `ARCHITECTURE.md` (Packaging and fuses), `.claude/skills/satellite-verify/SKILL.md` (packaged target)

**Interfaces:**
- Consumes: `npm run journeys -- --app <executable>` (Task 7).
- Produces: `node scripts/checksums.ts <folder> <label>`, which writes `<folder>/SHA256SUMS-<label>.txt` in `sha256sum` format for every `.dmg`, `.zip`, `.exe`, `.AppImage` and `.deb` directly in the folder.

- [ ] **Step 1: Builder config.**

```yaml
appId: app.satellite.desktop
productName: Satellite
artifactName: ${productName}-${version}-${os}-${arch}.${ext}
directories:
  output: release
  buildResources: packaging
files:
  - out/**
  - package.json
asar: true
asarUnpack:
  - node_modules/node-pty/**
npmRebuild: false
publish: null
electronFuses:
  runAsNode: false
  enableCookieEncryption: true
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
  enableEmbeddedAsarIntegrityValidation: true
  onlyLoadAppFromAsar: true
  grantFileProtocolExtraPrivileges: false
mac:
  target: [dmg, zip]
  category: public.app-category.developer-tools
  identity: "-"
  hardenedRuntime: false
win:
  target: nsis
linux:
  target: [AppImage, deb]
  category: Development
  executableName: satellite
  maintainer: Satellite
```

`npmRebuild: false` because node-pty is N-API and already built for each target, and a rebuild would try to compile x64 from an arm64 host. `identity: "-"` ad-hoc signs after the fuses flip, without which an arm64 Mac refuses to launch the modified binary.

- [ ] **Step 2: Package locally.** On macOS run `npm run build && npx electron-builder --mac --arm64 --x64 --publish never`. Show `npx @electron/fuses read --app release/mac-arm64/Satellite.app` with RunAsNode, NodeOptions and NodeCliInspect disabled and integrity and OnlyLoadAppFromAsar enabled. Show that `release/mac-arm64/Satellite.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` is executable. Then show `npm run journeys -- --app release/mac-arm64/Satellite.app/Contents/MacOS/Satellite` passing both journeys against the packaged app.

- [ ] **Step 3: Release workflow.** Write `.github/workflows/release.yml` with the file tools.

```yaml
name: Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-26
            label: macos
            package: --mac --arm64 --x64
            app: release/mac-arm64/Satellite.app/Contents/MacOS/Satellite
          - os: windows-2025
            label: windows
            package: --win --x64
            app: release/win-unpacked/Satellite.exe
          - os: ubuntu-24.04
            label: linux
            package: --linux --x64
            app: release/linux-unpacked/satellite
    runs-on: ${{ matrix.os }}
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npx electron-builder ${{ matrix.package }} --publish never
      - run: npx @electron/fuses read --app "${{ matrix.app }}"
      - if: runner.os == 'Linux'
        run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
      - if: runner.os == 'Linux'
        run: xvfb-run -a npm run journeys -- --app "${{ matrix.app }}"
      - if: runner.os != 'Linux'
        run: npm run journeys -- --app "${{ matrix.app }}"
      - run: node scripts/checksums.ts release ${{ matrix.label }}
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: satellite-${{ matrix.label }}
          if-no-files-found: error
          path: |
            release/*.dmg
            release/*.zip
            release/*.exe
            release/*.AppImage
            release/*.deb
            release/SHA256SUMS-*.txt

  publish:
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          path: dist
          merge-multiple: true
      - run: cat dist/SHA256SUMS-*.txt > dist/SHA256SUMS.txt && rm dist/SHA256SUMS-*.txt
      - run: gh release create "$GITHUB_REF_NAME" dist/* --draft --verify-tag --title "Satellite $GITHUB_REF_NAME" --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
```

The sysctl lets Chromium's own sandbox run on Ubuntu 24.04 instead of falling back to `--no-sandbox`. `publish` runs only for a tag and only after all three builds pass, and `workflow_dispatch` never reaches it. The journeys run against the `*-unpacked` and `.app` folders, which are the exact contents the installers wrap with fuses applied. If `xvfb-run` is missing on the runner, add `sudo apt-get install -y xvfb` before it.

- [ ] **Step 4: Prove (acceptance 7).** Show `release/` and the checksum file from Step 2. The run link needs the workflow on `main`, because `workflow_dispatch` only fires for workflows on the default branch. After the merge, the controller runs `gh workflow run release.yml --ref main` and records the run link. A pre-merge run needs a tag pushed from this branch, which also exercises `publish` and creates a draft release, so it happens only if the maintainer asks for it.

- [ ] **Step 5: Commit.** `feat(release): package unsigned builds with fuses and checksums`, then `ci(release): build, prove and draft a release on three platforms`.

---

### Task 9: Docs, status Done and the plan removed

Every doc matches the code, the spec is Done, and `plan.md` is gone.

**Files:**
- Create: `.claude/skills/satellite-stack/SKILL.md`
- Modify: `ARCHITECTURE.md`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `SATELLITE.md`, `DESIGN.md`, `specs/001-foundation/spec.md`, `specs/README.md`
- Delete: `specs/001-foundation/plan.md`

- [ ] **Step 1: ARCHITECTURE.md complete.** It has Parts, Bridge (channel table), Security boundary, Platform, Packaging and fuses, Folder layout, and a Decisions table (chosen, rejected, why). The decisions are electron-vite over plain Vite and over the Forge Vite plugin, electron-builder over Forge (first-party AppImage and nsis), node-pty 1.1 stable with the helper fix over the 1.2 beta and forks, DOM renderer over WebGL, `unicode11` over the experimental graphemes addon, the CDP driver over `_electron.launch` (fuse conflict), the `app://` protocol over `file://`, TypeScript 6 over 7 (typed lint), renderer-chosen terminal ids over a main-side backlog, `.exe` only on Windows over running batch files, no state library, and web links in the terminal left to spec 004 with its open-link check.

- [ ] **Step 2: Stack skill.** `.claude/skills/satellite-stack/SKILL.md` with `name: satellite-stack` and `description: "Use when adding or changing code in any part of Satellite, to know where it goes, how the processes talk, how to run, build and package it, and which dependency rules apply."`. It covers the folder map, one feature folder per side, the platform-module rule, how to add a bridge channel (schema, handler, client, an `ARCHITECTURE.md` row, a registry test case), the `dependencies` versus `devDependencies` rule, the import-extension rule, every script, and native-module notes.

- [ ] **Step 3: AGENTS.md.** Delete the "No stack yet" note. Map rows for `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, `verify/`, `lint/`, `packaging/`, plus `scripts/` widened to the checkpoint and its helpers. Skills rows for `satellite-stack` and `satellite-verify`. Commands `npm ci`, `npm run dev`, `npm run verify -- <scenario> [step ...]`, `npm run journeys`, `npm run package`, `./scripts/check`, `./guards/test.sh`.

- [ ] **Step 4: README, CONTRIBUTING, DESIGN, SATELLITE.** The README Status section no longer says nothing is built, and it gains Install (download from the draft release, compare `SHA256SUMS.txt`, and on macOS clear the quarantine of an unsigned app with `xattr -dr com.apple.quarantine /Applications/Satellite.app`) and Run from source (`npm ci`, `npm run dev`). CONTRIBUTING setup adds `npm ci`. In `DESIGN.md`, "All four come from Google Fonts" becomes a sentence saying all four are bundled with the app and never loaded remotely. `SATELLITE.md` changes only where it is now wrong. Check and say so.

- [ ] **Step 5: Status Done.** In the spec and the index set **Done**, and tick each acceptance item that has its proof. Acceptance 6 (CI) and 7 (run link) are confirmed by the controller on the pull request and after the merge, and the pull request says which are pending.

- [ ] **Step 6: Remove the plan.** `git rm specs/001-foundation/plan.md`.

- [ ] **Step 7: Prove.** `./scripts/check` green, `npm run journeys` green, and `git grep -n "No stack yet"` returns nothing.

- [ ] **Step 8: Commit.** `docs: describe the foundation and mark spec 001 done`.

## Acceptance map

| Acceptance item | Task | Proof |
| --- | --- | --- |
| `npm run dev` opens three columns in light and dark | 2, 4 | driver `--dev` screenshots light and dark |
| Real `claude` starts and takes typing, Shift+Enter, paste and resize | 5 | stand-in log, then `--real-claude` screenshots on macOS with the user's go-ahead |
| Read-only side-by-side diff | 6 | driver screenshots |
| Wrong-shape bridge message refused before any handler | 3 | `registry.test.ts` |
| Interface cannot navigate, open a window or reach Node | 7 | `boundary` journey |
| `./scripts/check` green locally and in CI | 1, every task | local output, CI on the pull request |
| Release workflow builds three platforms and passes the first journey | 8 | local packaged journeys, run link after the merge |
| Driver launches a scenario, returns structured data, saves a screenshot | 4 | CLI JSON output |
