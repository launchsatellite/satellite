# Satellite

Satellite is an agentic development environment, a desktop app for developers who build through coding agents. One window holds every project and every parallel piece of work inside each project. Each piece of work gets its own git worktree, its own branch and its own Claude Code sessions.

Agents stay in orbit and do the work. You stay at the centre, see what each one is doing and step in when one needs you.

This file is the source of truth for what the product is and why. [specs/](specs/README.md) holds one spec per feature and its index shows what is built. [DESIGN.md](DESIGN.md) owns how it looks and speaks.

## Who it is for

Developers who already work with Claude Code and run several sessions at once, across several repositories. Without Satellite that means one editor window per project, agents told by hand to stay in separate worktrees, and a browser tab per pull request to see what an agent shipped.

## Principles

Every spec is checked against these. When two conflict, the earlier one wins.

1. **Satellite reads, agents write, you decide.** Code, commits, pushes, pull requests and replies are made by your agent. Satellite shows the result and hands your decisions back to the agent. An environment built for agents stays small, and it gets better every time the agents do.
2. **A thin layer, never an opinion.** Satellite sits above the tools you already use and adds nothing your agent or your repo can already do. Setup, verification and workflow belong to your agents, your skills and your hooks, so every team keeps working the way it prefers.
3. **Embed real tools, never redraw them.** The agent pane is your own Claude Code in a terminal. Git is `git` and GitHub is `gh`. Every feature those tools ship works the day it ships, and there is no copy to maintain.
4. **One text box.** The Claude Code prompt is the only place you type instructions. Satellite has no commit box, no reply form and no editor. When something needs words, Satellite prepares the request in the prompt and you press enter.
5. **Hold no credentials.** Sign-in stays with `gh` and `claude`. Satellite never reads, stores or forwards a token, and it loads no remote web content.
6. **Leave the repo alone.** Satellite writes nothing into a project's files. A workspace adds only its branch, its worktree and the remote-tracking branch its fetch updates to git, and everything Satellite owns lives in `~/.satellite`.
7. **Local first.** Everything runs on your machine, with no account, no server and no telemetry.
8. **Quiet until you are needed.** Greys carry the interface. Signal orange means an agent cannot go on without you, and nothing else.
9. **Simple first.** The smallest thing that works, in the product, the code and the process.

## Concepts

| Term | Meaning |
| --- | --- |
| Project | A git repository you added to Satellite. It stays where it already is on disk. |
| Workspace | One piece of work inside a project, with its own branch and sessions. The main workspace is the project's own folder on its current branch, and every other workspace has its own worktree. Every view shows the selected workspace. |
| Session | One Claude Code process running in a workspace, shown in the agent pane. |
| Needs you | Anything you must act on. An agent question or permission request, failed checks, requested changes or conflicts. |
| Inbox | Every workspace that needs you, across all projects, in one list. |
| Archive | Remove a workspace's worktree after showing what would be lost, its uncommitted and ignored files included. The branch and its commits stay, while a detached head has no branch to keep them. |

## Layout

Three columns that never move.

| Column | Holds |
| --- | --- |
| Left | Projects, their workspaces and the inbox. Every row tells its state with one status pixel. |
| Centre | The repository, never a chat. Changes, Files and Pull request for the selected workspace. |
| Right | The real Claude Code sessions of the selected workspace. |

Selecting a workspace switches the centre and the right column together. Sessions in other workspaces keep running.

Every action is one command, reached from its button, its shortcut or the command menu on Cmd+K, or Ctrl+Shift+K on Windows and Linux. The quick switcher on Cmd+P, or Ctrl+Shift+P, jumps to any workspace in any project. On first run Satellite checks `git`, `gh` and `claude` for real and names the step that fixes whatever is missing.

## Sessions

Each workspace runs its Claude Code sessions as tabs, and every session keeps running while another workspace is shown. A session is idle until its first request, then working, needs you or done, and stopped once Claude Code ends. Status comes from Claude Code's hooks, so a session stays idle before its trust question is answered and whenever the user's own settings block hooks. The agent can report its own status, so the pixel is as honest as the agent. Quitting or reloading ends every session, and each workspace then offers to resume the conversation it last prompted in. Declining Claude Code's trust question ends the session, which reads as stopped unexpectedly.

Send to Claude Code types a prepared request into the selected session's prompt as one line of at most 800 characters and never presses enter. It works once Claude Code has reported the user's first request in that session, and never while Claude Code is asking the user something. Every link in terminal output asks before it opens in the system browser, naming the site and the full address.

On Windows Satellite runs the native install of Claude Code, since an npm install starts through a batch file. Claude Code picks its colours when a session starts, so a running session keeps them through a theme change.

## Inbox

The inbox sits at the top of the sidebar, under the command menu and the switcher and above the projects. It lists every workspace with a session that needs you, across all projects, newest first by when the workspace started needing you, and its count turns signal orange while anything is listed. Each row names the workspace and its project, with the parent folder when two project names read the same, which reads your home folder for a project kept directly in it, as the home folder itself does when it is a project, and says why in one sentence, such as Claude Code needs you, Session 2 needs you or 3 sessions need you.

Selecting a row, or Go to the newest workspace that needs you in the command menu, opens that workspace on the session that has waited longest and puts focus in its terminal, without typing anything. A key already held when the terminal takes focus is dropped until the next fresh press, so a held Enter never answers a permission question. A row leaves by itself once no session there needs you, whether it was answered, ended or closed, or its workspace was archived or its project removed. Nothing about the inbox is saved, since every reason ends with its session.

When a workspace starts needing you while the window is hidden, minimised or behind another app, Satellite shows one system notification. Notifications are only for needing you, never for finished work. More sessions asking in the same workspace add none until it has left the inbox and needs you again. At most one notification shows every 5 seconds, and the workspaces that ask in between arrive together as one that counts every workspace waiting. A notification holds only Satellite's own words with the workspace and project names, never anything a session said or ran, and a click on it brings the window forward and opens the workspace it named while that one still needs you, or else the newest one waiting, the way its row does. Turn notifications off or on in the command menu. Turning them off closes the one showing, the switch is remembered, and the inbox and the count keep working while it is off.

The app icon carries the inbox count on macOS and on Linux launchers that support it, never for the AppImage. Windows shows no count. On macOS a notification needs an app the system accepts as signed and your permission, and the count needs that permission too. On Windows a notification needs the Start Menu shortcut the installer makes. A name written right to left displays right to left in a notification.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| The user's own `claude` in a terminal | A custom agent interface | Nothing to maintain, every Claude Code feature works at once, and the user's sign-in, settings, hooks and skills apply untouched. |
| Session status from hooks passed at launch | Editing the user's Claude Code settings, or reading terminal output | The hooks sit in a short-lived file in Satellite's own home, last for one process and merge with the user's own. Nothing is written to the user's Claude Code settings or the repository. |
| Notifications only when a workspace needs you | Notifications when work finishes | Signal stays rare, so a notification always means you are the blocker. |
| Read-only files and diffs | A code editor | Agents change the code. An editor invites a second way of working and a second product to maintain. |
| Prepared requests typed into the prompt | An editor link that shares selection and proposed edits | The link's protocol is undocumented, and pairing several sessions with the right workspace is its weakest part. The prompt is already ours. |
| A native read-only pull request view fed by `gh` | An embedded browser signed in to GitHub | A browser needs its own sign-in, stores a full-power session on disk and must be patched as fast as a browser. `gh` is already signed in and scoped. |
| Agents open, update and reply on pull requests | Forms in Satellite | Principle 1 and principle 4. |
| A view of the processes agents started | Plain terminals and a run button | The agent runs things. What was missing is seeing what is still running. |
| A worktree plus the files in `.worktreeinclude` | Setup and cleanup commands, a config file in the repo | Principle 2. Installing dependencies is the agent's job, and `.worktreeinclude` is the file Claude Code already reads. |
| Worktrees under `~/.satellite` | Worktrees inside the repo | Nested copies confuse search and file watchers, and the repo stays clean. |
| Electron | A shell drawn by each system's own web engine | Identical rendering on macOS, Windows and Linux, and the terminal and diff components run unchanged. |
| macOS, Windows and Linux built and tested together at release | One platform first | The app shell makes all three nearly free to build, and an automated journey through the real app proves each one. |
