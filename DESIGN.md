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
| `sigfg` | `#FF5A1F` | `#BE400C` | Signal as text, and the inner edge of the needs you pixel |
| `add` / `addfg` | `#15122B` / `#A493FF` | `#EEEBFF` / `#4A2EE0` | Added lines |
| `del` / `delfg` | `#2A130B` / `#FF8A5C` | `#FFEDE6` / `#BE400C` | Removed lines |
| `accent` | `#6A4BFF` | `#6A4BFF` | Working, the main action, focus |
| `signal` | `#FF5A1F` | `#FF5A1F` | Needs you |
| `pri-bg` / `pri-fg` | `#F4F4F1` / `#08080A` | `#0A0A0B` / `#F4F4F1` | Primary button |
| `volt` / `volt-edge` | `#DCFF3D` / `#DCFF3D` | `#DCFF3D` / `#6B7800` | Ready and passing, with the inner edge that keeps a volt pixel visible on light |
| `lilac` / `lilac-edge` | `#C7B9FF` / `#C7B9FF` | `#C7B9FF` / `#8066D6` | Merged, approved, secondary state, with the darker lilac that keeps a small lilac shape visible on light |
| `working` | `#6A4BFF` | `#6A4BFF` | The working pixel |
| `idle` | `#82828A` | `#68686F` | The idle pixel |
| `danger` | `#FF5A1F` | `#BE400C` | Destructive actions, errors and their pixels, so an error toast's pixel is `#BE400C` in light |
| `shadow` | `0 16px 40px rgb(0 0 0 / 0.55)` | `0 16px 40px rgb(10 10 11 / 0.12)` | The one shadow, on menus, the palette, dialogs, toasts and the guide card |

Every text pair in use passes WCAG AA at 4.5 to 1, measured with the WCAG formula, the closest being light `sigfg` and `delfg` on `sel` at 4.51. On light grounds the volt, done and needs you pixels get a 1.5px inner edge, `volt-edge`, `lilac-edge` and `sigfg`, so each pixel measures at least 3 to 1 on `bg`, `side`, `sel` and `hover`, the lowest being lilac on `sel` at 3.7. In dark the edges equal their fills. Shapes too small for an edge, like the cells of a project avatar, draw volt and lilac in their edge colours, `volt-edge` and `lilac-edge`, which pass 3 to 1 against `side` and `sel` in both themes.

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
- Only menus, the palette, dialogs, toasts and the guide card cast a shadow.

## Components

BRAND.html chapter 08 Kit draws every part in dark and light. Atoms are buttons, inputs, checkbox, radio, toggle, tags, counters, key hints, avatars, the pixel spinner for network work, block progress and readouts. Molecules are sidebar rows, tabs (session tabs and open file tabs), segmented control, menu, needs you card, toast, agent log, diff and checks. Organisms are the palette, dialogs and the pull request card.

- Focus is an ultraviolet ring, 2px on buttons and a soft 3px glow on inputs.
- Every enabled control shows the pointer, the selected row and tab included, so a selection never reads as switched off. That covers buttons, tabs, list and tree rows, palette options, selects and the thread marks in a diff's gutter. A disabled control keeps the arrow, never a not allowed sign, which the system keeps for a drop that cannot land. Text fields, the terminal and read-only code keep the text cursor, a link in the terminal shows the pointer, the column dividers show the resize cursor and the title bar's drag area the arrow.
- Selection is a grey fill. The active row of the palette adds a 1px ultraviolet inset outline, so it reads at 3 to 1. The menu hover is the one place ultraviolet fills a row.
- The segmented control is a radio group, a 28px track on `side` with a `ctl` border and a 6px corner, each option 24px with the chosen one on `sel` in `fg` and the others in `fg2`, taking `hover` under the pointer. The arrow keys move the choice and its focus, and only the chosen option is in the tab order.
- A close button on a tab is a 24px target flush with the tab's right edge. Inside it a 20px square, 4px in from that edge, holds the 12px close glyph and the focus ring, so the target meets the small button's size and the tab never grows to hold it. Under the pointer the square fills with `ctl` and the glyph turns `fg`, since `ctl` is the first token that stands out on both the selected tab's `sel` and a hovered tab's `hover`.
- Status is a square pixel, never a dot.
- One primary action per view.
- An action that loses work is a danger button, `danger` text on the plain ground with a control border, never a filled one. It replaces the primary action only while something would be lost, as Archive anyway.
- A dialog opens over the window dimmed behind a scrim, takes the keyboard until it closes and ends in a footer on `side` with its actions on the right, Cancel beside the main action, and any note on the left. Escape and a click outside close it only while nothing runs.
- A control's accessible name starts with the text it shows, for a file row its Git letter, path and counts, then says the rest in words, so voice control finds it by what is on screen. The repository column is the window's main landmark.
- Projects get a generated pixel avatar. People show their GitHub avatar, or a pixel one when they have none.

## App

The agent pane always shows the real Claude Code, untouched. Satellite draws only the moments around it, before it is installed, after a session ends or when it stops. Start Claude Code takes focus only after a session you ended, never after a crash or a failed start, so a key pressed while typing starts nothing.

- The title bar is a 40px strip on `side` across the whole window with a `line` hairline under it, and the three columns start below it. On the left, after 80px kept for the traffic lights on macOS and given back in full screen, sits the sidebar toggle, the `sidebar` line icon as the kit's small ghost icon button named Hide the sidebar or Show the sidebar. In the middle the project in `fg` semibold, a `/` in `dim` and the workspace's own name in `fg2`, or the project alone for its main workspace, both at 13px through the visible name rules, centred in the strip, each cut with an ellipsis before it reaches the side controls and with 24px of drag room kept on both sides, or Satellite in `fg2` with nothing selected. The branch shows in the workspace header, never in the strip. On the right the inbox, the bell with its count as a Geist Pixel readout, `sigfg` above 0 and `dim` at 0, then the command menu with the `keys` icon, New workspace with the plus and, at the far end, Open settings with the `settings` sliders, each the kit's small ghost icon button with its command's title and shortcut as its tooltip, dimmed exactly when its command is unavailable. Nothing else goes in the strip. On Windows and Linux the system's window controls draw over its edge in `side` with `fg2` symbols, and the strip keeps its own controls clear of them. The strip is a drag area and every control in it is not, it stops being one while a dialog or the command menu covers it, and its text cannot be selected.
- Sessions are tabs in a 40px bar on `side` above the terminal, each named Session and its number, with its status pixel and a close button shown on the selected tab and on hover, so a tab cut off at the strip's edge never shows a lone one, and a plus at the end that starts another. The arrow keys, Home and End move between tabs and Delete closes one.
- A session's pixel is ultraviolet while it works, signal while it needs you, lilac when it is done and grey while it is idle or stopped. A tab whose hooks seem off keeps its grey pixel and carries one sentence as its tooltip and accessible description, Claude Code's settings seem to keep its hooks off here, so this session never shows needs you, and Send to Claude Code there says the same before Type this one yourself. A workspace row shows the most urgent of its sessions, needs you before working before done.
- The inbox sits at the top of the sidebar under the command rows. Its header is the dim uppercase label Inbox with a bell icon, and on its right the count as a Geist Pixel readout, in `sigfg` while something needs you and in `dim` at 0. Each row is a 6px signal pixel beside the workspace name in `fg` on its own line, wrapping in full however long it is, so two rows never read the same. Below it the project in `dim`, drawn as the cleaned name a notification shows so no direction mark can disguise it, truncated when it runs out of room, then one sentence in `fg2`, Claude Code needs you., Session 2 needs you., 3 sessions need you., Checks failed on the pull request., A review asks for changes., The pull request has conflicts. or The pull request needs you., which moves to its own line when the project leaves it no room. The project gains its parent folder when two project names read the same, your home folder when that parent, or the project itself, is the home folder. The rows sit in a list of at most a third of the window's height that scrolls on its own, so the projects stay in view, and a row that takes keyboard focus scrolls into view. The row's tooltip and accessible name read the workspace, the project and the sentence. With nothing listed the inbox says Nothing needs you right now. in `dim`.
- The centre column opens on a 40px bar on `side`, a tab strip with the tabs Changes, Files and Pull request, then at the right Send lines, a segmented control for Branch and Uncommitted and one for Side by side and Inline, which only shows while a diff has room for two sides. The bar wraps onto a second row instead of clipping, and Send lines stays, disabled when no diff shows. The layout control appears only where the diff pane is wide enough for two sides, since a narrower pane draws inline whatever was chosen. The bar also names the base as the words from and its name in `dim` Geist Mono, shown in the Branch view and held in place unseen in Uncommitted. Below it the file list sits at 260px on the left, or above the diff, at most 40% of the height, when the column is under 640px. A row is 28px with the Git letter in Geist Mono 12, `addfg` for added and `delfg` for deleted and `dim` for the rest, the folder in `dim` giving way from its start so the file name in `fg` always shows, and the counts as +n in `addfg` and −n in `delfg`. The selected row takes `sel`. The diff reads the app tokens, `add` and `del` for lines, `addfg` and `delfg` at low alpha for changed words, and syntax in weight and greys only, keywords `fg` bold, strings and numbers `fg2` and comments `dim` italic, since colour means state. A moved base that conflicts shows one grey strip on `side` under the bar, `fg2` at 13px with the files in Geist Mono, never signal, because the agent can fix it without you, and its button is the secondary Send to Claude Code. A sentence that replaces a diff or a list is centred, `fg2` at 13px, in a column of at most 360px. The workspace header is a 40px bar like the others. Its heading, the project and workspace the title bar already shows, is for screen readers only. It names the branch, from and the base in `dim` Geist Mono and the ahead and behind as a Geist Pixel readout like ↑2 ↓1, when it has room, and Remove this project gives way first, staying in the command menu. A project whose folder is missing always keeps it.
- The Files tab keeps the centre bar, with the tabs Changes, Files and Pull request, then Send lines and Find a file at the right. Below it the tree sits at 260px on the left, or above the viewer at most 40% of the height when the column is under 640px and a file is open, and the whole height while none is, and the viewer has a 32px strip of open files above it. Tree rows are 28px with a chevron for a folder, 12px of indent per level and an icon for the kind, the name in Geist Mono 12. Everything on disk is listed and only `.git` stays out. Ignored entries are dimmed, the name in `dim` and the icon at half strength, never hidden. A changed file carries its Git letter in Geist Mono 12, and the letter and the name take the colour the Changes list gives that letter, `addfg` for added and `delfg` for deleted, with every other letter in `dim`, so modified is never drawn as added. File kind icons carry the colours of their icon set, near-signal orange ones included, since colour elsewhere means state, and signal orange as a state colour appears only on status marks, never beside a name. A file tab is 24px in a 32px strip on `side`, at most 180px wide, with a close button on the selected tab and on hover, and two open files with the same name show their parent folder in `dim` after the name, and only then. The viewer is the read-only editor of the diff with one side, drawn in the same weights and greys. An image is drawn fitted and never scaled up, centred on a checkerboard of `line` and `raised` so transparency shows, with its size in pixels in `fg2` at 12px under it. A sentence that replaces a file or a list is centred, `fg2` at 13px, in a column of at most 360px. A sentence about one folder sits in the tree under its row in `dim` at 12px. The finder is the palette's third mode, a result row with the file's icon, its name in `fg` and its folder in `dim` giving way from its start, so the nearest folders stay readable and the full path is in the tooltip.
- The Pull request tab is the third tab and carries the number once there is one. It keeps the centre bar with Open on GitHub at the right, then the title at 15px semibold, a line with a 6px state pixel, the number as a Geist Pixel readout, the state word, the checks summary and the head into base in `dim` Geist Mono, then a strip of the sections Overview, Checks, Conversation and Files, a 36px tab list with the arrow keys, Home and End moving between them, and a scrolling body. Overview shows Merge, Description and Commits as 10px uppercase labels. A merge row is a 6px pixel and one sentence, signal only for what needs the user, volt for nothing blocks it and lilac for merged. Every state without a pull request is one centred sentence, with no button on a default or target branch, in `fg2` at 13px that names the fix, never in signal because none is an error, and a quiet grey strip above a kept answer says when a refresh failed. The row readout in the sidebar and the header readout are the pixel and `#n`, and the header one adds the state word and the checks summary when it has room, both carrying the number, state and summary in their tooltip and accessible name. While the conversation is read, Conversation shows the review decision the overview already knows above one quiet reading sentence. Checks is a list of rows, each a 6px result pixel, the check's name, its workflow in `dim`, the result as a Geist Pixel readout and at the right Show failing lines, Send to Claude Code and Open on GitHub or Open check details, a failed one opening its failing lines in a mono block of at most 256px that scrolls. A result is signal for failed, ultraviolet for running, volt for passed and grey for skipped, cancelled and unknown. Conversation is one list, unresolved threads first with the Unresolved and Outdated badges as Geist Pixel readouts, then reviews and comments by time with the author in `fg` medium, outside the repository in `dim` after an author with no standing in it who is not the user, and the date in `dim`, then resolved threads as closed disclosures, and under a long list a secondary Show n more button that draws the next part. A body reads as Markdown at 13px in `fg2` with headings at 15px and under, lists, quotes, tables, code in `side` with a `ctl` border and a link as underlined `fg` text, never a colour. A body drawn as plain text shows its mono source under one quiet sentence. Files keeps the Changes list at 240px beside a read-only diff that is always inline, a note above them in `dim` that names the base, and under the diff a Threads in this file panel of at most 45% of the height, with the group Not on a line here only beside marked threads. A thread mark is a 10px ring in `accent` in the diff's glyph margin, filled while the thread is unresolved and open, and it never uses signal. The selected thread takes `sel`.
- Running processes show as a count readout, the `running` line icon, a play triangle, and the number in Geist Pixel 12 in `dim`, on the workspace row beside its pixel and in the header as a 24px button, both only above 0, and both carrying `1 running process` or `n running processes` in their tooltip and accessible name. The button opens the kit's dialog, titled Running processes with one sentence under it. Each row is divided from the next by a `line` hairline with 8px of padding between rows, and holds the command in Geist Mono 12 in `fg`, wrapping at path separators and spaces and in full in its tooltip, then under it at 12px the session in `dim`, the age as a Geist Pixel readout in capitals, `12S`, `3M`, `2H 05M` or `1D 4H`, and each port as a Geist Pixel readout like `:3000`. The age counts up every second while the list is open, in tabular digits so nothing moves. A port with an address is a quiet link, `fg` and underlined with a 4px hover pad and the focus ring, named Open port 3000 in your browser, which asks in a dialog over the list and returns focus to that port when it closes, and a port without one is plain `dim` text with its reason in the tooltip. At the right of the row Stop is the kit's small secondary button, never signal orange, since a running process is not a need, and it reads Stopping… while it works and leaves the other Stop buttons disabled. A sentence for nothing running, for a failed stop or for a list that could not be read is `dim` at 12px, and the detached process sentence always closes the list. Done is the primary button.
- The first-run guide is one card beside the real control it explains, never a scrim and never a spotlight, so the app stays usable under it. The card is 300px wide on `raised` with a `line` border, a 10px corner and the one shadow, and sits 32px from the control, 28px from its ring. The ring is a 1px `fg2` border 4px outside the control with an 8px corner, and the tail is three 4px `fg2` squares in a row from the card's edge towards the ring, 28px from the card's corner with its middle on the control's middle. Ring and tail stay grey in both themes, and signal orange appears once, on the needs you pixel of the legend. The card holds a readout in Geist Pixel 12 in `dim` such as `01 / 04`, with the close control, a 24px ghost button, at its right, the title in Funnel Display 20 at 700, lowercase with no full stop, one sentence in `fg2`, and on the last step the legend of idle, working, needs you and done as 6px status pixels in two columns. Next is the secondary button, so the real control stays the main action, and Done is the primary. The card keeps one side of its control per step, right, left or below, never covers the control and stays at least 8px inside the window, and a control that is not on screen shows no card. The card draws the standard 2px focus ring while it holds keyboard focus, which only Show the guide gives it, and shows none when it appears by itself or is pressed with the mouse. Nothing animates.
- Settings is the kit's dialog, titled Settings, with Done as its one primary button and no Save, since every choice applies at once. Its body is one scrolling column of sections, each headed in Funnel Display 15 at 700 in lowercase, appearance, notifications, tools, guide, keyboard shortcuts and about, divided by a `line` hairline. A setting is its name in `fg` at 13px over one sentence in `dim` at 12px, with its control at the right, a segmented control for a choice of two or three, a select for a longer list such as the theme, and a small secondary button for an action, wrapping under the words when the dialog is narrow. Tools draws the first-run check's rows, count and Check again unchanged. A shortcut row is the command's title in `fg2` beside its framed key hint, 28px tall. About names Satellite and its version in `fg`, the licence in `dim` and two small secondary buttons that open their address through the link dialog. Nothing in it uses signal orange but the pixel of a tool check that fails.
- A link from the terminal opens a small dialog first, Open this link, with the site above the full address in Geist Mono, Cancel with focus beside Open in browser on the right.
- A moment Satellite draws is one sentence in the pane on `bg`, in `fg2`, above the button that starts a fresh session. The resume offer pairs Resume session with a secondary Start a new session. When Claude Code is missing no tab or terminal is drawn, and the install step sits between the sentence and Start Claude Code.

The theme follows the system unless the user chooses light, dark or a curated theme in Settings or the command menu, and the choice is remembered. The terminal, the code viewer, the diff and the native dialogs switch with it.

## Curated themes

A curated theme is a published colour theme Satellite ships whole, in the standard colour theme format with its `colors` and `tokenColors`, nothing retyped. Adding one is its file and one entry in `src/shared/themes/curated-themes.ts`, which names it, credits its makers, links its site and carries its licence for the notices. Satellite light and Satellite dark keep the look above, and a curated theme replaces every token from its own colours so the whole window looks like the code editor does with it.

- One mapping turns any curated theme into the tokens, in `theme-look.ts`. A colour with alpha is laid over the ground it sits on, so every token is opaque.
- Each theme names the six colours that carry state, working, needs you, ready, done, idle and destructive, as keys of its own `colors`, so the states keep their meaning in its palette.
- Syntax takes the theme's own `tokenColors`, matched by the theme's grammars, and the code viewer and the diff take its `colors`, so lines read exactly as the theme draws them. The terminal takes its `terminal.*` colours.
- Colouring never holds the window. A line longer than its grammar's measured limit, the rest of a file once a second of colouring is spent, and a language without a grammar whose licence lets Satellite ship it all show as plain text in the theme's text colour.
- The window frame, the title bar overlay and the native dialogs follow the theme's type, light or dark.
- A colour the theme defines for a thing is used as published, so a pair the theme itself draws below 4.5 to 1 stays its makers' choice.
- Where Satellite draws on a surface the theme has no key for, or pairs two theme colours the theme never pairs, the mapping reaches 4.5 to 1 for text and 3 to 1 for control edges and status pixels on their ground. It takes the theme's own key first, like the selection's own foreground on a selected row, as long as `fg`, `fg2` and `dim` keep their order, and only then mixes the theme's text colour into the colour until the pair passes.
- Text and pixels on `raised`, `sel` and `hover` take those floored values through scoped tokens, so `dim` on a selected Dracula row is its own blue-grey lifted to the bar, still below `fg2`. `raised` is the first of its keys that differs from `side`, so a dialog stands off the sidebar, and fields and selects get a `ctl` edge at 3 to 1 against `side`, `raised` and `bg`.
- `theme-look.test.ts` measures every pair for every curated theme and lists the ones still under the bar. For Dracula those are `dim` on `bg` at 3.03 and on `side` at 3.36, its line numbers on the editor and its inactive tab text on its tab, both drawn so by the theme.
- Each theme picks its state colours so the states a person tells apart at a glance also differ in brightness, as Satellite's own do. Dracula's working is its bright cyan, ready its green and done its purple.

| Token | From the theme's `colors`, first one present | Otherwise |
| --- | --- | --- |
| `bg` | `editor.background` over black for a dark theme or white for a light one | required |
| `side` | `sideBar.background` | `bg` |
| `raised` | `quickInput.background`, `editorWidget.background`, `dropdown.background`, `editor.background`, the first that differs from `side` | `side` |
| `sel` | `list.activeSelectionBackground` over `side` | `fg` at 16% over `side` |
| `hover` | `list.hoverBackground` over `side` | `fg` at 8% over `side` |
| `line` | `sideBar.border`, `tab.border`, `editorGroup.border` over `side` | `fg` at 12% over `side` |
| `ctl` | `input.border`, `dropdown.border`, `settings.textInputBorder` over `side`, the first at 3 to 1 against `side`, `raised` and `bg` | `fg` mixed into `side` until it is |
| `fg` | `foreground`, `editor.foreground` | required |
| `fg2` | `descriptionForeground` | `fg` at 70% |
| `dim` | `tab.inactiveForeground`, `editorLineNumber.foreground` | `fg` at 50% |
| `add` / `del` | `diffEditor.insertedLineBackground` / `diffEditor.removedLineBackground` over `bg` | the format's own line defaults, as the diff draws them |
| `addfg` / `delfg` | `gitDecoration.addedResourceForeground`, `gitDecoration.untrackedResourceForeground` / `gitDecoration.deletedResourceForeground` | ready / destructive |
| `accent` | `focusBorder` | working |
| `pri-bg` / `pri-fg` | `button.background` / `button.foreground` | working / `fg` |
| `signal`, `sigfg` | needs you | required |
| `volt`, `volt-edge` | ready, with a light theme's edge mixed toward `fg` to 3 to 1 on `bg` and `side` | required |
| `lilac`, `lilac-edge` | done, with the same edge on a light theme | required |
| `working`, `idle`, `danger` | working, idle, destructive | required |
| selection | `selection.background`, `editor.selectionBackground` | `fg` at 30% |

The shadow keeps Satellite's value for the theme's type, and the title bar overlay takes `side` with `fg2` for its symbols.

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
