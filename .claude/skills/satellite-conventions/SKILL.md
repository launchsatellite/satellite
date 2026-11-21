---
name: satellite-conventions
description: "Use when writing or reviewing any code in Satellite. Working principles, when a test is worth writing, the security boundary between the interface and the background process, validation, comments, dependencies and generated files."
---

# Satellite conventions

Binding from the first line written. Where code goes and how it runs is in skill `satellite-stack`.

## Working principles

- **Think before coding.** State your assumptions. When a request has several readings, pick one out loud or ask when it matters. When something simpler exists, say so.
- **Simplest complete change.** No features beyond the task, no abstraction for one caller, no options nobody asked for, no handling for states that cannot occur.
- **Surgical edits.** Touch only what the task needs and match the surrounding style. Every changed line traces to the task.
- **Verifiable goals.** Turn the task into checks you can run yourself, so you loop without a human.

## Tests, only where they pay

A test earns its place when it catches a failure that is real and likely and that running the app would not catch cheaply. In Satellite that means worktree create and delete safety, parsing of `git` and `gh` output, the typed messages between the processes, and path handling across macOS, Windows and Linux.

No tests for glue code, layout, thin wrappers or anything one run of the app proves. No snapshot tests, no tests of mocks, nothing written to raise coverage. A test checks behaviour at its boundary, lives next to its code, and its name says the failure it catches. Example home folders in tests are written as `/Users/<name>/` or `/home/<name>/`, because the guards refuse anything that looks like a real one.

The unit tests run on macOS, Windows and Linux in the release workflow. A path the code checks as absolute is built per system, from `tmpdir()` or `C:\Users\<name>\` on Windows, and a path compared with git's output is compared in the form git prints, with forward slashes. A link to a folder is made as a `"junction"`, which Windows allows without rights and other systems ignore. A test that needs POSIX permissions, an executable hook, a link to a file, a FIFO or a newline in a name skips on Windows with `it.skipIf`.

## The security boundary

The background process has full access to the machine. The interface has none and talks to it only through one small set of typed messages, each validated with a schema before anything acts on it. Nothing shown in the interface (file contents, pull request text, terminal output, branch names) can ever run a command or read a file. A new message type is a security decision, recorded in `ARCHITECTURE.md`.

- Call `git`, `gh` and `claude` with argument arrays, never by joining strings into a shell command.
- Paths and names from users and repos are validated and never escape the folder they belong to.
- A name from a repo or a user that the interface draws, a file, a branch or a base, goes through `VisibleName` or `visibleText`, so a direction mark or a zero-width character can never disguise it. Text a repo's file holds goes only into Monaco's models, never into markup.
- Text a hostile author wrote, a pull request's title, description, comment, check name and log, is drawn as Markdown with no HTML element and no image through `MarkdownText` (raw HTML shows as literal text), or as revealed text, and never reaches an argument, a prepared request or a notification. A prepared request holds a number, an id, an address rebuilt from checked parts or the base branch's name after `cleanBase`, never the text. A parse that a hostile body can stall runs in a worker with a deadline.
- Satellite writes nothing into a user's working files and stores no tokens. Its own state and the workspaces' worktrees live in `~/.satellite`. The only repository writes are the branch, the worktree record and the fetch that making a workspace needs and the worktree removal of archive, all inside `.git` and listed in `ARCHITECTURE.md`.

## Code

- **Validate untrusted input once, at the boundary**, then trust it.
- **Failures are visible.** Every action has an outcome the user sees, and errors say what to do next.
- **Everything that can grow is bounded**, from lists and retries to scrollback and file watchers.
- **No comments.** Names, types and small functions carry the meaning. The only comment allowed is a tool directive that carries its reason. Lint refuses the rest.
- **Names describe** the domain thing. Files and folders are kebab-case. No `utils` dumping grounds, no `index` files, no barrels.
- **Named exports only.** A default export appears only where a tool requires one.
- **File order.** Imports, types, constants, private helpers, then exported functions last.
- **Code lives with its feature.** A folder per feature, with its tests beside the code they check.
- **Types are real.** No casts to silence the checker. A suppression carries its reason.

## Dependencies

- Latest stable versions, checked against current docs, never from memory.
- A new runtime dependency is the maintainer's decision. Check it is maintained and MIT compatible, and worth more than a few lines of our own. Dev dependencies are yours.
- A dev dependency whose files ship in the app, such as the fonts and the icon set, adds its licence to `scripts/third-party-licenses.ts` in the same change.
- Commit the lockfile. Never hand-edit generated files or lockfiles.
