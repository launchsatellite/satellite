# 015 Layout

Status **Draft** · Depends on **002 to 014**

## Why

The work happens in Claude Code, yet the window gives it a side column while the centre holds a file tree and a copy of GitHub. People who run several agents watch the agent all day, glance at what changed and ask one question of a pull request, what still blocks it. They also want every agent of a repository in view at once instead of switching between workspaces. Layout puts the agent in the centre, folds the repository views into a slim rail, and lets one click show every live agent of a repository.

## Scope

[mockup.html](mockup.html) draws every screen in dark and light, and BRAND.html shows it as chapter 12. Where the drawing and this spec differ, the spec wins.

Layout owns the frame of the window, the rail, the repo view and the kit. Each feature it moves keeps its own spec, and the change to each is proposed under that spec's Next.

**Window**
- A new ground token `win` carries the sidebar and the rail. The centre is one raised surface on `bg` with a hairline, a 10px corner and 8px from the window edges.
- Columns are the sidebar at 252, the centre and the rail at 348. Both side columns resize within limits and hide, the sidebar on Cmd+B as today and the rail on Cmd+E, Ctrl+Shift+E on Windows and Linux. Under 1100px of window the rail folds to its icons, and the window never goes under 960. Widths and hidden states come back after a restart. With the sidebar hidden, the centre header becomes the top row. On macOS it keeps 76px clear at its left for the traffic lights, and its empty space is the drag area. On Windows and Linux the window buttons sit wherever the system puts them, on the right or, on some Linux desktops, the left, and the top row they overlap, sidebar, rail or centre header, keeps clear the area the system reports for them through `env(titlebar-area-*)`.

**Centre**
- The selected workspace shows a 48px header with the repo and workspace name, the branch with ahead and behind, the running processes readout and the pull request chip, then one tab strip holding its Claude Code sessions and any file or diff opened from the rail.
- Clicking a repo row opens the repo view. Every workspace of that repo with an open session shows its selected session as a live tile. Grid lays tiles out side by side and two by two while each keeps at least 64 columns and 24 rows. Otherwise Focus gives one tile the stage and lists the others in a 230px strip as state cells, needs you first. The focused tile has an ultraviolet edge, is named to screen readers and takes the typing. Cmd+1 to 9 focus a tile, Cmd+Enter makes the focused tile fill the centre and brings the view back, Ctrl+Shift with the same keys on Windows and Linux. Opening the repo view starts nothing.

**Rail**
- Three icon tabs, Changes, Files and Ready, each named for tooltips and screen readers, the tab holding what needs you marked with a signal pixel. The rail follows the selected workspace, or the focused tile in the repo view. What each tab shows lives in 006, 007 and 008.

**Pages and overlays**
- Anything with sections or forms is a page in the centre or, for Settings, the whole window. A page keeps a way back and lets a needs you through as a toast.
- A dialog is only for one quick decision, archive and remove a repo with what would be lost, quit while agents run, and opening a link or a port. A short list tied to a control is a popover. The command menu is the one overlay a person summons, and it lists workspaces and commands together.

**Kit**
- Key hints are plain Geist Mono in `dim`, never boxed. Labels are sentence case. Chips carry state with a tinted edge and text. The segmented control is a sunken track with a raised choice. The kit adds the rail tab, the Ready card, the tile and the page.
- Shortcuts keep today's rule, one key with Cmd on macOS and Ctrl+Shift on Windows and Linux, so Escape, plain Ctrl keys and Alt always reach Claude Code.

**Changes to other specs, proposed under their Next**
- 002 Projects become Repos, the new sidebar, the repo row opens the repo view.
- 003 New workspace becomes a centre page with a request box.
- 004 Sessions move to the centre, a typed request becomes the first message, tiles in the repo view.
- 005 The inbox becomes the Needs you group, Cmd+J goes to what needs you.
- 006 Changes moves into the rail, the full diff opens as a centre tab.
- 007 Files moves into the rail, a file opens as a centre tab.
- 008 The Pull request tab becomes Ready.
- 009 Running processes become a popover.
- 010 The guide points at the controls in their new places.
- 011 The title bar strip goes.
- 012 Settings becomes a full window page.
- 013 The `win` ground takes the theme's sidebar colour.
- 014 Agents becomes a centre page.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Claude Code in the centre | Repository views in the centre, agent on the right | The agent is what people watch all day, the repository is what they glance at. |
| Ready, what blocks the merge | The Pull request tab with Overview, Checks, Conversation and Files | Those sections copy a page GitHub draws better. Satellite answers the one question GitHub buries and links to the rest. |
| Nothing blocks the merge | Ready to merge, or a merge button | Green checks are not a review, so Satellite never calls a pull request safe and merging stays a person's decision on GitHub. |
| A repo view of live tiles | Split two sessions, or a board of cards | Seeing and answering every agent of a repository at once is the need. Cards would mean reading terminal output, which Satellite never does. |
| Strip cells that show state | Shrunken live terminals | A terminal that resizes makes Claude Code redraw, and state is all a glance needs. |
| Pages for anything with sections or forms | Dialogs for Settings and New workspace | A page keeps the sidebar and needs you in view and gives the content room. |
| The request as Claude Code's first message | Typing it into the prompt for the person to send | They pressed Create and start with their own words, so sending it is what they asked for. Nothing from GitHub is ever added to it. |
| Go to what needs you on Cmd+J | Next review thread | Threads now live on GitHub, and one key to whatever waits on you serves every workspace. |
| Cmd+E for the rail | Cmd+I | Ctrl+Shift+I opens the developer tools in an unpacked build on Windows and Linux, which is what the journeys run. |
| No search tab | Content search in the rail | The agent already searches, and the command menu finds workspaces and files. |
| Repos | Projects, Spaces, Orbits | It is what developers call a repository, and Spaces would blur with workspaces. |

## Not in scope

Other agents than Claude Code, merging from Satellite, renaming a workspace after it exists, a board, a browser, a chat interface, content search, bulk archive and notifications other than needs you.

## Acceptance

A Satellite feature is accepted on macOS, Windows and Linux, in light, dark and a curated theme. The acceptance of each moved feature lives in its own spec.

- [ ] A workspace shows its sessions in the centre and Changes, Files and Ready in the rail, and the rail and sidebar hide and fold at the widths above. Proof, scenario `default` and a journey resizing the window.
- [ ] Clicking a repo shows every workspace with a session as tiles, Grid falls back to Focus when tiles would go under 64 by 24, typing reaches only the focused tile, and Cmd+1 to 9 and Cmd+Enter work. Proof, a new scenario `repo-view` with four sessions and a journey.
- [ ] Escape, plain Ctrl keys and Alt reach Claude Code in a tile and in the single view. Proof, scenario `interrupts` in a tile.
- [ ] Six live sessions in the repo view keep typing as responsive as one, and only visible tiles draw a terminal. Proof, scenario `flood` with a timing check.
- [ ] The only dialogs left are the ones listed, and a needs you arriving on a page shows as a toast. Proof, a check of every dialog in the command registry and scenario `inbox`.
- [ ] DESIGN.md, SATELLITE.md and BRAND.html describe the shipped layout and kit. Proof, review of the docs in the last pull request.

## Open questions

- Specs 004, 011, 012 and 013 are In progress, each waiting on a check by a person on Windows, Linux or a framed window. Those checks close before 011 and 012 change.
- Claude Code receives the first message through its terminal once it is ready, never as a launch argument, since a `.cmd` shim on Windows could misread free text. Confirm against Claude Code's current docs while building.
