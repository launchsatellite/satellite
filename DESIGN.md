# Design

How Satellite looks, moves and speaks. [BRAND.html](BRAND.html) is the visual reference, open it in a browser to see every token, part and screen drawn. This file owns the rules. `SATELLITE.md` owns what the product does, so when a screen in BRAND.html and the product doc disagree, the product doc wins and the screen gets fixed.

The screens in BRAND.html chapter 09 are a reference for patterns and states, and chapter 12 draws the layout spec 015 proposes. Specs decide what ships and when.

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
| `bg` | `#08080A` | `#FFFFFF` | The centre and pane background |
| `win` | `#0C0C0E` | `#F1F1EE` | The window's ground, the top rows, the sidebar and the rail |
| `side` | `#0C0C0E` | `#F6F6F3` | Inputs, dialog footers |
| `raised` | `#161618` | `#FFFFFF` | Menus, palette, dialogs, toasts |
| `sel` | `#18181B` | `#ECECE8` | Selected row |
| `hover` | `#131315` | `#F0F0EC` | Hovered row or ghost button |
| `line` | `#1C1C1F` | `#E7E7E3` | Hairlines |
| `ctl` | `#2E2E33` | `#D6D6D1` | Control borders |
| `fg` | `#EDEDEA` | `#0A0A0B` | Primary text |
| `fg2` | `#B4B4B8` | `#45454B` | Secondary text |
| `dim` | `#82828A` | `#68686F` | Labels, readouts, hints |
| `sigfg` | `#FF5A1F` | `#BE400C` | Signal as text, and the inner edge of the needs you pixel |
| `add` / `addfg` | `#15122B` / `#A493FF` | `#EEEBFF` / `#4A2EE0` | Added lines |
| `del` / `delfg` | `#2A130B` / `#FF8A5C` | `#FFEDE6` / `#BE400C` | Removed lines |
| `accent` | `#6A4BFF` | `#6A4BFF` | Working, the main action, focus |
| `on-accent` | `#FFFFFF` | `#FFFFFF` | Text on an `accent` fill, white or black, whichever reads better on the accent of the theme shown |
| `signal` | `#FF5A1F` | `#FF5A1F` | Needs you |
| `pri-bg` / `pri-fg` | `#F4F4F1` / `#08080A` | `#0A0A0B` / `#F4F4F1` | Primary button |
| `volt` / `volt-edge` | `#DCFF3D` / `#DCFF3D` | `#DCFF3D` / `#6B7800` | Ready and passing, with the inner edge that keeps a volt pixel visible on light |
| `lilac` / `lilac-edge` | `#C7B9FF` / `#C7B9FF` | `#C7B9FF` / `#8066D6` | Merged, approved, secondary state, with the darker lilac that keeps a small lilac shape visible on light |
| `working` | `#6A4BFF` | `#6A4BFF` | The working pixel |
| `idle` | `#82828A` | `#68686F` | The idle pixel |
| `danger` | `#FF5A1F` | `#BE400C` | Destructive actions, errors and their pixels, so an error toast's pixel is `#BE400C` in light |
| `shadow` | `0 16px 40px rgb(0 0 0 / 0.55)` | `0 16px 40px rgb(10 10 11 / 0.12)` | The one shadow, on menus, the palette, dialogs, toasts and the guide card |

Every text pair in use passes WCAG AA at 4.5 to 1, measured with the WCAG formula, the closest being light `sigfg` and `delfg` on `sel` at 4.51. On light grounds the volt, done and needs you pixels get a 1.5px inner edge, `volt-edge`, `lilac-edge` and `sigfg`, so each pixel measures at least 3 to 1 on `bg`, `side`, `sel` and `hover`, the lowest being lilac on `sel` at 3.7. In dark the edges equal their fills.

## Type

| Face | Weights | Use |
| --- | --- | --- |
| Funnel Display | 300 to 800, mostly 700 | Display sizes, heroes, titles, section heads, big numbers |
| Funnel Sans | 300 to 800 | Everything people read. Body 15, lead 18, app 13, headings 17 at 600 |
| Geist Pixel | 400 | Readouts only, in capitals. Counts, timers, ports, ahead and behind |
| Geist Mono | 400 to 500 | Paths, branches, hashes and code inside text |

All four are bundled with the app and never loaded from the network. The terminal, the diff and the file viewer draw in the system's code font instead, at its natural line box, so a long session reads like any good terminal. Menlo at 12 on macOS, Consolas at 14 on Windows and Droid Sans Mono at 14 on Linux. The terminal's lines are 1 font tall, 1.1 on Linux, its block cursor holds still, with or without reduced motion, and bold text lights up in the bright colours. Contrast is a rule there. The terminal lifts any text below 4.5 to 1 against its ground, so colours a program or theme asks for can render lighter or darker than asked. A line in the viewers is 1.5 times the size on macOS and 1.35 times elsewhere, rounded to a whole pixel. Display type sits tight, around −0.04em. Headlines are lowercase and titles never end with a full stop.

Readouts are how the machine speaks, like `T+04:12`, `↑2 ↓3` and `2/3`. People always speak in sentences.

## Logo

Twin is a 9 by 9 pixel planet with two rows slipping in opposite directions, like branches leaving main. It is drawn as one path so rows never seam.

- Keep one row height of clear space on every side.
- Never below 12px. At 16px and under it snaps to whole pixels.
- One flat colour. Paper on void, void on paper, white on ultraviolet.
- The wordmark is Funnel Display 700 in lowercase. In a lockup it sits beside Twin at the mark's height.
- In the app the lockup heads the sidebar under its top row, the wordmark at 17px with Twin at 14px in `fg` 8px beside it, its left edge on the rows' icon edge.
- While agents work the two rows may slip apart, and they close when the work lands. Pixel steps only, no easing.

The app icon is one fixed artwork. The exact Twin sits on a clear plate inside a hand-placed mosaic frame on a 17 by 17 grid, where one Twin pixel equals one mosaic block. Its map lives in BRAND.html chapter 01, and every icon size is exported from that map.

## Mosaic

The signature texture. A field of square blocks in a fixed mix of ultraviolet, paper, lilac, volt and greys, with one signal block at most. Content always sits on a clear plate cut out of the field on whole blocks, never on top of the blocks. The mosaic never sits under body text.

## Layout and spacing

- A 4px grid. Gaps inside a control 4 to 8, between controls 8 to 12, between groups 16 to 24, between sections 32 and up.
- Broadcast pages sit on one 12 column hairline grid. Header, section labels, content and footer share the same lines. On phones the cells stack and the lines still meet.
- Buttons are 28, small 24. Inputs and palette rows are 32, list rows 28 to 30, bars 40.
- Only menus, the palette, dialogs, toasts and the guide card cast a shadow.

## Components

BRAND.html chapter 08 Kit draws every part in dark and light. Atoms are buttons, inputs, checkbox, radio, toggle, tags, counters, key hints, avatars, the pixel spinner for network work, block progress and readouts. Molecules are sidebar rows, tabs (session tabs and open file tabs), segmented control, menu, needs you card, toast, agent log, diff and checks. Organisms are the palette, dialogs and the pull request card.

- Buttons are `primary`, `secondary`, `ghost` and `danger`, 28px with 12px of padding and 8px between icon and text, small 24px with 8px of padding and 6px between, a 6px corner and 13px semibold text, 12px on small. An icon-only button is square. Its shortcut shows as a key hint inside it, or in its tooltip when it has one. A disabled button stays in the tab order at 38% and ignores presses. A text link is the `link` button, `fg` text in the font around it with a `dim` underline that turns `fg` under the pointer, never a colour.
- Inputs and selects are 32px with 12px of padding, an 8px corner, a `ctl` border on `side` and 13px text. A select shows its value and a chevron in `dim`, and opens its menu under it, at least as wide as it and never taller than the window, scrolling when long. The arrow keys, Home, End and typing a name move through it, Enter picks. Escape or a click outside closes only the menu, so a dialog under it stays open with what was typed in it.
- A menu is on `raised` with a `line` border, a 10px corner, 4px of padding and the one shadow. Its rows are 28px with 8px of padding and a 6px corner, the chosen one carrying a check.
- A tooltip waits half a second under the pointer, and on a button, tab, list row or tree row it also shows at once when Tab, an arrow key, Home or End moves focus there, never when the app moves focus on its own. It sits under its control on `raised` with a `line` border, a 6px corner, 4px by 8px of padding and 12px text in `fg`, with the command's shortcut as a key hint, casts no shadow, lets the pointer through to whatever is under it and closes on Escape or a press. The control's own name and description say the same, since a tooltip never reaches a screen reader.
- Focus is an ultraviolet ring, 2px on buttons and a soft 3px glow on inputs and selects.
- Every enabled control shows the pointer, the selected row and tab included, so a selection never reads as switched off. That covers buttons, tabs, list and tree rows, palette options, selects and the thread marks in a diff's gutter. A disabled control keeps the arrow, never a not allowed sign, which the system keeps for a drop that cannot land. Text fields, the terminal and read-only code keep the text cursor, a link in the terminal shows the pointer, the column dividers show the resize cursor and the top rows' drag areas the arrow.
- Selection is a grey fill. The active row of the palette adds a 1px ultraviolet inset outline, so it reads at 3 to 1. The menu hover is the one place ultraviolet fills a row, its text in `on-accent`.
- Every scrollbar has one look in every theme, the page's own, the diff's, the file viewer's and the terminal's alike. A 10px gutter with no track, no corner and no arrows holds a 6px thumb with 2px clear on each side, a 2px corner and at least 24px of length, while the diff, the file viewer and the terminal keep their own shortest thumb. The terminal keeps its own 14px gutter with the same 6px thumb centred in it. The changes list, the files tree and the command menu's results keep the gutter before they overflow, so nothing shifts as they fill. Under forced colours the system draws its own bars. The thumb is `fg` at 20% at rest, 35% under the pointer and 50% while dragged, so it reads on any ground without shouting. The session and file tab strips scroll with no bar at all. A dialog body keeps its bar 4px in from the dialog's edge and its content 18px from it.
- A key hint is plain Geist Mono 10.5 at 500 in `dim`, never boxed, and takes the text colour at 55% on a primary button.
- The segmented control is a radio group, a sunken 28px track on `hover` with 2px of padding and a 7px corner, each option 24px at 12px medium, the chosen one raised on `bg` in `fg` with a 1px `ctl` edge and the others in `dim`. A wide one shares the track's width evenly.
- A chip carries state in a 22px box with a 5px corner, a 1px edge and 11.5px text, `chipLook` in `ui/chip.ts`. Its edge is the state's colour at 45%, signal for needs you, `volt-edge` for ready, `lilac-edge` for done and `working` for working, and `ctl` otherwise. The arrow keys move the choice and its focus, and only the chosen option is in the tab order.
- A tab is 28px with 9px of padding, a 6px corner and 12px medium text, the chosen one on `sel` in `fg` and the others in `dim`, taking `hover` under the pointer. Its focus ring sits 2px inside its edge, so a strip that scrolls never cuts it.
- A list row has one look in the sidebar, Needs you, the changes list, the files tree and the palette, a 6px corner, `hover` under the pointer, `sel` when chosen and its focus ring 2px inside its edge. Rows in the changes list and the files tree sit 4px in from the pane's sides and still take a press there. The palette lights only its active row, which the pointer moves.
- A close button on a tab is a 24px target flush with the tab's right edge. Inside it a 20px square, 4px in from that edge, holds the 12px close glyph and the focus ring, so the target meets the small button's size and the tab never grows to hold it. Under the pointer the square fills with `fg` at 20% over the tab's own ground and the glyph turns `fg`, so it stands out on the selected tab's `sel` and a hovered tab's `hover` in every theme, at 1.56 to 1.83 to 1 in light, dark and Dracula.
- Status is a square pixel, never a dot.
- One primary action per view.
- An action that loses work is a danger button, `danger` text on the plain ground with a control border, never a filled one. It replaces the primary action only while something would be lost, as Archive anyway.
- A dialog opens over the window dimmed behind a scrim, takes the keyboard until it closes and ends in a footer on `side` with its actions on the right, Cancel beside the main action, and any note on the left. Escape and a click outside close it only while nothing runs.
- A control's accessible name starts with the text it shows, for a file row its Git letter, path and counts, then says the rest in words, so voice control finds it by what is on screen. The centre, named Workspace, is the window's main landmark, and the sidebar and the rail are its regions.
- A repo's row is a chevron and its name in `fg` semibold, and the chevron folds its workspaces away for the run. Folded, it shows at its right the most urgent pixel of its workspaces and how many of them have a session. Its remove and New workspace in it, and a workspace row's archive, are small ghost icon buttons that show only under the pointer or keyboard focus, the archive one over the row's readout. Dragging a repo's row draws a 2px `accent` line where it lands.
- People show their GitHub avatar, or a pixel one when they have none.

## App

The agent pane always shows the real Claude Code, untouched. Satellite draws only the moments around it, before it is installed, after a session ends or when it stops. Start Claude Code takes focus only after a session you ended, never after a crash or a failed start, so a key pressed while typing starts nothing.

- The window is one ground, `win`, holding the sidebar on the left at 252px, 200 to 360, and the rail on the right at 348px, 300 to 440, both resizable by the 6px divider at their inner edge. The centre between them is one raised surface on `bg` with a `line` hairline and a 10px corner, 8px from the window's top and bottom, and 8px from a side whose column is hidden. Hide the rail on Cmd+E, or Ctrl+Shift+E, gives its width to the centre, and the rail's own `rail` icon button and the header's Show the rail button toggle it too. Under 1100px of window the rail folds to a 44px column of its three icons, and a press on one opens the rail with that view.
- There is no title bar strip. Each column starts with a 44px top row on its own ground. The sidebar's keeps room for the traffic lights on macOS, given back in full screen, and ends with Hide the sidebar, the `sidebar` line icon as the kit's small ghost icon button. The rail's holds its tabs. With the sidebar hidden the workspace header is the top row, starts with Show the sidebar and keeps 76px of the window clear for the traffic lights, and with nothing selected a bare 48px row holds that button. On Windows and Linux the system's window controls draw 44px tall in `win` with `fg2` symbols, on the right or the left, and every top row pads its content clear of them. A top row is a drag area and every control in it is not, it stops being one while a dialog or the command menu covers it, and its text cannot be selected.
- Sessions are tabs in a 36px strip on `bg` under the workspace header, each named Session and its number, with its status pixel and a close button shown on the selected tab and on hover, so a tab cut off at the strip's edge never shows a lone one, and a plus at the end that starts another. Open files are tabs in the same strip after the sessions, each at most 200px wide with its name and, when two names read the same, its parent folder in `dim`, and a file tab in front hides the terminal without ending it. With files open and no session the strip starts with a Claude Code tab that shows the start and resume offer. The arrow keys, Home and End move between tabs and Delete closes one.
- A session's pixel is ultraviolet while it works, signal while it needs you, lilac when it is done and grey while it is idle or stopped. A tab whose hooks seem off keeps its grey pixel and carries one sentence as its tooltip and accessible description, Claude Code's settings seem to keep its hooks off here, so this session never shows needs you, and Send to Claude Code there says the same before Type this one yourself. A workspace row shows the most urgent of its sessions, needs you before working before done.
- Under the lockup sits New workspace, the primary button across the sidebar with its key hint at the right, working in the selected repo or else the first one present, then Search or run a command, a 28px row on `hover` in `dim` with the `search` icon and its key hint, which opens the command menu. The sidebar ends in a footer under a `line` hairline, Agents as a 28px row with the `agents` icon (four rounded squares) and its key hint, and Open settings as an icon button with the `settings` sliders. Agents opens the palette in its Agents mode, whose rows are a 6px status pixel, the workspace's name and at the right in `dim` the state word, Session n when the workspace has several, and the repo. Group labels, Needs you and Repos, are 11.5px semibold in `dim`, sentence case, and Repos ends with Add a repo as a small ghost plus.
- Needs you sits near the top of the sidebar under the command menu row. Its header is the label Needs you, and on its right the count as a Geist Pixel readout, in `sigfg` while something needs you and in `dim` at 0. Rows show only while something waits. Each row is a 6px signal pixel beside the workspace name in `fg`, wrapping in full however long it is, so two rows never read the same, and after it the repo in `dim` at 12px, drawn as the cleaned name a notification shows so no direction mark can disguise it and truncated when it runs out of room. Under them one sentence in `dim` at 12px, Claude Code needs you., Session 2 needs you., 3 sessions need you., Checks failed on the pull request., A review asks for changes., The pull request has conflicts. or The pull request needs you. The repo gains its parent folder when two repo names read the same, your home folder when that parent, or the repo itself, is the home folder. The rows sit in a list of at most a third of the window's height that scrolls on its own, so the repos stay in view, and a row that takes keyboard focus scrolls into view. The row's tooltip and accessible name read the workspace, the repo and the sentence.
- A workspace row is 28px, indented 26px under its repo, with its pixel, its name, `dim` for a main workspace, and at its right one Geist Pixel readout in `dim`, merged once its pull request merged, else the pull request's pixel and `#n`, else its running processes, else its commits ahead. Ahead, behind, uncommitted files, the pull request and the processes all read in its tooltip and accessible name.
- The rail opens on a 44px row of three icon tabs, Changes, Files and Pull request, each named for tooltips and screen readers, with Hide the rail at its right. Changes is the view the window opens on, and the chosen view stays across workspaces, unless a Needs you row or the header's pull request chip opens Pull request. Changes starts with a wide segmented control for Branch and Uncommitted, then a line naming the base as the words from and its name in `dim` Geist Mono, shown in the Branch view and held in place unseen in Uncommitted, with the control for Side by side and Inline at its right only where the diff pane is wide enough for two sides, since a narrower pane draws inline whatever was chosen. Send lines is the small secondary button in a footer under the diff, disabled when no diff shows. Below it the file list sits at 260px on the left, or above the diff, at most 40% of the height, when the column is under 640px. A row is 28px with the Git letter in Geist Mono 12, `addfg` for added and `delfg` for deleted and `dim` for the rest, the folder in `dim` giving way from its start so the file name in `fg` always shows, and the counts as +n in `addfg` and −n in `delfg`. The selected row takes `sel`. The diff reads the app tokens, `add` and `del` for lines, `addfg` and `delfg` at low alpha for changed words, and syntax in weight and greys only, keywords `fg` bold, strings and numbers `fg2` and comments `dim` italic, since colour means state. A moved base that conflicts shows one grey strip on `side` under the bar, `fg2` at 13px with the files in Geist Mono, never signal, because the agent can fix it without you, and its button is the secondary Send to Claude Code. A sentence that replaces a diff or a list is centred, `fg2` at 13px, in a column of at most 360px. The workspace header is a 48px bar at the top of the centre. Its heading is the repo in `dim`, a `/` and the workspace in `fg` semibold at 14px, or the repo alone for its main workspace. After it it names the branch, from and the base in `dim` Geist Mono and the ahead and behind as a Geist Pixel readout like ↑2 ↓1, when it has room, and Remove this repo gives way first, staying in the command menu. A repo whose folder is missing always keeps it.
- The Files view's bar holds Send lines and Find a file at the right, and the tree fills the rest of the rail. A file picked in the tree or found by name opens as a tab in the centre's strip beside the sessions. Tree rows are 28px with a chevron for a folder, 12px of indent per level and an icon for the kind, the name in Geist Mono 12. Everything on disk is listed and only `.git` stays out. Ignored entries are dimmed, the name in `dim` and the icon at half strength, never hidden. A changed file carries its Git letter in Geist Mono 12, and the letter and the name take the colour the Changes list gives that letter, `addfg` for added and `delfg` for deleted, with every other letter in `dim`, so modified is never drawn as added. File kind icons carry the colours of their icon set, near-signal orange ones included, since colour elsewhere means state, and signal orange as a state colour appears only on status marks, never beside a name. The viewer is the read-only editor of the diff with one side, drawn in the same weights and greys. An image is drawn fitted and never scaled up, centred on a checkerboard of `line` and `raised` so transparency shows, with its size in pixels in `fg2` at 12px under it. A sentence that replaces a file or a list is centred, `fg2` at 13px, in a column of at most 360px. A sentence about one folder sits in the tree under its row in `dim` at 12px. The finder is the palette's third mode, a result row with the file's icon, its name in `fg` and its folder in `dim` giving way from its start, so the nearest folders stay readable and the full path is in the tooltip.
- The Pull request view is the rail's third tab and carries the number in its name once there is one. Its bar holds Open on GitHub at the right once there is a pull request, then the title at 15px semibold, a line with a 6px state pixel, the number as a Geist Pixel readout, the state word, the checks summary and the head into base in `dim` Geist Mono, then a strip of the sections Overview, Checks, Conversation and Files, a 36px tab list with the arrow keys, Home and End moving between them, and a scrolling body. Overview shows Merge, Description and Commits as 10px uppercase labels. A merge row is a 6px pixel and one sentence, signal only for what needs the user, volt for nothing blocks it and lilac for merged. Every state without a pull request is one centred sentence, with no button on a default or target branch, in `fg2` at 13px that names the fix, never in signal because none is an error, and a quiet grey strip above a kept answer says when a refresh failed. The row readout in the sidebar is the pixel and `#n`, and the header's is a chip in the pixel's colour that adds the state word and the checks summary when it has room, both carrying the number, state and summary in their tooltip and accessible name. While the conversation is read, Conversation shows the review decision the overview already knows above one quiet reading sentence. Checks is a list of rows, each a 6px result pixel, the check's name, its workflow in `dim`, the result as a Geist Pixel readout and at the right Show failing lines, Send to Claude Code and Open on GitHub or Open check details, a failed one opening its failing lines in a mono block of at most 256px that scrolls. A result is signal for failed, ultraviolet for running, volt for passed and grey for skipped, cancelled and unknown. Conversation is one list, unresolved threads first with the Unresolved and Outdated badges as Geist Pixel readouts, then reviews and comments by time with the author in `fg` medium, outside the repository in `dim` after an author with no standing in it who is not the user, and the date in `dim`, then resolved threads as closed disclosures, and under a long list a secondary Show n more button that draws the next part. A body reads as Markdown at 13px in `fg2` with headings at 15px and under, lists, quotes, tables, code in `side` with a `ctl` border and a link as underlined `fg` text, never a colour. A body drawn as plain text shows its mono source under one quiet sentence. Files keeps the Changes list at 240px beside a read-only diff that is always inline, a note above them in `dim` that names the base, and under the diff a Threads in this file panel of at most 45% of the height, with the group Not on a line here only beside marked threads. A thread mark is a 10px ring in `accent` in the diff's glyph margin, filled while the thread is unresolved and open, and it never uses signal. The selected thread takes `sel`.
- Running processes show as a count readout, the `running` line icon, a play triangle, and the number in Geist Pixel 12 in `dim`, as the workspace row's readout when it has no pull request and in the header as a 24px button, both only above 0, and both carrying `1 running process` or `n running processes` in their tooltip and accessible name. The button opens the kit's dialog, titled Running processes with one sentence under it. Each row is divided from the next by a `line` hairline with 8px of padding between rows, and holds the command in Geist Mono 12 in `fg`, wrapping at path separators and spaces and in full in its tooltip, then under it at 12px the session in `dim`, the age as a Geist Pixel readout in capitals, `12S`, `3M`, `2H 05M` or `1D 4H`, and each port as a Geist Pixel readout like `:3000`. The age counts up every second while the list is open, in tabular digits so nothing moves. A port with an address is a text link with the focus ring, named Open port 3000 in your browser, which asks in a dialog over the list and returns focus to that port when it closes, and a port without one is plain `dim` text with its reason in the tooltip. At the right of the row Stop is the kit's small secondary button, never signal orange, since a running process is not a need, and it reads Stopping… while it works and leaves the other Stop buttons disabled. A sentence for nothing running, for a failed stop or for a list that could not be read is `dim` at 12px, and the detached process sentence always closes the list. Done is the primary button.
- The first-run guide is one card beside the real control it explains, never a scrim and never a spotlight, so the app stays usable under it. The card is 300px wide on `raised` with a `line` border, a 10px corner and the one shadow, and sits 32px from the control, 28px from its ring. The ring is a 1px `fg2` border 4px outside the control with an 8px corner, and the tail is three 4px `fg2` squares in a row from the card's edge towards the ring, 28px from the card's corner with its middle on the control's middle. Ring and tail stay grey in both themes, and signal orange appears once, on the needs you pixel of the legend. The card holds a readout in Geist Pixel 12 in `dim` such as `01 / 04`, with the close control, a 24px ghost button, at its right, the title in Funnel Display 20 at 700, lowercase with no full stop, one sentence in `fg2`, and on the last step the legend of idle, working, needs you and done as 6px status pixels in two columns. Next is the secondary button, so the real control stays the main action, and Done is the primary. The card keeps one side of its control per step, right, left or below, never covers the control and stays at least 8px inside the window, and a control that is not on screen shows no card. The card draws the standard 2px focus ring while it holds keyboard focus, which only Show the guide gives it, and shows none when it appears by itself or is pressed with the mouse. Nothing animates.
- Settings is the kit's dialog, titled Settings, with Done as its one primary button and no Save, since every choice applies at once. Its body is one scrolling column of sections, each headed in Funnel Display 15 at 700 in lowercase, appearance, notifications, tools, guide, keyboard shortcuts and about, divided by a `line` hairline. A setting is its name in `fg` at 13px over one sentence in `dim` at 12px, with its control at the right, a segmented control for a choice of two or three, a select for a longer list such as the theme, and a small secondary button for an action, wrapping under the words when the dialog is narrow. Tools draws the first-run check's rows, count and Check again unchanged. A shortcut row is the command's title in `fg2` beside its framed key hint, 28px tall. About names Satellite and its version in `fg`, the licence in `dim` and two small secondary buttons that open their address through the link dialog. Nothing in it uses signal orange but the pixel of a tool check that fails.
- A link from the terminal opens a small dialog first, Open this link, with the site above the full address in Geist Mono, Cancel with focus beside Open in browser on the right.
- A moment Satellite draws is one sentence in the pane on `bg`, in `fg2`, above the button that starts a fresh session. A workspace that resumes by itself draws its terminal with no offer first. The resume offer, shown whenever a workspace with a conversation to resume does not resume by itself, such as once its last tab closes or at the limit of open sessions, where the limit sentence takes the place of the usual one, pairs Resume session with a secondary Start a new session. When Claude Code is missing no tab or terminal is drawn, and the install step sits between the sentence and Start Claude Code.

The theme follows the system unless the user chooses light, dark or a curated theme in Settings or the command menu, and the choice is remembered. The terminal, the code viewer, the diff and the native dialogs switch with it.

## Curated themes

A curated theme is a published colour theme Satellite ships whole, in the standard colour theme format with its `colors` and `tokenColors`, nothing retyped. Adding one is its file and one entry in `src/shared/themes/curated-themes.ts`, which names it, credits its makers, links its site and carries its licence for the notices. Satellite light and Satellite dark keep the look above, and a curated theme replaces every token from its own colours so the whole window looks like the code editor does with it.

- One mapping turns any curated theme into the tokens, in `theme-look.ts`. A colour with alpha is laid over the ground it sits on, so every token is opaque.
- Each theme names the six colours that carry state, working, needs you, ready, done, idle and destructive, as keys of its own `colors`, so the states keep their meaning in its palette.
- Syntax takes the theme's own `tokenColors`, matched by the theme's grammars, and the code viewer and the diff take its `colors`, so lines read exactly as the theme draws them. The terminal takes its `terminal.*` colours, and in every theme, Satellite's own included, it lifts any text that reads under 4.5 to 1 against its cell's ground.
- Colouring never holds the window. A line longer than its grammar's measured limit, the rest of a file once a second of colouring is spent, and a language without a grammar whose licence lets Satellite ship it all show as plain text in the theme's text colour.
- The window frame, the title bar overlay and the native dialogs follow the theme's type, light or dark.
- A colour the theme defines for a thing is used as published, so a pair the theme itself draws below 4.5 to 1 stays its makers' choice, outside the terminal's floor.
- Where Satellite draws on a surface the theme has no key for, or pairs two theme colours the theme never pairs, the mapping reaches 4.5 to 1 for text and 3 to 1 for status pixels and the focus ring on their ground. It takes the theme's own key first, like the selection's own foreground on a selected row, as long as `fg`, `fg2` and `dim` keep their order, and only then mixes the theme's text colour into the colour until the pair passes, or black or white where the text colour itself falls short on that ground.
- Text and pixels on `raised`, `sel` and `hover` take those floored values through scoped tokens, so `dim` on a selected Dracula row is its own blue-grey lifted to the bar, still below `fg2`. `raised` is the first of its keys that differs from `side`, so a dialog stands off the sidebar. A control edge stays as quiet as Satellite's own, which measure 1.34 to 1.48 to 1 on `bg`, `side` and `raised`. `ctl` takes the theme's own border as published once it reaches 1.3 to 1 against all three, and otherwise mixes the text colour into `side` in small steps until it first does, landing just above 1.3. The focus ring, `accent`, takes `focusBorder` once it reaches 3 to 1 against the same three and otherwise mixes it toward the text colour until it does. A control is told apart by its quiet edge, its label or placeholder, and the focus ring when focused.
- `theme-look.test.ts` measures every pair for every curated theme and lists the ones still under the bar. For Dracula those are `dim` on `bg` at 3.03 and on `side` at 3.36, its line numbers on the editor and its inactive tab text on its tab, both drawn so by the theme.
- Each theme picks its state colours so the states a person tells apart at a glance also differ in brightness, as Satellite's own do. Dracula's working is its bright cyan, ready its green and done its purple.

| Token | From the theme's `colors`, first one present | Otherwise |
| --- | --- | --- |
| `bg` | `editor.background` over black for a dark theme or white for a light one | required |
| `win` | `sideBar.background` | `bg` |
| `side` | `sideBar.background` | `bg` |
| `raised` | `quickInput.background`, `editorWidget.background`, `dropdown.background`, `editor.background`, the first that differs from `side` | `side` |
| `sel` | `list.activeSelectionBackground` over `side` | `fg` at 16% over `side` |
| `hover` | `list.hoverBackground` over `side` | `fg` at 8% over `side` |
| `line` | `sideBar.border`, `tab.border`, `editorGroup.border` over `side` | `fg` at 12% over `side` |
| `ctl` | `input.border`, `dropdown.border`, `settings.textInputBorder` over `side`, the first at 1.3 to 1 against `side`, `raised` and `bg` | `fg` mixed into `side` until it is |
| `fg` | `foreground`, `editor.foreground` | required |
| `fg2` | `descriptionForeground` | `fg` at 70% |
| `dim` | `tab.inactiveForeground`, `editorLineNumber.foreground` | `fg` at 50% |
| `add` / `del` | `diffEditor.insertedLineBackground` / `diffEditor.removedLineBackground` over `bg` | the format's own line defaults, as the diff draws them |
| `addfg` / `delfg` | `gitDecoration.addedResourceForeground`, `gitDecoration.untrackedResourceForeground` / `gitDecoration.deletedResourceForeground` | ready / destructive |
| `accent` | `focusBorder`, mixed toward `fg` until it reaches 3 to 1 against `bg`, `side` and `raised` | working, the same way |
| `on-accent` | white or black, whichever passes on `accent`, worked out in `app.css` from the relative luminance so it reads at 4.58 to 1 or better | |
| `pri-bg` / `pri-fg` | `button.background` / `button.foreground` | working / `fg` |
| `signal`, `sigfg` | needs you | required |
| `volt`, `volt-edge` | ready, with a light theme's edge mixed toward `fg` to 3 to 1 on `bg` and `side` | required |
| `lilac`, `lilac-edge` | done, with the same edge on a light theme | required |
| `working`, `idle`, `danger` | working, idle, destructive | required |
| selection | `selection.background`, `editor.selectionBackground` | `fg` at 30% |

The shadow keeps Satellite's value for the theme's type, and the title bar overlay takes `win` with `fg2` for its symbols.

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
