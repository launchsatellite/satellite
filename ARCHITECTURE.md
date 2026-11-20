# Architecture

How Satellite is put together and where its security boundary runs. `SATELLITE.md` owns what the product does and `DESIGN.md` owns how it looks.

## Parts

| Part | Folder | What it does |
| --- | --- | --- |
| Background process | `src/main/` | Electron's main process. Full access to the machine. Owns the window, the `app://` protocol, the hardening and the platform module. |
| Bridge | `src/preload/` | Runs in the sandboxed preload. It is the only door between the interface and the background process. |
| Interface | `src/renderer/` | React and Tailwind in a sandboxed renderer with no Node. It draws the three columns and nothing else touches the machine. |
| Shared | `src/shared/` | Code both sides import, such as the content security policy. |

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

## Folder layout

| Path | What |
| --- | --- |
| `src/main/main.ts` | Startup order. Home, scheme, hardening, protocol, window |
| `src/main/window/` | The window, the `app://` protocol and the hardening |
| `src/main/platform/` | The Satellite home and path confinement |
| `src/preload/preload.ts` | The bridge |
| `src/renderer/entry.tsx` | Loads the four typefaces, then renders the window |
| `src/renderer/window/` | The three columns |
| `src/renderer/ui/` | Shared interface parts such as the primary button |
| `src/renderer/styles/app.css` | The `DESIGN.md` app tokens for light and dark, mapped to Tailwind utilities |
| `src/shared/` | Code both processes import |
| `electron.vite.config.ts` | Builds main, preload and renderer into `out/` |
