# 011 Title bar

Status **Done** · Depends on **002, 003, 005**

## Why

The window opens under a plain system title bar that says only Satellite, a strip of space that tells nobody anything. Developers expect that strip to name where they are and hold the few things they reach for all day. Once it does, the sidebar can step aside for a wide diff or a long log, and the centre column stops repeating what the window already says.

## Scope

- One 40px strip across the top of the window on `side`, with a `line` hairline under it. It holds three parts and nothing more.
- Left, after the window buttons on macOS. Hide the sidebar, or Show the sidebar while it is hidden, an icon button on Cmd+B, or Ctrl+Shift+B on Windows and Linux, and a command in the command menu. Hidden gives its width to the centre column, the choice comes back after a restart like the column widths, and focus that was in the sidebar moves to this button. Focus the sidebar shows it first.
- Centre. The selected project and workspace, `satellite / fix-login`, drawn with the visible name rules, centred and cut with an ellipsis when the strip runs out of room. A click opens the switcher. With nothing selected it reads Satellite.
- Right. The inbox with its count, the command menu and New workspace, each the kit's icon button with a tooltip and an accessible name, running its existing command, Go to the newest workspace that needs you, Open the command menu and New workspace, and unavailable exactly when that command is.
- The strip is a drag area and every control in it is not, and it stops being one while a dialog or the command menu covers it. A double click on it does what the system does with a title bar.
- macOS hides the system title bar and places the traffic lights inside the strip, centred on it. The strip keeps their room, and gives it back in full screen, where they hide.
- Windows and Linux hide the system title bar and draw the native window controls as an overlay at the edge of the strip, coloured `side` with `fg2` symbols, following every theme change. The strip keeps clear of them through the window controls overlay's CSS variables, so a Linux desktop that puts the controls on the left works too. Any other system keeps its native title bar and shows the strip as a row under it.
- The workspace header loses its visible project and workspace name, since the strip says them, and keeps the branch, base, readouts, Archive and Remove this project. Its heading stays for screen readers.
- `window.frame` tells the page which of the three title bars it sits under and whether the window is in full screen, and the `window.frame` event says when that changes.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| The window controls overlay on Linux, as on Windows | The native title bar with the strip as a row under it | Electron 45 documents `titleBarOverlay` and `setTitleBarOverlay` for Linux, takes its colour there and follows the desktop's own button layout and side, so the integrated strip works there as on Windows. |
| Overlay colours from the `side` and `fg2` tokens, kept beside the platform code and checked against `app.css` by a test | Colours the page sends over the bridge | Nothing the page says can paint the system's controls, and the test catches a token that drifts. |
| Only what is already a command | Back and forward, a settings gear, a search box | Satellite is a thin layer, and each control here already has a home. |
| The project and workspace name in the strip only, the heading kept for screen readers | Two titles on screen | One place names where you are, and screen reader users keep their page heading. |
| The sidebar hidden completely | A narrow rail of icons | Its rows need their names, and every action in it stays a command. |

## Not in scope

Hiding the sessions column, a window menu drawn in the strip, and close, minimise and maximise buttons drawn by Satellite.

## Acceptance

A Satellite feature is accepted on macOS, Windows and Linux.

- [x] The strip shows the toggle, the centre title and the three buttons, each with its accessible name and tooltip, at the opened size and at 960 by 600, in light and dark. Proof, journey `title-bar`.
- [x] The centre title names the project and workspace, reads Satellite with nothing selected, writes out a hostile name and opens the switcher. Proof, journey `title-bar`.
- [x] Each right button runs its command and is unavailable exactly when the command is. Proof, journey `title-bar`.
- [x] Hide the sidebar from the button and the shortcut gives the centre its width, moves focus off the hidden column, comes back after a restart and shows again with Focus the sidebar. Proof, journey `title-bar`.
- [x] The strip is a drag area with its controls outside it, and drops its drag area under a dialog and the command menu. Proof, journey `title-bar`.
- [x] The workspace header no longer names the project, and keeps its heading for screen readers. Proof, journey `title-bar`.
- [x] The title bar options per system, and overlay colours equal to the tokens in `app.css`. Proof, `src/main/platform/title-bar.test.ts`.
- [ ] The traffic lights, the overlay and a double click on the strip behave as the system's own title bar. Proof, a person on each system, since a quiet window shows no frame.
