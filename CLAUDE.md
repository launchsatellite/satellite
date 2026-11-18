@AGENTS.md

## Claude Code only

- `.claude/settings.json` switches the Git hooks on at session start, runs `guards/command.sh` before every Bash command, refuses edits to guard files and reads of `.env` files, and turns commit and pull request attribution off. Bypass mode is off. A refused action is the answer, so report it and never work around it.
- Superpowers fits the spec workflow. Its brainstorm becomes `specs/NNN-<slug>/spec.md` and its plan becomes `plan.md` next to it. Anything else it writes is gitignored scratch. Its test-first skill does not apply here, tests follow skill `satellite-conventions`.
- Parallel work takes one worktree per agent (`EnterWorktree`, or `.claude/worktrees/`).
