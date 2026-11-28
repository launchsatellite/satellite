# 009 Running processes

Status **Done** · Depends on **004**

## Why

Agents start dev servers, watchers and builds, and then the user loses track of what is still running and on which port. Satellite shows the processes each workspace's agents started and lets the user stop one.

## Scope

- A count of running processes on the workspace row and in the workspace header.
- The header's count opens a list as a popover under it, closed by Escape, a press outside or the count again. Each row shows the command, the session that started it, how long it has run and any port it listens on.
- Only long-lived processes that descend from the workspace's sessions are listed.
- A port opens in the system browser. Only loopback addresses are ever opened.
- Stop ends one process and its children. Satellite only ever stops processes that descend from its own sessions.
- The list updates on a slow timer and when a session finishes a turn.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Descendants of the session's process | Every process whose folder is the worktree | The process tree is available on every platform without extra privileges. |
| No process output | A log view | Claude Code already shows the output of what it runs. |

## Not in scope

Starting processes. Agents start them.

## Acceptance

- [x] A process started by a session appears with its command and age, and leaves when it ends. Proof, scenario `dev-server`.
- [x] The header's count opens the list as a popover under it, Escape or a press outside closes it, and the port's link dialog leaves it open. Proof, the `processes` journey.
- [x] A listening process shows its port and the link opens the loopback address. Proof, the same scenario.
- [x] Stop ends the process and its children. Proof, the same scenario.
- [x] A process id that does not descend from a session is refused. Proof, unit tests.
- [x] The process table parses on macOS, Windows and Linux. Proof, unit tests on recorded output.
