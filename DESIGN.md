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

BRAND.html chapter 08 Kit draws every part in dark and light. Atoms are buttons, inputs, checkbox, radio, toggle, tags, counters, key hints, avatars, the pixel spinner for network work, block progress and readouts. Molecules are sidebar rows, tabs (session tabs and open file tabs), segmented control, menu, needs you card, toast, agent log, diff and checks. Organisms are the palette, dialogs and the pull request card.

- Focus is an ultraviolet ring, 2px on buttons and a soft 3px glow on inputs.
- Selection is a grey fill. The active row of the palette adds a 1px ultraviolet inset outline, so it reads at 3 to 1. The menu hover is the one place ultraviolet fills a row.
- The segmented control is a radio group, a 28px track on `side` with a `ctl` border and a 6px corner, each option 24px with the chosen one on `sel` in `fg` and the others in `fg2`. The arrow keys move the choice and its focus, and only the chosen option is in the tab order.
- Status is a square pixel, never a dot.
- One primary action per view.
- An action that loses work is a danger button, signal text on the plain ground with a control border, never a signal fill. It replaces the primary action only while something would be lost, as Archive anyway.
- A dialog opens over the window dimmed behind a scrim, takes the keyboard until it closes and ends in a footer on `side` with its actions on the right. Escape and a click outside close it only while nothing runs.
- Projects get a generated pixel avatar. People show their GitHub avatar, or a pixel one when they have none.

## App

The agent pane always shows the real Claude Code, untouched. Satellite draws only the moments around it, before it is installed, after a session ends or when it stops.

- Sessions are tabs in a 40px bar on `side` above the terminal, each named Session and its number, with its status pixel and a close button shown on the selected tab and on hover, so a tab cut off at the strip's edge never shows a lone one, and a plus at the end that starts another. The arrow keys, Home and End move between tabs and Delete closes one.
- A session's pixel is ultraviolet while it works, signal while it needs you, lilac when it is done and grey while it is idle or stopped. A workspace row shows the most urgent of its sessions, needs you before working before done.
- The inbox sits at the top of the sidebar under the command rows. Its header is the dim uppercase label Inbox with a bell icon, and on its right the count as a Geist Pixel readout, in `sigfg` while something needs you and in `dim` at 0. Each row is a 6px signal pixel beside the workspace name in `fg` on its own line, wrapping in full however long it is, so two rows never read the same. Below it the project in `dim`, drawn as the cleaned name a notification shows so no direction mark can disguise it, truncated when it runs out of room, then one sentence in `fg2`, Claude Code needs you., Session 2 needs you., 3 sessions need you., Checks failed on the pull request., A review asks for changes., The pull request has conflicts. or The pull request needs you., which moves to its own line when the project leaves it no room. The project gains its parent folder when two project names read the same, your home folder when that parent, or the project itself, is the home folder. The rows sit in a list of at most a third of the window's height that scrolls on its own, so the projects stay in view, and a row that takes keyboard focus scrolls into view. The row's tooltip and accessible name read the workspace, the project and the sentence. With nothing listed the inbox says Nothing needs you right now. in `dim`.
- The centre column opens on a 40px bar on `side`, a tab strip with the tabs Changes, Files and Pull request, then at the right Send lines, a segmented control for Branch and Uncommitted and one for Side by side and Inline, which only shows while a diff has room for two sides. The bar wraps onto a second row instead of clipping, and Send lines stays, disabled when no diff shows. The layout control appears only where the diff pane is wide enough for two sides, since a narrower pane draws inline whatever was chosen. The bar also names the base as the words from and its name in `dim` Geist Mono, shown in the Branch view and held in place unseen in Uncommitted. Below it the file list sits at 260px on the left, or above the diff, at most 40% of the height, when the column is under 640px. A row is 28px with the Git letter in Geist Mono 12, `addfg` for added and `delfg` for deleted and `dim` for the rest, the folder in `dim` giving way from its start so the file name in `fg` always shows, and the counts as +n in `addfg` and −n in `delfg`. The selected row takes `sel`. The diff reads the app tokens, `add` and `del` for lines, `addfg` and `delfg` at low alpha for changed words, and syntax in weight and greys only, keywords `fg` bold, strings and numbers `fg2` and comments `dim` italic, since colour means state. A moved base that conflicts shows one grey strip on `side` under the bar, `fg2` at 13px with the files in Geist Mono, never signal, because the agent can fix it without you, and its button is the secondary Send to Claude Code. A sentence that replaces a diff or a list is centred, `fg2` at 13px, in a column of at most 360px. The workspace header names the branch, from and the base in `dim` Geist Mono and the ahead and behind as a Geist Pixel readout like ↑2 ↓1, when it has room.
- The Files tab keeps the centre bar, with the tabs Changes, Files and Pull request, then Send lines and Find a file at the right. Below it the tree sits at 260px on the left, or above the viewer at most 40% of the height when the column is under 640px and a file is open, and the whole height while none is, and the viewer has a 32px strip of open files above it. Tree rows are 28px with a chevron for a folder, 12px of indent per level and an icon for the kind, the name in Geist Mono 12. Everything on disk is listed and only `.git` stays out. Ignored entries are dimmed, the name in `dim` and the icon at half strength, never hidden. A changed file carries its Git letter in Geist Mono 12, and the letter and the name take the colour the Changes list gives that letter, `addfg` for added and `delfg` for deleted, with every other letter in `dim`, so modified is never drawn as added. File kind icons carry the colours of their icon set, near-signal orange ones included, since colour elsewhere means state, and signal orange as a state colour appears only on status marks, never beside a name. A file tab is 24px in a 32px strip on `side`, at most 180px wide, with a close button on the selected tab and on hover, and two open files with the same name show their parent folder in `dim` after the name, and only then. The viewer is the read-only editor of the diff with one side, drawn in the same weights and greys. An image is drawn fitted and never scaled up, centred on a checkerboard of `line` and `raised` so transparency shows, with its size in pixels in `fg2` at 12px under it. A sentence that replaces a file or a list is centred, `fg2` at 13px, in a column of at most 360px. A sentence about one folder sits in the tree under its row in `dim` at 12px. The finder is the palette's third mode, a result row with the file's icon, its name in `fg` and its folder in `dim` giving way from its start, so the nearest folders stay readable and the full path is in the tooltip.
- The Pull request tab is the third tab and carries the number once there is one. It keeps the centre bar with Open on GitHub at the right, then the title at 15px semibold, a line with a 6px state pixel, the number as a Geist Pixel readout, the state word, the checks summary and the head into base in `dim` Geist Mono, then a strip of the sections Overview, Checks, Conversation and Files, a 36px tab list with the arrow keys, Home and End moving between them, and a scrolling body. Overview shows Merge, Description and Commits as 10px uppercase labels. A merge row is a 6px pixel and one sentence, signal only for what needs the user, volt for nothing blocks it and lilac for merged. Every state without a pull request is one centred sentence, with no button on a default or target branch, in `fg2` at 13px that names the fix, never in signal because none is an error, and a quiet grey strip above a kept answer says when a refresh failed. The row readout in the sidebar and the header readout are the pixel and `#n`, and the header one adds the state word and the checks summary when it has room, both carrying the number, state and summary in their tooltip and accessible name. While the conversation is read, Conversation shows the review decision the overview already knows above one quiet reading sentence. Checks is a list of rows, each a 6px result pixel, the check's name, its workflow in `dim`, the result as a Geist Pixel readout and at the right Show failing lines, Send to Claude Code and Open on GitHub or Open check details, a failed one opening its failing lines in a mono block of at most 256px that scrolls. A result is signal for failed, ultraviolet for running, volt for passed and grey for skipped, cancelled and unknown. Conversation is one list, unresolved threads first with the Unresolved and Outdated badges as Geist Pixel readouts, then reviews and comments by time with the author in `fg` medium and the date in `dim`, then resolved threads as closed disclosures, and under a long list a secondary Show n more button that draws the next part. A body reads as Markdown at 13px in `fg2` with headings at 15px and under, lists, quotes, tables, code in `side` with a `ctl` border and a link as underlined `fg` text, never a colour. A body drawn as plain text shows its mono source under one quiet sentence. Files keeps the Changes list at 240px beside a read-only diff that is always inline, a note above them in `dim` that names the base, and under the diff a Threads in this file panel of at most 45% of the height, with the group Not on a line here only beside marked threads. A thread mark is a 10px ring in `accent` in the diff's glyph margin, filled while the thread is unresolved and open, and it never uses signal. The selected thread takes `sel`.
- A link from the terminal opens a small dialog first, Open this link, with the site above the full address in Geist Mono, Cancel on the left with focus and Open in browser on the right.
- A moment Satellite draws is one sentence in the pane on `bg`, in `fg2`, above the button that starts a fresh session. The resume offer pairs Resume session with a secondary Start a new session. When Claude Code is missing no tab or terminal is drawn, and the install step sits between the sentence and Start Claude Code.

The theme follows the system unless the user chooses light or dark from the command menu, and the choice is remembered. The terminal, the diff and the native dialogs switch with it.

## Motion

Broadcast moves in steps on the pixel grid, never with easing. In the app motion is functional at 120ms, and status changes step. The launch moment is the one animation the brand owns. The mosaic field resolves into Twin, then the wordmark arrives, over 4.2 seconds. With reduced motion every animation shows its final frame.

## Voice

Smart, friendly, futuristic. Short sentences, plain words, no colons in prose. Buttons start with a verb and name the thing, like Send to Claude Code. Errors say what happened and what is safe. A notification holds only Satellite's own words and names, never what a session said or ran. Nothing shouts.

| Say | Not |
| --- | --- |
| pr-tab needs you. Claude Code is waiting for you in satellite | Action required! |
| main moved, 2 files conflict | Merge conflict detected |
| Claude Code stopped unexpectedly. The worktree and its changes are safe | Error: process exited with code 1 |
| 2 commits aren't pushed · Archive anyway | Are you sure? This cannot be undone |

The glossary in BRAND.html chapter 11 keeps one word for one thing.
