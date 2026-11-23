# 012 Settings plan

1. **Shortcut.** `src/renderer/commands/shortcuts.ts` gains a shortcut that takes Ctrl alone on Windows and Linux, and the comma's physical key. Proof, `shortcuts.test.ts`.
2. **Shared tool rows.** `src/renderer/setup/tool-check.tsx` splits the rows, the count and Check again out of the card, with a test id prefix, so the card and the dialog draw the same thing from `tools.check`. Proof, journeys `launch` and `missing` unchanged.
3. **Dialog.** `src/renderer/settings/settings-dialog.tsx` with the six sections, the `settings` icon in `ui/icon.tsx`, the version from `package.json` through `define` in `electron.vite.config.ts`. Proof, the verify driver in light and dark, at 1440 by 900 and 960 by 600.
4. **Entry points.** The `settings.show` command in `app-window.tsx`, the button in `title-bar.tsx`, the `window.settings` event in the contract, sent from the Settings… item in `src/main/window/app-menu.ts` through `window-frame.ts`. Proof, typecheck and journey `settings`.
5. **Journeys.** The Claude Code settings journey renamed `claude-settings`, a new `settings` journey on the `default` scenario, and the journeys the new button and command break fixed. Proof, `npm run --silent journeys`.
6. **Docs.** `SATELLITE.md`, `DESIGN.md`, `ARCHITECTURE.md`, specs 005 and 011, skills `satellite-stack` and `satellite-verify`.
7. **Acceptance on each system.** A person sees the menu item on macOS and the button beside the window controls on Windows and Linux, then the spec turns Done and this plan goes.
