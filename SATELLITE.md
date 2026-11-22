# Satellite

Satellite is an agentic development environment, a desktop app for developers who build through coding agents. One window holds every project and every parallel piece of work inside each project. Each piece of work gets its own git worktree, its own branch and its own Claude Code sessions.

Agents stay in orbit and do the work. You stay at the centre, see what each one is doing and step in when one needs you.

This file is the source of truth for what the product is and why. [specs/](specs/README.md) holds one spec per feature and its index shows what is built. [DESIGN.md](DESIGN.md) owns how it looks and speaks.

## Who it is for

Developers who already work with Claude Code and run several sessions at once, across several repositories. Without Satellite that means one editor window per project, agents told by hand to stay in separate worktrees, and a browser tab per pull request to see what an agent shipped.

## Principles

Every spec is checked against these. When two conflict, the earlier one wins.

1. **Satellite reads, agents write, you decide.** Code, commits, pushes, pull requests and replies are made by your agent. Satellite shows the result and hands your decisions back to the agent. An environment built for agents stays small, and it gets better every time the agents do.
2. **A thin layer, never an opinion.** Satellite sits above the tools you already use and adds nothing your agent or your repository can already do. Setup, verification and workflow belong to your agents, your skills and your hooks, so every team keeps working the way it prefers.
3. **Embed real tools, never redraw them.** The agent pane is your own Claude Code in a terminal. Git is `git` and GitHub is `gh`. Every feature those tools ship works the day it ships, and there is no copy to maintain.
4. **One text box.** The Claude Code prompt is the only place you type instructions. Satellite has no commit box, no reply form and no editor. When something needs words, Satellite prepares the request in the prompt and you press enter.
5. **Hold no credentials.** Sign-in stays with `gh` and `claude`. Satellite never reads, stores or forwards a token, and it loads no remote web content.
6. **Leave the repository alone.** Satellite writes nothing into a project's files. A workspace adds only its branch, its worktree and the remote-tracking branch its fetch updates to git, and everything Satellite owns lives in `~/.satellite`, apart from what the system keeps for every app.
7. **Local first.** Everything runs on your machine, with no account, no server and no telemetry.
8. **Quiet until you are needed.** Greys carry the interface. Signal orange means an agent cannot go on without you, and nothing else.
9. **Simple first.** The smallest thing that works, in the product, the code and the process.

## Concepts

| Term | Meaning |
| --- | --- |
| Project | A git repository you added to Satellite. It stays where it already is on disk. |
| Workspace | One piece of work inside a project, with its own branch and sessions. The main workspace is the project's own folder on its current branch, and every other workspace has its own worktree. Every view shows the selected workspace. |
| Session | One Claude Code process running in a workspace, shown in the agent pane. |
| Needs you | Anything you must act on, such as an agent question or a permission request, or a pull request with a failed check, a review that asks for changes or conflicts. A local conflict with the base branch shows as a calm banner in Changes and is not a needs-you reason. |
| Inbox | Every workspace that needs you, across all projects, in one list. |
| Archive | Remove a workspace's worktree after showing what would be lost, its uncommitted and ignored files included. The branch and its commits stay, while a detached head has no branch to keep them. |

## Layout

Three columns that never move.

| Column | Holds |
| --- | --- |
| Left | Projects, their workspaces and the inbox. Every row tells its state with one status pixel, and with a count of running processes when it has any. |
| Centre | The repository, never a chat. Changes, Files and Pull request for the selected workspace, under a header that names its branch and carries the pull request and running process readouts. |
| Right | The real Claude Code sessions of the selected workspace. |

Selecting a workspace switches the centre and the right column together. Sessions in other workspaces keep running.

Every action is one command, reached from its button, its shortcut or the command menu on Cmd+K, or Ctrl+Shift+K on Windows and Linux. The quick switcher on Cmd+P, or Ctrl+Shift+P, jumps to any workspace in any project. The command menu opens from inside the terminal too, and Focus the sidebar, Focus the repository and Focus the terminal move the keyboard between the three columns, so Claude Code never holds it. They have no shortcut, since no set of keys is free in the terminal, the diff and every system at once. On first run Satellite checks `git`, `gh` and `claude` for real and names the step that fixes whatever is missing. Claude Code needs 2.1.78 or newer, the first release with every hook Satellite reads, and an older one never starts a session and shows `claude update` instead.

Once the first project is added a small guide walks through the four things nobody guesses, one card at a time beside the real control it explains, with a grey ring around that control. Make a workspace, start Claude Code, read what it did and orange means you. A step passes when the user does what it describes, or on Next, and the last one ends on Done. Nothing is dimmed, nothing is blocked and the card takes no focus by itself, so Escape in the terminal still reaches Claude Code. Only Show the guide moves focus into it, and the card then draws the focus ring, and the card steps aside while a dialog or the command menu is open. The close control, or Escape while focus is in the card, ends the guide with one toast, and finishing it leaves nothing behind. It never returns by itself, and Show the guide in the command menu starts it again from the first step that still applies. When that step's control is not on screen, one toast says the guide shows once it is, or once the check of git, gh and Claude Code closes. Someone who updates from an earlier build is not a new user, so they meet the guide only through that command.

## Projects

Add a project with Add a project, through the folder dialog, or by dropping a folder on the window. The folder must be the working folder of a git repository, and Satellite records its path and writes nothing into it. It refuses the Satellite home folder, a whole drive, a bare repository, a folder inside `.git`, a worktree of another repository, a folder another user owns, a folder inside a repository, naming the repository to add instead, and a repository that holds the Satellite home where git does not ignore it, until the repository's `.gitignore` names it. On Windows a network folder cannot be dropped, and Add a project still takes it. Satellite holds up to 200 projects.

Remove this project forgets a project and leaves its folder untouched. While a Claude Code session or a process it started still runs in any of its workspaces, Satellite asks first and says what stops, with Cancel as the answer Enter gives, and reminds you that `claude --resume` in the folder picks the conversation up again. While the project still has workspaces Satellite refuses and asks you to archive them first, unless the folder is gone or no longer a repository. A workspace git no longer counts as a worktree never holds it back, and its archive says so and names its folder instead. Then it forgets the project with its workspaces, touches no folder and says that the workspaces' folders stay in `~/.satellite/worktrees/<project>`. A project whose folder moved says so, names where its workspaces' folders are and comes back by itself once the folder is back where it was, and one that is no longer a git repository says that instead. To move a repository for good, remove the project, run `git worktree repair` in its new place, which reconnects its worktrees, and add it again. Satellite finds its workspaces once more when the folder kept its name.

The left and right columns resize within limits. Projects, the selected workspace and the column widths come back after a restart. The look follows the system, and Use the light theme, Use the dark theme and Follow the system theme in the command menu change it. A project list saved by a newer Satellite stays untouched, so an older build shows no projects and adds or removes none.

## Workspaces

New workspace, on Cmd+N or Ctrl+Shift+N on Windows and Linux, makes one in a single action. The name is generated and can be changed first, and the branch takes the same name. It starts from the latest default branch on the remote, fetched for the purpose, or as a new branch at a branch chosen from a list. Every step shows as it runs, and the repository's own hooks, filters and the transport programs its config names run as they would in a terminal, so for a folder from someone else, creating a workspace runs their code with your environment. Cancel stops a creation and undoes it. A step that fails says what happened and leaves nothing half made. The worktree lives in `~/.satellite/worktrees/<project>/<workspace>`, and the ignored files that the project's `.worktreeinclude` names, and the new worktree ignores too, are copied into it. A project holds at most 20 workspaces besides its main one, with one creation per project and four at once.

Each workspace row shows its branch, how far it is ahead of and behind its remote and how many files are uncommitted, which its tooltip says. In a repository with a remote, a branch that was never pushed counts the commits that are on no remote.

Archive this workspace first shows what would be lost, uncommitted changes, commits that are not pushed and anything Satellite cannot rule out, then stops Satellite's terminals there and removes the worktree with its ignored files. The branch stays. A worktree git has locked, one with submodules checked out, one holding a folder from another drive or one Satellite cannot check whole is never archived, and when anything changed since the dialog opened it shows the latest instead. A project's main workspace is never archived.

On every list Satellite compares its records with what git reports. A workspace whose worktree was removed outside Satellite leaves the list with a sentence that says why, and a worktree in the project's own worktrees folder with no record shows up as a workspace.

## Sessions

Each workspace runs its Claude Code sessions as tabs, and every session keeps running while another workspace is shown. A session is idle until its first request, then working, needs you or done, and stopped once Claude Code ends. Status comes from Claude Code's hooks, so a session stays idle before its trust question is answered and whenever Claude Code's settings block hooks, the user's own or, once the user trusts it, a repository's. Then the session never shows needs you or reaches the inbox, and Send to Claude Code stays refused there. The agent can report its own status, so the pixel is as honest as the agent. No hook reports the answer to a permission question or an interrupt, so a digit or Enter that answers in the terminal shows working again at once, Escape that declines shows idle at once, and Escape or Ctrl+C while working shows idle once the turn stays quiet for 3 seconds. The next hook corrects any of them. When Claude Code works on for 8 seconds after Enter and no hook has ever arrived, the session's tab says Claude Code's settings seem to keep its hooks off. Quitting or closing the window asks first while sessions run. Quitting or reloading ends every session, and each workspace then offers to resume the conversation it last prompted in. Declining Claude Code's trust question ends the session, which reads as stopped unexpectedly.

Send to Claude Code types a prepared request into the selected session's prompt as one line of at most 800 characters and never presses enter. It works once Claude Code has reported the user's first request in that session, and never while Claude Code is asking the user something. Every link in terminal output asks before it opens in the system browser, naming the site and the full address.

On Windows Satellite runs the native install of Claude Code, since an npm install starts through a batch file. Claude Code picks its colours when a session starts, so a running session keeps them through a theme change.

## Inbox

The inbox sits at the top of the sidebar, under the command menu and the switcher and above the projects. It lists every workspace with a session that needs you, or whose pull request does, across all projects, newest first by when the workspace started needing you, and its count turns signal orange while anything is listed. Each row names the workspace and its project, with the parent folder when two project names read the same, which reads your home folder for a project kept directly in it, as the home folder itself does when it is a project, and says why in one sentence, such as Claude Code needs you, Session 2 needs you, 3 sessions need you, Checks failed on the pull request, A review asks for changes or The pull request has conflicts.

Selecting a row, or Go to the newest workspace that needs you in the command menu, opens that workspace on the session that has waited longest and puts focus in its terminal, without typing anything, or on its Pull request tab when the pull request is why it is listed. A key already held when the terminal takes focus is dropped until the next fresh press, so a held Enter never answers a permission question. A row leaves by itself once nothing there needs you, whether the session was answered, ended or closed, the checks pass, the review is answered, the conflicts are gone, or its workspace was archived or its project removed. Nothing about the inbox is saved, since every reason ends with its session or its pull request answer.

When a workspace starts needing you while the window is hidden, minimised or behind another app, Satellite shows one system notification. Notifications are only for needing you, never for finished work, and a pull request that needs you says so in Satellite's own words, The pull request needs you in the project, with no number, title or anything the pull request said. More sessions asking in the same workspace add none until it has left the inbox and needs you again. At most one notification shows every 5 seconds, and the workspaces that ask in between arrive together as one that counts every workspace waiting. A notification names one workspace only while no other waits, so it always states everything waiting. A notification holds only Satellite's own words with the workspace and project names, never anything a session said or ran, and a click on it brings the window forward and opens the one workspace it named while that one still needs you, or else the newest one waiting, the way its row does. Turn notifications off or on in the command menu. Turning them off closes the one showing, the switch is remembered, and the inbox and the count keep working while it is off.

The app icon carries the inbox count on macOS and on Linux launchers that support it, never for the AppImage. Windows shows no count. On macOS a notification needs an app the system accepts as signed and your permission, and the count needs that permission too. On Windows a notification needs the Start Menu shortcut the installer makes. A name written right to left displays right to left in a notification.

## Changes

Changes is the default tab of a workspace and shows what it changed as diffs. A switch picks the view. Branch, the one a workspace opens on, compares the working tree with the point where the branch left its base, so commits and uncommitted work sit in one list. Uncommitted compares it with the last commit. The base is the remote's default branch as git already records it, or for a project without a remote the branch of its main folder, and the main workspace of a project without a remote default has none. A workspace with no base opens on Uncommitted, and Branch there says in one sentence why it has nothing to compare. Files git does not track yet are listed as added in both views.

Each row shows the file's Git letter, its name and how many lines it added and removed, and the diff of the selected file sits beside the list, read only, side by side or inline as you choose, and always inline in a pane too narrow for two sides, with syntax shown in weight and grey, hidden characters in names and lines written out and look-alike letters outlined. The workspace header names the branch, its base and how far it is ahead of and behind its remote. A file that is binary, over 1 MB or 20,000 lines, a repository of its own or not UTF-8 text shows one sentence in place of a diff.

The view refreshes by itself while Satellite is visible, and at once when a session in the workspace finishes a turn, so nothing needs a button. When the base has moved and files conflict with the branch, a calm grey banner names them and offers Send to Claude Code with a request to update from the base and resolve the conflicts. Conflicts do not enter the inbox. The check is a trial merge that touches nothing in the repository and needs git 2.38 or newer, and on an older git the banner says so instead of claiming there is no conflict. Selecting lines in a diff and pressing Send lines, or Cmd+L, or Ctrl+Shift+L on Windows and Linux with focus in the diff, types a reference to those lines into the Claude Code prompt in plain words, such as Lines 12 to 18 of src/app.ts in this workspace, and never presses enter.

## Files

Files is the second tab of a workspace and shows its folder as it is on disk, read only. The tree reads like a code editor's explorer. Every file and folder has an icon for its kind, ignored entries are dimmed and never hidden, and a changed file carries its Git letter. Only `.git` stays out. Folders load when opened, so a large repository opens as fast as a small one, and every folder starts closed.

Clicking a file opens it in a tab with syntax shown in weight and grey and hidden characters written out. Several files stay open at once, and Satellite remembers each workspace's open files and the one in front, so they come back after a restart. Cmd+F, or Ctrl+Shift+F on Windows and Linux, or Find a file, opens a file by name with fuzzy matching, and finds files git does not ignore. The opened file takes focus, so the arrow keys move through it.

The tree and the open file follow the disk by themselves while Satellite is visible, so an agent's change shows without a button. Selecting lines in a file and pressing Send lines, or Cmd+L, or Ctrl+Shift+L, types a reference to them into the Claude Code prompt in plain words and never presses enter. Images in PNG, JPEG, GIF and WebP up to 5 MB are drawn. Other binary files, files that are not UTF-8 text and files over 1 MB or 20,000 lines show one sentence in place of the file. Files has no editor and no file operations, because agents write.

## Pull request

Pull request is the third tab of a workspace and shows the pull request of its branch, read through your own `gh` with the sign-in you already have. It shows for a workspace once its branch is on GitHub and has a pull request opened by you or your agent, from your fork too, or by an owner, a member or a collaborator of the repository, never one a stranger opened from your branch, and never one a bot or an app account opened, since GitHub reports those as outsiders, with its number on the tab, and a pixel and the number in the workspace's row and in the header, the header adding its state and a summary of its checks when it is wide, and the row and the header both saying all of it in their tooltip and accessible name, and it finds a pull request your agent opens by itself, when a session finishes a turn, when the window regains focus and on a slow timer. Without one, the tab says so and offers Send to Claude Code with a request to open it, except on the default branch, where it says pull requests land there and offers nothing. With `gh` signed out, missing, too old or out of reach, it says so in one sentence that names the fix.

Overview shows the title, state, branches, what blocks it from merging, the description and the commits. Checks lists every check with its result, and a failed check shows its failing lines when you open it and offers Send to Claude Code with a pointer to its run. Conversation shows reviews and comments in order with the unresolved threads first. Files shows the pull request's files in the diff Changes uses, against the pull request's base branch, with each review thread marked on its line when the workspace is at the pull request's last commit and that file has nothing uncommitted, and listed beside the diff otherwise, each with Send to Claude Code with a pointer to the thread. Cmd+J, or Ctrl+Shift+J on Windows and Linux, goes to the next unresolved thread. Open on GitHub opens the pull request, a check or a comment in the system browser, after showing the full address.

A failed check, a review from an owner, a member or a collaborator that asks for changes on the latest commit and conflicts with the base make the workspace need you and list it in the inbox, for an open pull request that is not a draft. A merged or closed pull request keeps the tab and never needs you. In the conversation, someone with no standing in the repository who is not you reads as outside the repository beside their name, so you can tell why their review needs nothing from you. Everything a pull request says is untrusted. A description or comment is drawn as Markdown with no scripts, no HTML elements and no remote images, raw HTML, an HTML comment included, shows as the literal text it is, a comment that GitHub hides shows only that it is hidden, an image is a link, and every link asks before it opens. Prepared requests carry only pointers, the number, a run or a thread address, since the agent has `gh` and reads the text itself. Nothing about a pull request is saved, and Satellite does not create, reply to, review or merge pull requests, which agents and GitHub do.

## Running processes

Agents start dev servers, watchers and builds, and then you lose track of what is still running and on which port. A workspace with something running shows a count on its row and in its header, and the header count or the command Show running processes opens the list. Each row shows the command the agent ran, the session that started it, how long it has run and any port it listens on. The command is shortened, shows your home folder as a tilde and hides what looks like a secret as far as it can, so it is a hint and never a promise.

A port that listens on this machine only, or on every address, is a link. It asks before it opens, naming the address, and only ever opens an address on your own machine. A port bound to another address shows as plain text. Stop ends the process and everything it started, with a polite request first and a forced end after two seconds, or a forced end at once on Windows, and tells you when something still runs. Satellite only ever stops processes that descend from its own sessions.

The list holds the processes that last at least 10 seconds, started by the workspace's running sessions, and it follows them while Satellite is visible, when a session finishes a turn and when you open it, and an age counts up while the list is open. When Satellite cannot read the processes it says so and keeps the last list. Running processes starts nothing and shows no output, since Claude Code already shows what it runs. A process that detached from the session that started it keeps running and is not listed, and the list says so. Nothing about processes is saved.

## Install and updates

Satellite never checks for updates, since it loads nothing remote. A new version is a new package installed over the old one, which keeps `~/.satellite`. That folder holds every workspace's worktree with its uncommitted work, so deleting it loses that work, and archiving the workspaces in Satellite first is the safe way to leave. Builds carry no paid signature, so macOS and Windows warn before the first open, and Windows with Smart App Control on can block them with no way to allow just Satellite. [README.md](README.md) has the steps.

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
| A worktree plus the files in `.worktreeinclude` | Setup and cleanup commands, a config file in the repository | Principle 2. Installing dependencies is the agent's job, and `.worktreeinclude` is the file Claude Code already reads. |
| A card beside the real control that follows what the user does | Slides before the app | People learn a control by using it, and nothing stands between them and their first agent. |
| Worktrees under `~/.satellite` | Worktrees inside the repository | Nested copies confuse search and file watchers, and the repository stays clean. |
| Electron | A shell drawn by each system's own web engine | Identical rendering on macOS, Windows and Linux, and the terminal and diff components run unchanged. |
| macOS, Windows and Linux built and tested together at release | One platform first | The app shell makes all three nearly free to build, and an automated journey through the real app proves each one. |
