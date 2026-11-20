# Design

How Satellite looks, moves and speaks. [BRAND.html](BRAND.html) is the visual reference, open it in a browser to see every token, part and screen drawn. This file owns the rules. `SATELLITE.md` owns what the product does, so when a screen in BRAND.html and the product doc disagree, the product doc wins and the screen gets fixed.

The screens in BRAND.html chapter 09 are a reference for patterns and states. Specs decide what ships and when.

## One system, two volumes

Everything is built from one unit, the pixel. A status pixel, a tile, a mosaic block and the Twin mark are all the same square at different sizes.

| | Broadcast | Instrument |
| --- | --- | --- |
| Where | The site, docs, posters, cards, launch moments | The app |
| Feel | Loud, flat fields of colour, big type | Quiet, greys carry the interface |
| Corners | Square, only controls and the product window are rounded | 6 controls, 8 inputs, 10 cards, menus and toasts, 12 palette, dialogs and windows |
| Mosaic | At the edges of heroes, cards and footers | Only in launch, first run and empty states |
| Colour | Whole fields of ultraviolet, paper or void | Colour only means state |

Both volumes share colour, type, the Twin mark, status colours, line icons, the 4px grid and the voice.

Nothing is ever tilted, rotated or scattered. Every piece sits straight on cells and hairlines.

## Colour

| Name | Hex | Role |
| --- | --- | --- |
| Void | `#08080A` | Dark ground |
| Paper | `#F4F4F1` | Light ground |
| White | `#FFFFFF` | Light panels, marks on ultraviolet |
| Ultraviolet | `#6A4BFF` | Working, focus, the one primary action |
| Ultraviolet deep | `#4A2EE0` | Ultraviolet text on light |
| Lilac | `#C7B9FF` | Merged, approved, secondary state |
| Signal | `#FF5A1F` | Needs you, errors and destructive actions, nothing else |
| Volt | `#DCFF3D` | Ready, passing checks |
| Greys | `#0E0E10` `#161618` `#1F1F22` `#2E2E33` `#5C5C63` `#8E8E95` `#C9C9CC` | Lines, surfaces and secondary text |

State colours mean the same thing everywhere. Ultraviolet is working, signal is needs you, volt is ready, lilac is done, grey is idle. Signal orange stays rare, so it always reads as "you are the blocker" or "this can break something".

### App tokens

App components read only these semantic tokens, never raw colours. Each has one dark and one light value.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `bg` | `#08080A` | `#FFFFFF` | Window and pane background |
| `side` | `#0C0C0E` | `#F6F6F3` | Sidebar, inputs, dialog footers |
| `raised` | `#161618` | `#FFFFFF` | Menus, palette, dialogs, toasts |
| `sel` | `#18181B` | `#ECECE8` | Selected row |
| `hover` | `#131315` | `#F0F0EC` | Hovered row or ghost button |
| `line` | `#1C1C1F` | `#E7E7E3` | Hairlines |
| `ctl` | `#2E2E33` | `#D6D6D1` | Control borders |
| `fg` | `#EDEDEA` | `#0A0A0B` | Primary text |
| `fg2` | `#B4B4B8` | `#45454B` | Secondary text |
| `dim` | `#82828A` | `#68686F` | Labels, readouts, hints |
| `sigfg` | `#FF5A1F` | `#C2410C` | Signal as text |
| `add` / `addfg` | `#15122B` / `#A493FF` | `#EEEBFF` / `#4A2EE0` | Added lines |
| `del` / `delfg` | `#2A130B` / `#FF8A5C` | `#FFEDE6` / `#C2410C` | Removed lines |
| `accent` | `#6A4BFF` | `#6A4BFF` | Working, the main action, focus |
| `signal` | `#FF5A1F` | `#FF5A1F` | Needs you, destructive actions |
| `pri-bg` / `pri-fg` | `#F4F4F1` / `#08080A` | `#0A0A0B` / `#F4F4F1` | Primary button |
| `volt` / `volt-edge` | `#DCFF3D` / `#DCFF3D` | `#DCFF3D` / `#6B7800` | Ready and passing, with the inner edge that keeps a volt pixel visible on light |
| `lilac` / `lilac-edge` | `#C7B9FF` / `#C7B9FF` | `#C7B9FF` / `#8066D6` | Merged, approved, secondary state, with the darker lilac that keeps a small lilac shape visible on light |
| `shadow` | `0 16px 40px rgb(0 0 0 / 0.55)` | `0 16px 40px rgb(10 10 11 / 0.12)` | The one shadow, on menus, the palette, dialogs and toasts |

Every text pair passes WCAG AA at 4.5 to 1. On light grounds the volt pixel gets a `#6B7800` inner edge so it stays visible. Shapes too small for an edge, like the cells of a project avatar, draw volt and lilac in their edge colours, `volt-edge` and `lilac-edge`, which pass 3 to 1 against `side` and `sel` in both themes.

## Type

| Face | Weights | Use |
| --- | --- | --- |
| Funnel Display | 300 to 800, mostly 700 | Display sizes, heroes, titles, section heads, big numbers |
| Funnel Sans | 300 to 800 | Everything people read. Body 15, lead 18, app 13, headings 17 at 600 |
| Geist Pixel | 400 | Readouts only, in capitals. Counts, timers, ports, ahead and behind |
| Geist Mono | 400 to 500 | Code, diffs, paths and terminals |

All four are bundled with the app and never loaded from the network. Display type sits tight, around −0.04em. Headlines are lowercase and titles never end with a full stop.

Readouts are how the machine speaks, like `T+04:12`, `↑2 ↓3` and `2/3`. People always speak in sentences.

## Logo

Twin is a 9 by 9 pixel planet with two rows slipping in opposite directions, like branches leaving main. It is drawn as one path so rows never seam.

- Keep one row height of clear space on every side.
- Never below 12px. At 16px and under it snaps to whole pixels.
- One flat colour. Paper on void, void on paper, white on ultraviolet.
- The wordmark is Funnel Display 700 in lowercase. In a lockup it sits beside Twin at the mark's height.
- While agents work the two rows may slip apart, and they close when the work lands. Pixel steps only, no easing.

The app icon is one fixed artwork. The exact Twin sits on a clear plate inside a hand-placed mosaic frame on a 17 by 17 grid, where one Twin pixel equals one mosaic block. Its map lives in BRAND.html chapter 01, and every icon size is exported from that map.

## Mosaic

The signature texture. A field of square blocks in a fixed mix of ultraviolet, paper, lilac, volt and greys, with one signal block at most. Content always sits on a clear plate cut out of the field on whole blocks, never on top of the blocks. The mosaic never sits under body text.

## Layout and spacing

- A 4px grid. Gaps inside a control 4 to 8, between controls 8 to 12, between groups 16 to 24, between sections 32 and up.
- Broadcast pages sit on one 12 column hairline grid. Header, section labels, content and footer share the same lines. On phones the cells stack and the lines still meet.
- Buttons are 28, small 24, large 36. Inputs and palette rows are 32, list rows 28 to 30, bars 40.
- Only menus, the palette, dialogs and toasts cast a shadow.

## Components

BRAND.html chapter 08 Kit draws every part in dark and light. Atoms are buttons, inputs, checkbox, radio, toggle, tags, counters, key hints, avatars, the pixel spinner for network work, block progress and readouts. Molecules are sidebar rows, tabs, segmented control, menu, needs you card, toast, agent log, diff and checks. Organisms are the palette, dialogs and the pull request card.

- Focus is an ultraviolet ring, 2px on buttons and a soft 3px glow on inputs.
- Selection is a grey fill. The active row of the palette adds a 1px ultraviolet inset outline, so it reads at 3 to 1. The menu hover is the one place ultraviolet fills a row.
- Status is a square pixel, never a dot.
- One primary action per view.
- An action that loses work is a danger button, signal text on the plain ground with a control border, never a signal fill. It replaces the primary action only while something would be lost, as Archive anyway.
- A dialog opens over the window dimmed behind a scrim, takes the keyboard until it closes and ends in a footer on `side` with its actions on the right. Escape and a click outside close it only while nothing runs.
- Projects get a generated pixel avatar. People show their GitHub avatar, or a pixel one when they have none.

## App

The agent pane always shows the real Claude Code, untouched. Satellite draws only the moments around it, before it is installed, after a session ends or when it stops.

The theme follows the system unless the user chooses light or dark from the command menu, and the choice is remembered. The terminal, the diff and the native dialogs switch with it.

## Motion

Broadcast moves in steps on the pixel grid, never with easing. In the app motion is functional at 120ms, and status changes step. The launch moment is the one animation the brand owns. The mosaic field resolves into Twin, then the wordmark arrives, over 4.2 seconds. With reduced motion every animation shows its final frame.

## Voice

Smart, friendly, futuristic. Short sentences, plain words, no colons in prose. Buttons start with a verb and name the thing, like Send to Claude Code. Errors say what happened and what is safe. Nothing shouts.

| Say | Not |
| --- | --- |
| pr-tab needs you. Claude Code asks to run git push | Action required! |
| main moved, 2 files conflict | Merge conflict detected |
| Claude Code stopped unexpectedly. The worktree and its changes are safe | Error: process exited with code 1 |
| 2 commits aren't pushed · Archive anyway | Are you sure? This cannot be undone |

The glossary in BRAND.html chapter 11 keeps one word for one thing.
