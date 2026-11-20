# Architecture

How Satellite is put together and where its security boundary runs. `SATELLITE.md` owns what the product does and `DESIGN.md` owns how it looks.

## Parts

| Part | Folder | What it does |
| --- | --- | --- |
| Background process | `src/main/` | Electron's main process. Full access to the machine. Owns the window, the `app://` protocol, the hardening, the bridge handlers and the platform module. |
| Preload | `src/preload/` | Runs in the sandboxed preload and exposes `window.satellite`, the only door between the interface and the background process. |
| Interface | `src/renderer/` | React and Tailwind in a sandboxed renderer with no Node. It draws the three columns and nothing else touches the machine. |
| Shared | `src/shared/` | Code both sides import, such as the bridge contract and the content security policy. |

electron-vite builds all three into `out/`. Electron starts `out/main/main.js`.

## Security boundary

The interface is treated as untrusted. Whatever it shows can never run a command or read a file.

- **Renderer settings.** `sandbox`, `contextIsolation` and `webSecurity` are on, `nodeIntegration` and `spellcheck` are off. The preload is CommonJS with its dependencies bundled, because a sandboxed preload cannot load ESM or `node_modules`.
- **Permissions.** Every permission request, permission check, device request and display media request on the default session is denied.
- **Navigation.** Every web contents refuses `will-navigate`, `will-frame-navigate` and `will-attach-webview`, and its window open handler denies every new window. The one exception is a main frame reload of the window's own entry, allowed only when the target's protocol, host and path equal the entry URL, so hot reload in development and a reload in production work while every other address stays refused.
- **Content security policy.** `default-src 'none'`, with scripts, styles, images, fonts, connections and workers only from the app itself, images and fonts also from `data:`, and `base-uri`, `form-action`, `frame-ancestors` and `object-src` all `'none'`. Styles allow `'unsafe-inline'` because the terminal and the diff editor insert style elements at run time. In development only, scripts allow `'unsafe-inline'` for the React refresh preamble and connections allow `ws://localhost:*` for hot reload. `src/shared/content-security-policy.ts` builds both, so the dev server and the protocol never drift.
- **The `app://` protocol.** The interface loads from `app://satellite/index.html`, a standard and secure scheme, never from `file://`. The handler answers only `GET` for host `satellite`, decodes the path and confines it to `out/renderer` with `resolveInside`, which follows symlinks before it checks. It serves regular files only, so a folder is never handed to the file loader. Anything refused gets a 404. Every response, the 404 included, carries the production policy and `X-Content-Type-Options: nosniff`.
- **Development server.** `ELECTRON_RENDERER_URL` points the window at the dev server only when the app is not packaged, so an environment variable can never aim a packaged app at remote content.
- **Satellite home.** All state lives in the Satellite home, `~/.satellite` or the path in `SATELLITE_HOME`, which must be fully qualified, with a drive letter or a share on Windows. It is created before the app is ready and set to mode `0700` on every start on macOS and Linux, so an older, looser folder is tightened. Electron's `userData` is `app-data` inside it, so caches and storage never land anywhere else.
- **Menu.** A minimal menu built from roles only, with no links. The app menu on macOS (about, hide, quit), Edit (undo, redo, cut, copy, paste, select all) and Window (minimize, close). View with reload and developer tools exists only when the app is not packaged. The Edit roles are what make copy and paste work on macOS.
- **Failed start.** If the window cannot be created or its entry cannot load, the background process logs one sentence and exits with code 1, so no process lingers without a window.

## Bridge

The preload exposes two functions on `window.satellite` and nothing else. `invoke(channel, payload)` sends one request over the IPC channel `satellite:bridge` and `onEvent(listener)` receives pushes from `satellite:event`. `src/shared/bridge-contract.ts` holds a zod schema for every request, answer and event.

- **Sender check.** The background process answers only its own window's main frame, and only while that frame shows the app origin, `app://satellite` or the dev server in development, with no user info in the URL. Anything else, including a frame that is already gone, gets `refused-sender`.
- **Validation first.** Channels are looked up in a `Map`, so names like `__proto__` or `constructor` find nothing. Every payload is parsed with its strict schema before the handler runs, so a wrong type, a missing field or an extra key is refused with `invalid-request`.
- **Errors.** A handler throws `BridgeFailure` for outcomes the user sees. Any other error is logged in the background process and answered as `failed` with no stack.
- **Trust nothing back.** The interface parses every answer and every event with the same contract, so it never acts on a shape it did not expect.
- **Lifetime.** Each page load is one bridge owner. When the window is destroyed, its renderer dies or it reloads, the owner ends. Its cleanups run, a cleanup added later runs at once, its events are dropped, and the next page load gets a new owner. So nothing a page started outlives it, even when a request was still in flight.

The terminal channels are in the contract and validated, and their handlers answer `not-found` until the terminal is wired.

| Channel or event | What it does | Limits | Why it is safe |
| --- | --- | --- | --- |
| `tools.versions` | Answers the `--version` line of `git`, `gh` and `claude`, or `null` when one is missing, fails or takes over 5 seconds, each on its own | Empty request, each answer at most 200 characters | Takes no input. The tools run with fixed arguments and no shell. |
| `terminal.start` | Starts Claude Code in a terminal with a given id and size | Program must be `claude`, id a UUID, 2 to 500 columns, 1 to 300 rows, 16 terminals | The interface names no executable, path or argument. The background process resolves `claude` itself. |
| `terminal.write` | Sends keystrokes and pastes to a terminal | 1 to 65536 characters per message | Text only reaches the terminal it was started for, the same as typing. |
| `terminal.resize` | Resizes a terminal | 2 to 500 columns, 1 to 300 rows | Bounded integers only. |
| `terminal.close` | Ends a terminal | UUID id | An id is data, never a path or a name. |
| `terminal.data` event | Streams terminal output to the window that owns it | | Shown as text by the terminal and never run. |
| `terminal.exit` event | Tells the window a terminal ended, with its exit code | Integer exit code | Data only. |

## Platform

`src/main/platform/` is the only code that knows about executables, shells and platform differences.

- **Overrides.** `SATELLITE_GH` and `SATELLITE_CLAUDE` hold a JSON array of strings, the executable then its leading arguments, and replace the search for that tool. Anything else is refused with an error that names the variable. `git` has no override.
- **Login shell environment.** An app started from the Dock, Finder or a desktop menu inherits a minimal `PATH`. On macOS and Linux Satellite runs the user's login shell once, interactive with a 5 second limit, reads its environment between two markers and merges it over its own. Whenever both markers come back the block is used, even if the shell exits with an error. Otherwise Satellite falls back to the app's own environment. Windows uses the app's environment as it is.
- **Search.** Tools are found by walking `PATH` and skipping empty and relative entries, so the current folder is never searched. A match must be a regular file, and executable on macOS and Linux. On Windows surrounding quotes are stripped, an entry needs a drive letter or a network share, and only `.exe` and `.com` files count, because batch files need a shell that re-parses arguments.
- **Running.** Tools run with an argument array and no shell, a 16 MiB output limit and the user's environment without any `ELECTRON_` variable. Past its time limit, 30 seconds unless the caller asks for less, a tool gets `SIGTERM` and two seconds later `SIGKILL`. On Windows its whole process tree is ended at once. Errors name the tool or the override variable, never its arguments.

## Folder layout

| Path | What |
| --- | --- |
| `src/main/main.ts` | Startup order. Home, scheme, hardening, protocol, bridge, window |
| `src/main/bridge/` | The router that validates every request, the sender check, the per-page owners and the IPC wiring |
| `src/main/window/` | The window, the menu, the `app://` protocol and the hardening |
| `src/main/platform/` | The Satellite home, path confinement, the login shell environment and finding and running tools |
| `src/main/tools/` | Tool versions for the left column |
| `src/preload/preload.ts` | Exposes `window.satellite` |
| `src/renderer/entry.tsx` | Loads the four typefaces, then renders the window |
| `src/renderer/bridge/` | The typed client that checks every answer and event |
| `src/renderer/proving/` | The tool readout that proves the bridge end to end |
| `src/renderer/window/` | The three columns |
| `src/renderer/ui/` | Shared interface parts such as the primary button |
| `src/renderer/styles/app.css` | The `DESIGN.md` app tokens for light and dark, mapped to Tailwind utilities |
| `src/shared/` | Code both processes import |
| `electron.vite.config.ts` | Builds main, preload and renderer into `out/` |
