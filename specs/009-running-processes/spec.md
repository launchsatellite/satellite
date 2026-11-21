# 009 Running processes

Status **In progress** · Depends on **004**

## Why

Agents start dev servers, watchers and builds, and then the user loses track of what is still running and on which port. Satellite shows the processes each workspace's agents started and lets the user stop one.

## Scope

- A count of running processes on the workspace row and in the workspace header.
- The count opens a list. Each row shows the command, the session that started it, how long it has run and any port it listens on.
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

- [ ] A process started by a session appears with its command and age, and leaves when it ends. Proof, scenario `dev-server`.
- [ ] A listening process shows its port and the link opens the loopback address. Proof, the same scenario.
- [ ] Stop ends the process and its children. Proof, the same scenario.
- [ ] A process id that does not descend from a session is refused. Proof, unit tests.
- [ ] The process table parses on macOS, Windows and Linux. Proof, unit tests on recorded output.
