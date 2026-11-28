# 011 Title bar

Status **In progress** · Depends on **002, 003, 005**

## Why

A plain system title bar says only Satellite and spends a row that tells nobody anything. Letting each column's own top row be the title bar gives that height back to the agent, keeps the window draggable, and lets the sidebar step aside for a wide terminal or a long log.

## Scope

- No strip runs across the window. The sidebar and the rail start with a 44px top row on their own ground, the centre with its 48px header, and those rows are the title bar.
- The sidebar's top row keeps room for the traffic lights on macOS, given back in full screen, and ends with Hide the sidebar, an icon button on Cmd+B, or Ctrl+Shift+B on Windows and Linux, and a command in the command menu. Hidden gives its width to the centre, the choice comes back after a restart like the column widths, and focus that was in the sidebar moves to Show the sidebar. Focus the sidebar, Add a repo, a dropped folder and Show the guide show it first.
- With the sidebar hidden the workspace header is the top row. It starts with Show the sidebar and keeps 76px of the window clear for the traffic lights on macOS, and with nothing selected a bare row holds that button.
- The workspace header names the selected repo and workspace, `satellite / fix-login`, or the repo alone for its main workspace, drawn with the visible name rules. The switcher stays on Cmd+P and in the command menu.
- The inbox count, the command menu, New workspace and Settings live in the sidebar, Needs you with its count, Search or run a command, the primary New workspace button and Open settings in the footer, each running its existing command.
- Every top row is a drag area and every control in it is not, and it stops being one while a dialog or the command menu covers it. A double click on it does what the system does with a title bar.
- Windows and Linux hide the system title bar and draw the native window controls as a 44px overlay, coloured `win` with `fg2` symbols, following every theme change, on the right or, on some Linux desktops, the left. Every top row the controls overlap, sidebar, rail or centre header, keeps its content in the free area the window controls overlay's CSS variables report. Any other system keeps its native title bar above the page. A page that cannot learn its title bar still drags, keeps the room for the traffic lights and stays clear of the overlay.
- `window.frame` tells the page which of the three title bars it sits under and whether the window is in full screen, and the `window.frame` event says when that changes. The page asks again once it listens, so a change during load is never missed.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| The window controls overlay on Linux, as on Windows | The native title bar above the columns | Electron 45 documents `titleBarOverlay` and `setTitleBarOverlay` for Linux, with the overlay's colour, so the integrated strip works there as on Windows. Where the controls sit on a desktop that puts them on the left is checked by hand. |
| Overlay colours from the `win` and `fg2` tokens, kept beside the platform code and checked against `app.css` by a test | Colours the page sends over the bridge | Nothing the page says can paint the system's controls, and the test catches a token that drifts. |
| Top rows in each column | One 40px strip across the window | The strip spent a row on a title and a few buttons the sidebar already holds, and top rows give that height back to the agent. |
| The repo and workspace named once, in the workspace header | A name in a strip and again in the header | One place names where you are. |
| The sidebar hidden completely | A narrow rail of icons | Its rows need their names, and every action in it stays a command. |

## Not in scope

A window menu drawn in a top row, and close, minimise and maximise buttons drawn by Satellite.

## Acceptance

A Satellite feature is accepted on macOS, Windows and Linux.

- [x] The sidebar's top row, the rail's and the workspace header are drag areas with their controls outside them, and drop their drag area under a dialog and the command menu. Proof, journey `frame`, which reads the sidebar's top row and the header as drag areas and the top row as none under the command menu.
- [x] The header names the repo and workspace, writes out a hostile name and follows the switcher. Proof, journey `frame`.
- [x] New workspace, the command menu row and a Needs you row in the sidebar run their commands. Proof, journey `frame`.
- [x] Hide the sidebar gives the centre its width, comes back after a restart and Show the sidebar sits clear of the traffic lights and shows it again. Proof, journey `frame`.
- [x] The title bar options per system with a 44px overlay, and overlay colours equal to the tokens in `app.css`. Proof, `src/main/platform/title-bar.test.ts`.
- [ ] The traffic lights, the overlay on either side and a double click on a top row behave as the system's own title bar. Proof, a person on each system, since a quiet window shows no frame.
