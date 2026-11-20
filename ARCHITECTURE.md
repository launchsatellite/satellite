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
- **Navigation.** Every web contents refuses `will-navigate`, `will-frame-navigate` and `will-attach-webview`, and its window open handler denies every new window.
- **Content security policy.** `default-src 'none'`, with scripts, styles, images, fonts, connections and workers only from the app itself, images and fonts also from `data:`, and `base-uri`, `form-action`, `frame-ancestors` and `object-src` all `'none'`. Styles allow `'unsafe-inline'` because the terminal and the diff editor insert style elements at run time. In development only, scripts allow `'unsafe-inline'` for the React refresh preamble and connections allow `ws://localhost:*` for hot reload. `src/shared/content-security-policy.ts` builds both, so the dev server and the protocol never drift.
- **The `app://` protocol.** The interface loads from `app://satellite/index.html`, a standard and secure scheme, never from `file://`. The handler answers only `GET` for host `satellite`, decodes the path and confines it to `out/renderer` with `resolveInside`, which follows symlinks before it checks. Anything refused gets a 404. Every response carries the production policy and `X-Content-Type-Options: nosniff`.
- **Development server.** `ELECTRON_RENDERER_URL` points the window at the dev server only when the app is not packaged, so an environment variable can never aim a packaged app at remote content.
- **Satellite home.** All state lives in the Satellite home, `~/.satellite` or the absolute path in `SATELLITE_HOME`, created with mode `0700` before the app is ready. Electron's `userData` is `app-data` inside it, so caches and storage never land anywhere else.
- **Menu.** Electron's default application menu stays, because it carries the Edit roles that make copy and paste work on macOS.

## Bridge

The preload exposes two functions on `window.satellite` and nothing else. `invoke(channel, payload)` sends one request over the IPC channel `satellite:bridge` and `onEvent(listener)` receives pushes from `satellite:event`. `src/shared/bridge-contract.ts` holds a zod schema for every request, answer and event.

- **Sender check.** The background process answers only its own window's main frame, and only while that frame shows the app origin, `app://satellite` or the dev server in development. Anything else gets `refused-sender`.
- **Validation first.** Channels are looked up in a `Map`, so names like `__proto__` or `constructor` find nothing. Every payload is parsed with its strict schema before the handler runs, so a wrong type, a missing field or an extra key is refused with `invalid-request`.
- **Errors.** A handler throws `BridgeFailure` for outcomes the user sees. Any other error is logged in the background process and answered as `failed` with no stack.
- **Trust nothing back.** The interface parses every answer and every event with the same contract, so it never acts on a shape it did not expect.
- **Lifetime.** Each window is one bridge owner, told when the window is destroyed, its renderer dies or it reloads, so whatever it started can end with it.

The terminal channels are in the contract and validated, and their handlers answer `not-found` until the terminal is wired.

| Channel or event | What it does | Limits | Why it is safe |
| --- | --- | --- | --- |
| `tools.versions` | Answers the `--version` line of `git`, `gh` and `claude`, or `null` when one is missing | Empty request, each answer at most 200 characters | Takes no input. The tools run with fixed arguments and no shell. |
| `terminal.start` | Starts Claude Code in a terminal with a given id and size | Program must be `claude`, id a UUID, 2 to 500 columns, 1 to 300 rows, 16 terminals | The interface names no executable, path or argument. The background process resolves `claude` itself. |
| `terminal.write` | Sends keystrokes and pastes to a terminal | 1 to 65536 characters per message | Text only reaches the terminal it was started for, the same as typing. |
| `terminal.resize` | Resizes a terminal | 2 to 500 columns, 1 to 300 rows | Bounded integers only. |
| `terminal.close` | Ends a terminal | UUID id | An id is data, never a path or a name. |
| `terminal.data` event | Streams terminal output to the window that owns it | | Shown as text by the terminal and never run. |
| `terminal.exit` event | Tells the window a terminal ended, with its exit code | Integer exit code | Data only. |

## Platform

`src/main/platform/` is the only code that knows about executables, shells and platform differences.

- **Overrides.** `SATELLITE_GH` and `SATELLITE_CLAUDE` hold a JSON array of strings, the executable then its leading arguments, and replace the search for that tool. Anything else is refused with an error that names the variable. `git` has no override.
- **Login shell environment.** An app started from the Dock, Finder or a desktop menu inherits a minimal `PATH`. On macOS and Linux Satellite runs the user's login shell once, interactive with a 5 second limit, reads its environment between two markers and merges it over its own. Any failure falls back to the app's own environment. Windows uses the app's environment as it is.
- **Search.** Tools are found by walking `PATH` and skipping empty and relative entries, so the current folder is never searched. On Windows only `.exe` and `.com` files count, because batch files need a shell that re-parses arguments.
- **Running.** Tools run with an argument array and no shell, a 30 second default limit, a 16 MiB output limit and the user's environment without any `ELECTRON_` variable.

## Folder layout

| Path | What |
| --- | --- |
| `src/main/main.ts` | Startup order. Home, scheme, hardening, protocol, bridge, window |
| `src/main/bridge/` | The router that validates every request and the IPC wiring with the sender check |
| `src/main/window/` | The window, the `app://` protocol and the hardening |
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
