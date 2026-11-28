# 015 Layout

Status **Draft** · Depends on **002, 003, 004, 005, 006, 007, 008, 009, 012, 014**

## Why

The work happens in Claude Code, yet the window gives it a side column while the centre holds a file tree and a copy of GitHub. People who run several agents watch the agent all day, glance at what changed and ask one question of a pull request, what still blocks it. They also want every agent of a repository in view at once instead of switching between workspaces. Layout puts the agent in the centre, folds the repository views into a slim rail, makes the pull request view answer that one question, and lets one click show every live agent of a repository.

## Scope

**Window**
- A new ground token `win` carries the sidebar and the rail. The centre is one raised surface on `bg` with a hairline, a 10px corner and 8px from the window edges.
- The 40px title bar strip goes. On macOS the traffic lights sit in the sidebar's top row. On Windows and Linux the rail's tab row keeps room for the window buttons and the drag areas move into the sidebar and rail top rows.
- Columns are the sidebar at 252, the centre and the rail at 348. Both side columns resize within limits and hide, the sidebar on Cmd+B as today and the rail on Cmd+I. Under 1100px of window the rail folds to its icons, under 860 the sidebar hides.

**Sidebar**
- The lockup at 17px, then New workspace as the primary button and one row that opens the command menu, which now lists workspaces and commands together. Cmd+P stays as the switcher.
- Needs you sits on top with today's inbox rows, order and rules, then Repos. Projects is called Repos in every word the interface shows. Group labels are sentence case.
- A workspace row keeps its pixel and shows one readout at the right, ahead count, pull request number, Ready, Merged or running processes, with the rest in its tooltip. A folded repo shows its most urgent pixel and how many of its workspaces have a session.
- Agents and Settings sit in the sidebar's footer.

**Centre**
- The selected workspace shows its header, a 48px row with the repo and workspace name, the branch with ahead and behind, the running processes readout and the pull request chip, then one tab strip that holds its Claude Code sessions and any file or diff opened from the rail. Sessions draw exactly as today.
- Clicking a repo row opens the repo view. Every workspace of that repo with an open session shows its selected session as a live tile. Grid lays tiles out side by side and two by two while each keeps at least 64 columns and 24 rows. Otherwise Focus gives one tile the stage and lists the rest in a 230px strip as state cells, needs you first. The focused tile has an ultraviolet edge and takes the typing. Cmd+1 to 9 focus a tile, Cmd+Enter makes the focused tile fill the centre and brings the view back. Opening the repo view starts nothing.

**Rail**
- Three icon tabs, Changes, Files and Ready, each named for tooltips and screen readers, the tab holding what needs you marked with a signal pixel. The rail follows the selected workspace, or the focused tile in the repo view.
- Changes keeps today's list, switches and conflict banner, with the selected file's hunk under the list and Open diff opening the full diff as a centre tab. Send lines keeps Cmd+L.
- Files keeps today's tree with Find a file on Cmd+F. A file opens as a centre tab.
- Ready replaces the Pull request tab. A card says Nothing blocks the merge, or how many things block it, then one row each for checks, reviews from owners, members and collaborators, conflicts with the base and unresolved threads, then the commits. Signal marks only failed checks, changes requested and conflicts. Each blocker offers Send to Claude Code with a pointer, a failed check shows its failing lines, and Open on GitHub, or Merge on GitHub once nothing blocks, opens the pull request. Bots and outside reviewers read as outside the repository and never block or approve.

**Pages and overlays**
- Settings takes the whole window, its sections in the sidebar under Back to work, every choice applying at once. Its sections and settings are today's, with Theme as one select that includes the curated themes with their credits.
- Agents opens as a centre page instead of a palette mode, sessions grouped by needs you, nothing blocks, working, done and idle, each row with its state word, pull request and how long it has been in that state.
- New workspace opens as a centre page with one request box, the repo, the starting point and the generated name on it, and Create and start on Cmd+Enter. Claude Code starts in the new worktree with the request as its first message. An empty request starts a blank session. Each step of making the worktree shows under the box while it runs.
- Running processes open as a popover from the header readout.
- Dialogs stay only for one quick decision, archive and remove a repo with what would be lost, quit while agents run, and opening a link or a port. The command menu is the one overlay a person summons.

**Kit**
- Key hints are plain Geist Mono in `dim`, never boxed. Labels are sentence case. Chips carry state with a tinted edge and text. The segmented control is a sunken track with a raised choice. The kit adds the rail tab, the Ready card, the tile and the page.
- Cmd+J becomes Go to what needs you, the next workspace in the inbox order. Shortcuts follow today's rule, one key with Cmd on macOS and Ctrl+Shift on Windows and Linux, so Escape, plain Ctrl keys and Alt always reach Claude Code.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Claude Code in the centre | Repository views in the centre, agent on the right | The agent is what people watch all day, the repository is what they glance at. |
| Ready, a list of what blocks the merge | The Pull request tab with Overview, Checks, Conversation and Files | Those sections copy a page GitHub already draws better. Satellite answers the one question GitHub buries and links to the rest. |
| Nothing blocks the merge | Ready to merge, or a merge button | Green checks are not a review, so Satellite never calls a pull request safe and merging stays a person's decision on GitHub. |
| A repo view of live tiles | Split two sessions, or a board of cards | Seeing and answering every agent of a repository at once is the need. Cards would mean reading terminal output, which Satellite never does. |
| Strip cells that show state | Shrunken live terminals | A terminal that resizes makes Claude Code redraw, and state is all a glance needs. |
| Pages for anything with sections or forms | Dialogs for Settings and New workspace | A page keeps the sidebar and needs you in view and gives the content room. |
| The request as Claude Code's first message | Typing it into the prompt for the user to send | The person already pressed Create and start with their own words, so sending it is what they asked for. Nothing from GitHub is ever added to it. |
| No search tab | Content search in the rail | The agent already searches, and the command menu finds workspaces and files. |
| Repos | Projects, Spaces, Orbits | It is what developers call a repository, and Spaces would blur with workspaces. |

## Not in scope

Other agents than Claude Code, merging from Satellite, renaming a workspace after it exists, a board, a browser, a chat interface, content search, bulk archive, notifications other than needs you, and any change to how sessions start, resume and report state beyond the first message.

## Acceptance

A Satellite feature is accepted on macOS, Windows and Linux, in light, dark and a curated theme.

- [ ] A workspace shows its sessions in the centre and Changes, Files and Ready in the rail, and the rail hides and folds as specified. Proof, scenario `default` and a journey resizing the window.
- [ ] A file or diff opened from the rail opens as a centre tab and closing it returns to the session. Proof, scenario `mixed-changes`.
- [ ] Ready shows what blocks the merge for failed checks, requested changes and conflicts, with the right signal and requests, and Nothing blocks the merge when none do. Proof, scenarios `checks-failed`, `changes-requested`, `pr-conflicts` and `pr-open`.
- [ ] A bot or outside review never blocks or approves in Ready. Proof, scenario `hostile-description`.
- [ ] Clicking a repo shows every workspace with a session as tiles, Grid falls back to Focus when tiles would go under 64 by 24, typing reaches only the focused tile, and Cmd+1 to 9 and Cmd+Enter work. Proof, a new scenario with four sessions and a journey.
- [ ] Escape, plain Ctrl keys and Alt reach Claude Code in every layout. Proof, the `interrupts` scenario in a tile.
- [ ] Settings, Agents and New workspace open as pages, a needs you arriving on a page shows as a toast, and the only dialogs left are the ones listed. Proof, scenarios `inbox` and `first-run`, and a check of every dialog in the command registry.
- [ ] New workspace starts Claude Code with the typed request as its first message, and with none when the box is empty. Proof, the stand-in records the first message.
- [ ] Six live sessions in the repo view keep typing as responsive as one, and only visible tiles draw a terminal. Proof, scenario `flood` with a timing check.
- [ ] Every interface word says Repo where it said Project, and DESIGN.md, SATELLITE.md and BRAND.html describe the shipped layout. Proof, a search of the renderer strings and the docs.

## Open questions

- Specs 004, 011, 012 and 013 still read In progress with a plan.md. This layout removes the title bar strip from 011 and moves Settings to a page in 012, so their status needs settling first.
- Whether the guide's four cards keep their steps with the controls in their new places, or the first step points at the repo view.
