# 015 Layout, plan

Built on `spec/015-layout-<n>` branches, one worktree each, every pull request squash-merged before the next starts. Each one proves itself in the real app in light, dark and Dracula, runs `./scripts/check`, gets an independent review and CodeRabbit's approval, and fixes every doc and spec it makes wrong. Visual reference is [mockup.html](mockup.html).

## Seams found in the code

- `src/renderer/window/app-window.tsx` holds the window state, the commands and the three columns, `column-projects`, `column-repository` and `column-sessions`.
- `sessions-pane.tsx` mounts a `TerminalView` for every session at once and hides all but one. Unmounting ends the pty, so terminals never move to a new React parent. The repo view lays out those same mounted terminals with CSS.
- `gpu-renderer.ts` takes WebGL when a terminal is seen and releases it when hidden, so visible tiles get WebGL and the others do not.
- `data-testid="terminal"` marks the one shown terminal, and `verify/journeys/conditions.ts` and `verify/terminal-screen.ts` rely on it. Tiles keep it on the focused terminal only.
- `DialogShell` makes every sibling inert and `modal` turns every command off. Pages render in the centre without it.
- `interface.json` is version 5 in `src/main/state/interface-file.ts`, written in three places, with limits in `interfaceLimits` in `src/shared/bridge-contract.ts`.
- The window's minimum width is 960, `src/main/window/main-window.ts`.
- `src/shared/title-bar.ts` sizes the macOS traffic lights and the Windows and Linux overlay buttons.
- Ctrl+Shift+I opens the developer tools in an unpacked build on Windows and Linux, which is what the journeys run, so the rail key is E.

## PR 1 · Agent in the centre

1. Tokens. `win` in `src/renderer/styles/app.css` (dark `#0C0C0E`, light `#F1F1EE`) and its Tailwind colour. In `src/shared/themes/theme-look.ts`, `win` takes `sideBar.background` and `side` moves to the same key, so the sidebar and rail are one ground. Tests in `theme-look.test.ts`.
2. Interface file version 6 in `src/main/state/interface-file.ts` and `src/shared/bridge-contract.ts`. `columns` becomes `{ sidebar, rail }` with limits 200 to 360 starting 252 and 300 to 440 starting 348, plus `rail: "shown" | "hidden"`. Version 5 migrates, its widths clamped into the new limits. A test for the migration.
3. Window. `app-window.tsx` renders the sidebar, the centre as a raised surface (`bg`, hairline, 10 corner, 8 margin) and the rail. `columns.ts` and `column-divider.tsx` take the new names. Test ids become `column-sidebar`, `column-centre`, `column-rail`. Under 1100px the rail folds to its icon row.
4. Centre. `projects/workspace-header.tsx` becomes the 48px header, repo and workspace name, branch with ahead and behind, the processes readout and the pull request chip. Under it one tab strip, `session-tabs.tsx` plus file tabs from `use-file-tabs`, so a file opens beside the sessions. `SessionsPane` moves into the centre without remounting its terminals.
5. Rail. New `src/renderer/rail/rail.tsx` with three icon tabs named for screen readers, Changes, Files and Pull request for now, `rail-tab-*` test ids. `ChangesView` in its narrow layout, the list with the picked file's diff under it. `FilesView` shows the tree, a picked file opens as a centre tab. Command `rail.toggle` on E.
6. Verify. Scenarios keep version 1 interface files, which migrate. Journeys `launch`, `changes`, `files`, `conflicts`, `hostile-file`, `pull-request` and the driver's folder drop move to the new test ids.

Proof. `default`, `two-projects`, `mixed-changes` with screenshots in light, dark and Dracula, the window at 1100 and 1600, all journeys green on the three systems.

## PR 2 · Frame and sidebar

1. Title bar. The strip goes, `title-bar.tsx` is deleted. The sidebar top row is 44px, carries the macOS traffic lights and the sidebar toggle, and is a drag area. With the sidebar hidden the centre header leaves 76px at its left on macOS, and with the rail hidden it leaves room at its right for the Windows and Linux buttons. On Windows and Linux the rail top row ends with room for the overlay buttons. `src/shared/title-bar.ts` and `src/main/platform/title-bar.ts` take the new height 44. The inbox count, commands, new workspace and settings move to the sidebar.
2. Sidebar. Lockup at 17, New workspace as the primary button, one row for the command menu, Needs you on top from `inbox-list.tsx`, then Repos. Sentence-case labels, Agents and Settings in the footer. A row shows one readout, the rest in its tooltip.
3. Words. Project becomes Repo in every string a person sees or hears, in `src/renderer` and in `src/main` notification, menu and dialog text. Test ids and code names stay.
4. Kit. Key hints plain mono in `dim`, the segmented control as a sunken track, a chip part, the icon tab.
5. Verify. The `title-bar` journey becomes a journey for the frame, and the guide and focus fallbacks that used `title-sidebar` move.

Proof. `default`, `title-bar`, `inbox`, `first-run` in light, dark and Dracula, all journeys green on the three systems, a person checks the frame on each system as spec 011 asks.

## PR 3 · Ready

1. The Pull request rail tab becomes Ready, `pull-request/ready-view.tsx`. A card says Nothing blocks the merge or how many things block it, then rows for checks, reviews from owners, members and collaborators, conflicts and unresolved threads, then commits. Failed checks keep their failing lines and Send to Claude Code. Merge on GitHub once nothing blocks, Open on GitHub otherwise.
2. Overview, Conversation, Files and the thread panel go, with the Markdown renderer and worker if nothing else uses them, and the detail fetch they alone needed.
3. Cmd+J becomes `inbox.next`, Go to what needs you, in inbox order. `pull-request.next-thread` goes.
4. Spec 008 rewritten in place from its Next. Spec 005 takes its Cmd+J item.

Proof. `pr-open`, `checks-failed`, `changes-requested`, `pr-conflicts`, `pr-appears`, `hostile-description`, the `pull-request` and `inbox` journeys.

## PR 4 · Pages

1. A page slot in the centre, `window/page.tsx`, with a way back. Pages never use `DialogShell`, so the sidebar stays live and commands stay on. Toasts show above pages.
2. Settings fills the window, its sections in a sidebar under Back to work. Theme is one select holding the curated themes and credits. Cmd+Comma toggles it.
3. Agents is a centre page from `sessions/agent-list.ts`, grouped needs you, nothing blocks, working, done, idle or stopped. Cmd+G opens it and the palette's Agents mode goes.
4. New workspace is a centre page with the request box, repo, starting point and name. Create and start on Cmd+Enter. The request is written to the new session's terminal once Claude Code reports it is ready, with Enter, never as an argument.
5. Running processes become a popover from the header readout.
6. Specs 003, 004, 009, 012 and 014 take their Next into scope.

Proof. `settings`, `settings-files`, `inbox`, `first-run`, `dev-server`, `fresh-repo` with the stand-in recording the first message, journeys `settings`, `processes`, `inbox`, `workspaces`.

## PR 5 · Repo view

1. The selection can be a repo. A click on a repo row selects it and the centre shows the repo view.
2. `SessionsPane` lays out the selected session of every workspace in the repo that has one as tiles with CSS grid, the same mounted terminals, so no session restarts. `repo-view/tile-layout.ts` picks Grid while every tile keeps 64 columns and 24 rows from the measured cell size, otherwise Focus with a 230px strip of state cells. Tested in `tile-layout.test.ts`.
3. One focused tile takes typing, Send to Claude Code and the rail, carries the ultraviolet edge, `aria-current` and the `terminal` test id. Cmd+1 to 9 focus a tile, Cmd+Enter fills the centre and returns.
4. Resizes are debounced, and strip cells never hold a terminal.
5. Specs 002 and 004 take their repo view items.

Proof. New scenario `repo-view` with four sessions in one repo, a `repo-view` journey that focuses, types, fills and returns, `interrupts` in a tile, `flood` with six sessions shown.

## PR 6 · Docs and finish

A last pass over everything.

1. Docs. SATELLITE.md, DESIGN.md, ARCHITECTURE.md, README and its screenshots, CONTRIBUTING.md, AGENTS.md, every skill and BRAND.html chapters 08, 09 and 12 describe the shipped app and nothing else. Specs 002 to 014 take their remaining Next into scope, spec 015 is Done and this plan is deleted.
2. Cleanup. Remove code, test ids, icons, tokens, bridge messages, scenarios, stand-in steps, journey steps and dependencies nothing uses any more, found with a search for every export and id, not by memory. Stale words such as Project, Pull request tab, title bar and Split go from code and docs.
3. Proof. `./scripts/check`, every journey on the three systems, every scenario in light, dark and Dracula, and a fresh read of the docs against the app.

## Risks

- Moving a terminal between React parents ends its session. Every layout uses the mounted terminals.
- Sixteen terminals is the bridge's cap and close to Chromium's WebGL limit, and only visible terminals take WebGL.
- Escape, plain Ctrl and Alt always reach Claude Code, proven by `interrupts`.
- Old interface files must migrate, proven by the scenarios that still seed version 1.
