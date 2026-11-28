# 014 Agents

Status **Done** · Depends on **004, 005**

## Why

With agents running in several projects at once, the sidebar shows each workspace's most urgent pixel and the inbox shows only what needs you. Nothing answered the simple question of what every agent is doing right now. Agents lists every Claude Code session in every project in one place, and one key opens the one you pick.

## Scope

- An Agents row in the sidebar under Commands, with the `agents` icon and its shortcut, and the command Show every agent on Cmd+G, or Ctrl+Shift+G on Windows and Linux.
- It opens the palette in a fourth mode, Agents, listing every open Claude Code session tab across all projects. A row is the session's status pixel, its workspace's name and, at the right, its state, Needs you, Working, Done, Idle or Stopped, then Session n when the workspace holds more than one, then its project, with the parent folder when two project names read the same.
- Rows go needs you first, longest waiting first, then working, done, idle and stopped, each in sidebar order. The list follows the sessions live while it is open, and the highlighted row stays on its session when the order changes.
- Typing filters by workspace, project or state, as the switcher does.
- Choosing a row opens its workspace on that session and puts focus in its terminal, as the inbox does.
- With no session open anywhere it says No Claude Code session is open in any project.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| A palette mode, like Commands and the switcher | A pane or a page of its own | It is a glance and a jump, and the palette already holds the keyboard, the filter and the row look. Satellite stays a thin layer. |
| Every session, stopped ones included | Only sessions that are running | A stopped tab is still open in its workspace, and the list should match the tabs. |

## Not in scope

Starting, stopping or answering a session from the list. Those stay in the session's own terminal.

## Acceptance

A Satellite feature is accepted on macOS, Windows and Linux.

- [x] The Agents row and Show every agent open the list, with each open session in every workspace and its state. Proof, the agent in the real window with scenario `needs-permission`, sessions in alpha and beta read as Working and Idle in light and dark, and the `inbox` journey, which finds alpha as Needs you in Agents.
- [x] Choosing a row opens its workspace on that session with focus in its terminal. Proof, the `inbox` journey, where Enter on alpha in Agents selects alpha with the keys in its terminal.

## Next

- Agents opens as a centre page instead of a palette mode, sessions grouped by needs you, nothing blocks, working, done and idle, each row with its state word, pull request and how long it has been in that state. Part of [015 Layout](../015-layout/spec.md).
