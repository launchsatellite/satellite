# 011 Title bar plan

1. **Platform options.** `src/main/platform/title-bar.ts` answers the window options and the frame kind per system, `inset` on macOS, `overlay` on Windows and Linux, `native` elsewhere, and the overlay colours from the `side` and `fg2` tokens. Proof, `title-bar.test.ts`, the colours read against `app.css`.
2. **Window and bridge.** `src/main/window/main-window.ts` spreads the options, follows `nativeTheme` with `setTitleBarOverlay` and reports full screen. `window.frame` request and event in the contract, the handler in `src/main/window/title-bar.ts`, the registry spy, the `ARCHITECTURE.md` rows. Proof, typecheck and the registry test.
3. **Sidebar state.** `interface.json` version 5 with `sidebar`, version 4 and older reading as shown. Proof, `interface-file.test.ts`.
4. **Strip.** `src/renderer/window/title-bar.tsx`, the `sidebar.toggle` command on `b`, the layout in `app-window.tsx`, focus kept out of a hidden column, the header heading made screen reader only. Proof, the verify driver in light and dark, at the opened size and 960 by 600, with no project, a project, a hostile name and the sidebar hidden.
5. **Journeys.** A `title-bar` journey on a new `title-bar` scenario, then every journey the layout breaks fixed. Proof, `npm run --silent journeys`.
6. **Docs.** `SATELLITE.md`, `DESIGN.md`, `ARCHITECTURE.md`, skills `satellite-stack` and `satellite-verify`.
7. **Acceptance on each system.** A person sees the traffic lights, the overlay and a double click on macOS, Windows and Linux, then the spec turns Done and this plan goes.
