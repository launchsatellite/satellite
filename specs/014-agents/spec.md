# 014 Agents

Status **Done** · Depends on **004, 005**

## Why

With agents running in several projects at once, the sidebar shows each workspace's most urgent pixel and the inbox shows only what needs you. Nothing answered the simple question of what every agent is doing right now. Agents lists every Claude Code session in every project in one place, and one key opens the one you pick.

## Scope

- An Agents row at the foot of the sidebar, with the `agents` icon and its shortcut, and the command Show every agent on Cmd+G, or Ctrl+Shift+G on Windows and Linux, which opens Agents as a page in the centre and closes it again.
- It lists every open Claude Code session tab across all repos, grouped Needs you, Nothing blocks, Working, Done, and Idle or stopped, so a stopped tab still has its row. A session waiting on its pull request, failed checks, changes asked for or conflicts, sits under Needs you, and one whose pull request is open with nothing blocking its merge under Nothing blocks.
- A row is the status pixel, the workspace's name with its repo and Session n under it, with the parent folder when two repo names read the same, the state in words, the pull request's number or no PR, and how long it has been in that state. Satellite never reads what a session prints, so a row says only what the hooks and gh say.
- Needs you goes longest waiting first, every other group in sidebar order, and the list follows the sessions live.
- Enter or a click on a row opens its workspace on that session and puts focus in its terminal, as the inbox does. Escape goes back.
- With no session open anywhere it says No Claude Code session is open in any repo.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| A page in the centre, grouped by what you do next | A palette mode, like Commands and the switcher | With several agents running it is the home screen, and a page has room for the state, the pull request and the time that a palette row has not. |
| Every session, stopped ones included | Only sessions that are running | A stopped tab is still open in its workspace, and the list should match the tabs. |

## Not in scope

Starting, stopping or answering a session from the list. Those stay in the session's own terminal.

## Acceptance

A Satellite feature is accepted on macOS, Windows and Linux.

- [x] The Agents row and Show every agent open the page, with each open session in every workspace grouped by its state. Proof, scenario `fresh-repo` in light and dark after a workspace started its session. Earlier proof of the list, Proof, the agent in the real window with scenario `needs-permission`, sessions in alpha and beta read as Working and Idle in light and dark, and the `inbox` journey, which finds alpha as Needs you in Agents.
- [x] Choosing a row opens its workspace on that session with focus in its terminal. Proof, the `inbox` journey, where Enter on alpha under Needs you in Agents selects alpha with the keys in its terminal.
