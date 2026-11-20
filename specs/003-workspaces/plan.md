# Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project holds several workspaces. One action makes a branch and a worktree under the Satellite home from the latest default branch on the remote or from a branch the user picks, copies the ignored files `.worktreeinclude` names, shows every step and undoes everything when one fails. The sidebar shows each workspace with its branch, how far it is ahead of and behind its upstream and its count of changed files. Archive shows what would be lost, asks, stops the terminals running in the folder and removes the worktree while the branch stays. Each list compares Satellite's records with `git worktree list` and drops a workspace whose worktree is gone, saying why.

**Architecture:** Workspace records live in `projects.json`, which moves to version 2 and migrates version 1 on read. Every git call goes through `runTool` in the platform module with an argument array, behind one helper that adds the safe global options. Reads in the listing touch refs, the worktree list and the index without optional locks, and never the network. Creation is a list of steps run by one small state machine that reports each step over a bridge event and undoes every started step in reverse when one fails. Archive is two requests, an inspection that answers what would be lost with a fingerprint, and the archive itself, which refuses when the fingerprint no longer matches. The interface draws a dialog for each, from the kit's dialog, and holds its state in React.

**Tech Stack:** As in spec 002. Electron 45, React 19, TypeScript 6, zod 4, Tailwind 4, Vitest 5, playwright-core 1.65, Node 24. No new dependency of any kind. The `.worktreeinclude` matcher is our own code, a few dozen lines with its own tests.

**Spec:** `specs/003-workspaces/spec.md`

## What this writes into a repository

Creating a workspace writes into the repository's own `.git`, and that is the feature. `git branch` adds `refs/heads/<name>`, `git worktree add` adds `.git/worktrees/<id>/` and the new folder's `.git` file, and the fetch updates `refs/remotes/<remote>/<branch>` and the object store. Archive's `git worktree remove` deletes `.git/worktrees/<id>/`. Satellite writes nothing else into a repository, never into its working files, and it never runs `git worktree prune`, `repair`, `lock` or `move`. A failed creation undoes its branch and worktree. The objects and the remote-tracking ref a fetch brought in stay, the same as after any `git fetch`.

## Rulings checked

Each was checked against current official documentation and, for git, by running git 2.50.1 in throwaway folders under the system temp folder while planning.

- **git worktree (git-scm.com/docs/git-worktree, the 2.56 manual).** `add [-b <new-branch>] <path> [<commit-ish>]` refuses a branch already checked out by another worktree unless `--force`. Observed, `git worktree add <path> main` while main is checked out fails with `fatal: 'main' is already used by worktree at '<path>'`. `add -b` that fails on an existing folder still leaves the new branch behind (observed), so Satellite makes the branch itself with `git branch`, then adds the worktree on it, and undoes each separately. `--track` is the default when the start is a remote-tracking branch, so the branch is made with `--no-track` from a commit id and gets no upstream until the agent pushes with `-u`. `remove` takes only clean worktrees, meaning no untracked files and no modified tracked files, `--force` once removes an unclean one, twice a locked one. Observed, a worktree whose only extra files are ignored is removed without `--force` and its ignored files go with it. `list --porcelain` has one attribute per line and a blank line ends a record, with `worktree`, `HEAD`, `branch refs/heads/<b>` or `detached`, `bare`, `locked [<reason>]` and `prunable <reason>`. The main worktree comes first. An unborn branch shows `HEAD 0000000000000000000000000000000000000000` with its `branch` line (observed). Paths are real paths, so a temp folder under `/var` lists as `/private/var` on macOS (observed).
- **Minimum git 2.31 against each flag** (git's release notes). `--end-of-options` arrived in 2.24 for every command that uses the option parser and for `rev-parse` in 2.30. `worktree list` shows `locked` and `prunable` in porcelain from 2.31. `worktree list -z` arrived in 2.36, which is newer than Satellite's 2.31 minimum, so the reader asks for `-z` and falls back to newline records once when git answers `unknown switch` (exit 129), and never drops a record while reading newline records, because a path holding a newline can forge an attribute or a whole record there. `fetch --no-write-fetch-head` arrived in 2.29. `--no-optional-locks` arrived in 2.15. Every other flag below is older than 2.31.
- **No prompts, no hang.** git's own docs say `GIT_TERMINAL_PROMPT=0` stops terminal prompts and that, without a credential helper, git asks `GIT_ASKPASS`, then `core.askPass`, then `SSH_ASKPASS`, then the terminal. `credential.interactive=false` asks git and helpers that honour it never to interact (git-config, recent releases, and older releases ignore an unknown key). Git Credential Manager stops every GUI and terminal prompt with `GCM_INTERACTIVE=false` (its environment docs). OpenSSH never uses an askpass program with `SSH_ASKPASS_REQUIRE=never` (ssh(1)). So every git run gets `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=false` and `SSH_ASKPASS_REQUIRE=never`, loses `GIT_ASKPASS` and `SSH_ASKPASS`, and carries `-c core.askPass=` and `-c credential.interactive=false`. Each tool already starts detached in its own session on macOS and Linux with stdin ignored, so ssh has no terminal to ask on. Credential helpers still run, so a stored sign-in keeps working, and a helper that would show a dialog anyway is stopped by the time limit, which ends the whole process tree. Satellite never stores or sees a credential.
- **Fetching the default branch.** Claude Code's worktree docs (code.claude.com/docs/en/worktrees) fetch the remote default branch capped at five seconds, never wait for input, use the cached ref when the fetch fails and fall back to local `HEAD` with no remote. Satellite does the same with these exact values. The remote is `origin`, or the only remote when there is exactly one, read with `git remote`. Its default branch is `git symbolic-ref --quiet refs/remotes/<remote>/HEAD`, which a clone sets, else `git ls-remote --symref --end-of-options <remote> HEAD` within 10 seconds, read from its `ref: refs/heads/<b>\tHEAD` line. The fetch is `git fetch --no-tags --no-recurse-submodules --no-write-fetch-head --end-of-options <remote> refs/heads/<b>` within 15 seconds, which updates `refs/remotes/<remote>/<b>` through the configured refspec (observed). `-c gc.auto=0 -c maintenance.auto=false` stop the automatic maintenance a fetch would start, on every git version. With no copy of the branch after a failed fetch, creation stops with a sentence instead of silently starting from somewhere else. With no remote it starts from the main folder's current commit and says so. An empty repository is refused.
- **Counts without writes.** Ahead and behind come from `git for-each-ref --format=%(refname)%00%(upstream)%00%(upstream:track,nobracket) refs/heads/<b> ...`, refs only, which prints `ahead 2, behind 1`, `ahead 2`, `behind 1`, `gone` or nothing (observed). No upstream means no counts. Changed files come from `git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=all --no-renames` with the global `--no-optional-locks`, which git documents as skipping the optional index refresh write, and `-c core.fsmonitor=`, whose empty value is false (git-config Values, the empty string is false, and before 2.36 an empty hook path means none). Observed, it prints ` M a`, `?? d/x`, `?? new`, each ended by NUL.
- **Hooks and filters.** githooks says `post-checkout` runs after `git worktree add` unless `--no-checkout`, and its exit status becomes the command's. Observed, a hook exiting 3 makes `git worktree add` exit 3 with the worktree left in place. `reference-transaction` runs for any ref update, so for `git branch`, `git update-ref` and a fetch. Satellite lets the repository's hooks and filter drivers run during creation, because the spec gives setup to the user's hooks and creation is exactly `git worktree add` run by the user. A repository's tracked files cannot define a hook or a filter command, only its config can. Reads in the listing run no hook. `git status` can run a clean filter that the repository's config names when it rehashes a file, as it does in the user's terminal. That loosens the old rule that listing reads only refs and config, and Task 2 rewrites it in `ARCHITECTURE.md`.
- **`.worktreeinclude` (code.claude.com/docs/en/worktrees, Copy gitignored files into worktrees).** The file sits at the project root, uses `.gitignore` syntax, and only files that match a pattern and are also ignored are copied, so tracked files are never duplicated. A file inside a wholly ignored folder is copied only when that folder itself matches, or when a `**/` pattern's first name after `**/` is one of the folder's names, or when the pattern names the folder, as in `vendor/**/config.json`. The docs leave open symlinks, files the checkout already has, nested `.worktreeinclude` files and size, so Satellite takes the safest reading of each. Links and anything that is not a regular file are skipped, a file the new checkout already has is kept and never overwritten, only the root file counts, and the copy is bounded (Global Constraints). The ignored list comes from `git ls-files -z --others --ignored --exclude-standard --directory --no-empty-directory`, which names ignored files and wholly ignored folders with a trailing `/` (observed).
- **Branch names.** `git check-ref-format` forbids `..`, control characters, space, `~`, `^`, `:`, `?`, `*`, `[`, `\`, `@{`, a lone `@`, a component starting with `.` or ending in `.lock`, a trailing `.` or `/`, and with `--branch` a leading dash. Satellite takes a strict subset, lowercase letters and digits in groups joined by single hyphens, 1 to 48 characters, so every name is a valid branch and a valid folder everywhere.
- **Folders on every system (learn.microsoft.com, Naming Files, Paths, and Namespaces).** Windows reserves `CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9` and the superscript forms, also with any extension, refuses `< > : " / \ | ? *` and control characters, and has no trailing space or dot. Names are case-insensitive, and `MAX_PATH` is 260 unless long paths are turned on. Lowercase names cannot collide by case, the charset excludes every reserved character and the superscripts, `COM0` and `LPT0` are refused too for safety, and on Windows a worktree path longer than 150 characters is refused so the checkout keeps room for the repository's own paths.
- **Removal and held files.** Node's `fs.rm` retries `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY` and `EPERM` with `maxRetries` and `retryDelay` (nodejs.org fs). `O_NOFOLLOW` makes an open fail on a symlink and exists only on macOS and Linux, and the `wx` flag fails when the path exists. On Windows a process that holds a file open in the worktree makes deletion fail part way. Satellite first ends its own terminals in the folder, and anything else that holds files is reported (Task 6).
- **Not confirmed.** Whether `git worktree remove` on Windows deletes only an NTFS junction inside the worktree and not its target. Git for Windows reports junctions as links, which is why it should, and Claude Code's docs say it deletes only the link for its own worktrees. Task 6 makes no own walk into the folder, so nothing in Satellite follows a junction, and its report names this as unproven on Windows.

## Decisions the plan made

| Decision | Why | Cost if wrong |
| --- | --- | --- |
| "From an existing branch" means the new branch named after the workspace starts at that branch's commit | The spec says the branch takes the workspace's name and starts from either base, and the kit's dialog shows a Name field next to a From branch picker | A user who wanted to check out an existing branch makes a new one from it. Adding a check out mode later is one more start kind |
| "A branch already checked out elsewhere is explained" is the start comparison's sentence when a dropped workspace's branch now lives in another worktree, or git still counts it checked out in a deleted folder | Under the reading above creation never checks out an existing branch, so the comparison is the only place git can hold a branch elsewhere | If the spec meant checking out existing branches, that mode needs its own refusal sentence |
| Satellite never runs `git worktree prune` | Prune also removes the records of the user's own worktrees on an unmounted drive, and git prunes on its own schedule | A deleted worktree's branch stays checked out in git's eyes until the user prunes, and the drop sentence tells them |
| The comparison runs on every list, not only the first after start | One rule, and it covers the start. A workspace that is being made or archived is never dropped | A worktree removed outside the app leaves the sidebar on the next focus instead of the next start |
| Ahead and behind against the branch's upstream, and without one, ahead as the commits on no remote with `git rev-list --count refs/heads/<b> --not --remotes --` and no behind. A repository with no remote shows no count | An upstream is "its remote" in git's own terms, and a workspace branch has none until the agent pushes with `-u`, so its unpushed commits still show | One `git remote` and one `rev-list` per branch without an upstream in each list, through the shared slots |
| Counts also for the main workspace | The spec says each workspace | One `git status` per project per list in the main folder, without the optional index write |
| Workspace folders are `<home>/worktrees/<project folder>/<name>`, the project folder its folder name made safe | The spec names that layout. Two projects with the same folder name share the parent and every workspace folder must not exist yet | Two same-named projects show their workspaces side by side in one parent folder |
| Hooks and filter drivers run during creation, never during listing reads other than `git status`'s clean filters | The spec gives setup to the user's hooks and creation is `git worktree add` the user asked for | A repository whose own config names a hostile program runs it on creation, exactly as the user's terminal would, and the dialog says so |
| A failing `post-checkout` hook fails the creation and undoes it | git itself answers failure, and half made is worse than not made | A user whose hook fails on purpose gets no workspace until the hook passes |
| A project that still has workspaces cannot be removed, unless its folder or repository is gone, when the project and its workspace records are forgotten and every folder stays | No orphaned worktrees in the user's `.git`, and a missing project can still leave the list | One extra step, archive first. A missing project leaves its workspace folders in the Satellite home |
| Archive takes a fingerprint from the inspection and refuses when the workspace changed since | The user confirms exactly what they saw | An agent that keeps writing makes archive ask again |
| Leftover files after `git worktree remove` are deleted with `fs.rm` inside the confirmed worktree folder only | The user already accepted losing them and git has already forgotten the folder | A held file on Windows still survives three retries and the toast says so |
| At most 20 workspaces per project, one creation per project and four at once | Every list runs a status per workspace | A heavy user archives before making the twenty first |
| `projects.json` moves to version 2, `interface.json` stays at version 1 | The project file gains a field. Widening the selected workspace to a UUID accepts every older interface file | An older Satellite sets a newer interface file aside instead of reading it |
| Satellite's terminals that run inside the worktree are stopped before removal | It is what runs in a workspace today, and spec 004 and 009 replace the one method behind it | None today, since the terminal starts in the app's folder |

## Global Constraints

Every task is bound by `.superpowers/sdd/global-constraints.md`, `AGENTS.md`, `.claude/skills/satellite-conventions/SKILL.md`, `.claude/skills/satellite-stack/SKILL.md` (the bridge recipe) and `.claude/skills/satellite-verify/SKILL.md`. No comments, no casts, no `any`, kebab-case, named exports, tests only where listed and each seen failing once, no home-folder paths in any file, never push. Example paths in tests are `/Users/<name>/` or `/home/<name>/`.

### Names, folders and limits

- **Workspace name.** `src/shared/workspace-name.ts` exports `workspaceNameLimit = 48`, `workspaceNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`, `reservedWorkspaceNames` (a `Set` of `con`, `prn`, `aux`, `nul`, `com0` to `com9`, `lpt0` to `lpt9`) and `workspaceNameProblem(name: string): string | null`, which answers the first sentence that applies, in this order.
  - empty, `Give the workspace a name.`
  - longer than 48, `Keep the name to 48 characters or fewer.`
  - not matching the pattern, `Use lowercase letters, digits and single hyphens, like fix-login.`
  - reserved, `<name> is a name Windows keeps for itself. Pick another.`
  - otherwise `null`.
- **Worktree folders.** `<home>/worktrees`, then the project segment, then the name. The project segment is the project folder's base name with every character outside `[A-Za-z0-9._-]` replaced by `-`, runs of `-` collapsed, leading and trailing `.` and `-` trimmed, cut to 48 characters and trimmed again, `project` when empty, and `<segment>-project` when its lowercase form is a reserved name. Folders Satellite makes get mode `0o700` on macOS and Linux. On Windows a worktree path longer than 150 characters is refused.
- **Limits.** `bridgeLimits.workspacesPerProject = 20`. One creation per project and at most 4 at once. `.worktreeinclude` at most 65536 bytes and 1000 patterns. The copy walks at most 100000 entries and copies at most 10000 files and 1073741824 bytes. Status reads in a list share 8 slots. The archive list shows at most 50 files and 5 commit subjects of at most 200 characters.
- **Time limits**, all in `src/main/workspaces/git-command.ts`. `gitReadMs = 5000` for every read, `lsRemoteMs = 10_000`, `fetchMs = 15_000`, `branchMs = 5000`, `worktreeAddMs = 300_000`, `ignoredListMs = 30_000`, `worktreeRemoveMs = 120_000`.

### git

- **Environment**, in `toolEnvironment("git", ...)` in `src/main/platform/tools.ts`. Drop `GIT_ASKPASS` and `SSH_ASKPASS` (add both to `gitDroppedKeys`), and set `GIT_TERMINAL_PROMPT: "0"`, `GCM_INTERACTIVE: "false"`, `SSH_ASKPASS_REQUIRE: "never"` next to `LC_ALL`.
- **Arguments.** `gitArgs(folder, args)` answers `["--no-optional-locks", "-C", folder, "-c", "core.fsmonitor=", "-c", "core.askPass=", "-c", "credential.interactive=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args]`. Every git call this spec adds goes through it. A value that came from the interface or a repository goes after `--end-of-options` wherever the command takes options, and full ref names (`refs/...`) and absolute paths are the only other positional values.
- **The commands**, exactly these and nothing else, each through `gitArgs`.
  - Reads. `worktree list --porcelain -z` (and without `-z` as the fallback), `for-each-ref` with the tracking format, `for-each-ref --format=%(refname) refs/heads/`, `for-each-ref --sort=-committerdate --count=200 --format=%(refname) refs/heads refs/remotes`, `status` with the flags above, `remote`, `symbolic-ref --quiet refs/remotes/<remote>/HEAD`, `show-ref --verify --quiet <ref>`, `show-ref --verify <ref>`, `ls-files -z --others --ignored --exclude-standard --directory --no-empty-directory`, `rev-list --count HEAD --not --remotes`, `rev-list --count HEAD --not --branches --remotes --tags`, `log --format=%s -n 5 HEAD --not --remotes --` and `log --format=%s -n 5 HEAD --not --branches --remotes --tags --`, and `branch --show-current` as today.
  - Network. `ls-remote --symref --end-of-options <remote> HEAD` and the fetch above.
  - Writes. `branch --no-track --end-of-options <name> <oid>`, `update-ref -d refs/heads/<name> <oid>`, `worktree add --end-of-options <path> <name>`, `worktree remove --force --end-of-options <path>`.
- **Remote names** must match `/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/`, and a remote that does not is treated as no remote. A branch name read from git must pass `isBranchName` (Task 4).

### State

- **`projects.json` version 2.** `{ "version": 2, "projects": [{ "id": "<uuid>", "path": "<absolute real path>", "workspaces": [{ "id": "<uuid>", "name": "<workspace name>", "path": "<absolute real path of the worktree>", "branch": "<branch it was made on>" }] }] }`. At most 200 projects and 20 workspaces each. Project ids and paths unique as today, workspace ids unique across the file, workspace paths unique, every workspace path fully qualified and at most 4096 characters, branch 1 to 255 characters. A version 1 file is read as version 2 with `workspaces: []` and written as version 2 on the next change. An unknown version is set aside as today.
- **`interface.json`** stays version 1. `selected.workspace` widens to `"main"` or a UUID.

### Contract

In `src/shared/bridge-contract.ts`.

- `workspaceKey = z.union([z.literal("main"), z.uuid()])`. `workspaceRef = z.strictObject({ projectId: z.uuid(), workspace: workspaceKey })`.
- `workspaceName = z.string().min(1).max(workspaceNameLimit).refine((name) => workspaceNameProblem(name) === null)`.
- `refName = z.string().min(6).max(300).refine(isStartRef)` where `isStartRef` (exported from `src/shared/workspace-name.ts`) requires `refs/heads/` or `refs/remotes/` first and a remainder that passes the check-ref-format rules in Rulings checked.
- `count = z.int().min(0).max(1_000_000)`.
- `workspaceView = z.strictObject({ key: workspaceKey, name: workspaceName.nullable(), branch: z.string().min(1).max(255).nullable(), ahead: count.nullable(), behind: count.nullable(), changed: count.nullable() })`, `name` null only for `main`. `projectView.workspaces` becomes `z.array(workspaceView).min(1).max(21)`, main first.
- `"projects.list"` response gains `dropped: z.array(z.string().min(1).max(300)).max(20)`.
- `"projects.remove"` response becomes `z.strictObject({ forgotWorkspaces: z.int().min(0).max(20) })`.
- `startView = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("remote"), remote: z.string().min(1).max(100), branch: z.string().min(1).max(255) }), z.strictObject({ kind: z.literal("local"), branch: z.string().min(1).max(255).nullable() }), z.strictObject({ kind: z.literal("empty") })])`.
- `"workspaces.prepare": { request: z.strictObject({ projectId: z.uuid() }), response: z.strictObject({ name: workspaceName, start: startView, branches: z.array(z.strictObject({ ref: refName, label: z.string().min(1).max(255) })).max(200) }) }`.
- `startChoice = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("default") }), z.strictObject({ kind: z.literal("ref"), ref: refName })])`.
- `"workspaces.create": { request: z.strictObject({ operationId: z.uuid(), projectId: z.uuid(), name: workspaceName, start: startChoice }), response: z.strictObject({ workspace: workspaceView }) }`.
- Event `"workspaces.step": z.strictObject({ operationId: z.uuid(), step: creationStep, state: z.enum(["running", "done", "failed", "undone"]), detail: z.string().min(1).max(300).nullable() })` with `creationStep = z.enum(["start", "branch", "worktree", "files", "save"])`.
- `lossView = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("unpushed"), count, subjects: z.array(z.string().max(200)).max(5) }), z.strictObject({ kind: z.literal("lost"), count, subjects: z.array(z.string().max(200)).max(5) }), z.strictObject({ kind: z.literal("no-remote") }), z.strictObject({ kind: z.literal("unknown") })])`.
- `"workspaces.inspect": { request: z.strictObject({ projectId: z.uuid(), workspaceId: z.uuid() }), response: z.strictObject({ branch: z.string().min(1).max(255).nullable(), files: z.array(z.strictObject({ code: z.string().length(2), path: z.string().min(1).max(4096) })).max(50), moreFiles: count, commits: lossView, sessions: z.int().min(0).max(bridgeLimits.terminals), locked: z.boolean(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }) }`.
- `"workspaces.archive": { request: z.strictObject({ projectId: z.uuid(), workspaceId: z.uuid(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }), response: z.strictObject({ leftover: z.boolean() }) }`.
- Types exported. `WorkspaceKey`, `WorkspaceView` (already), `StartView`, `StartChoice`, `CreationStep`, `LossView`.

The main workspace's key stays `"main"`, so it can never be named in `workspaces.inspect` or `workspaces.archive`, whose ids are UUIDs.

### What a page running hostile script could do with each new channel

Recorded in `ARCHITECTURE.md` in Task 8, decided here.

- `workspaces.prepare` reads refs and the project's workspace folder names and answers branch names, which the sidebar already shows. Nothing is written and nothing reaches the network.
- `workspaces.create` makes a branch and a worktree with a name that passes the shared schema, in a folder Satellite derives, from a start the background process resolves itself, and runs the repository's checkout hooks, exactly as the user's click does. It is bounded by 20 workspaces per project, one creation per project and four at once. It cannot name a path, an option or a program. That is less than the same page can do through `terminal.write` and Claude Code's shell.
- `workspaces.inspect` reads the status and commit subjects of one workspace the page names by id. Files and Changes show the same text in later specs.
- `workspaces.archive` deletes a workspace's uncommitted and ignored files after the page sends a fingerprint it read moments before, so a hostile page can destroy uncommitted work in Satellite's own worktrees without the user's click. The branch and its commits stay. The same page could already delete any file through `terminal.write`, so this adds nothing new, and the integrity of the interface (no remote content, the content security policy, text drawn as text) is what guards both.

### Test ids

Kept, every test id from spec 002. Changed, worktree rows are `workspace-<project>-<name>` and main rows stay `workspace-<project>-main`, both through `withUniqueTestIds`. A row's readouts are `<row test id>-meta`. Switcher options are `switch-<project>-<name>` or `switch-<project>-main`. New, `new-workspace-<project>` (through `withUniqueTestIds`), `new-workspace-dialog`, `workspace-name`, `workspace-name-problem`, `workspace-start`, `workspace-start-note`, `workspace-hooks-note`, `create-workspace`, `cancel-workspace`, `workspace-steps`, `step-start`, `step-branch`, `step-worktree`, `step-files`, `step-save`, `workspace-failure`, `try-again-workspace`, `close-workspace-dialog`, `archive-workspace`, `archive-dialog`, `archive-files`, `archive-commits`, `archive-sessions`, `archive-locked`, `archive-notice`, `archive-confirm`, `archive-cancel`, `archive-failure`.

### Commands

`workspace.new` "New workspace", shortcut `{ key: "n" }`, available when the selected workspace's project is listed and not missing, opens the dialog for that project. `workspace.archive` "Archive this workspace", available when the selected workspace is not `main` and its project is not missing. The registry list in `AppWindow` becomes `palette.commands`, `project.add`, `project.remove`, `workspace.new`, `workspace.archive`, `palette.switcher`, `tools.check`, `theme.system`, `theme.light`, `theme.dark`.

### Copy

Every sentence is fixed in the task that shows it, and nothing else may be shown. No colons in prose, sentences end with a full stop, titles do not.

### Scenarios, steps and journeys

New scenarios `unpushed-work` (Task 2), `fresh-repo` and `failing-hook` (Task 5). New scenario fields `workspaces` (Task 2) and `write.executable` (Task 5). Folders are built before the repo (Task 2). New step `select=<testid>:<label>` (Task 5). The app's git reads the recipe's config through `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM` (Task 2). New journey `workspaces` (Task 7), changed journeys `boundary` (Task 7) and `projects` (Task 5).

## Review Focus

1. **Undo after every step.** A failure in any step leaves no branch, no worktree record in `.git` and no folder, and never deletes a branch that existed before. `workspace-creation.test.ts` pins the order and `create-steps.test.ts` runs real git through a failing hook.
2. **Nothing escapes the worktrees folder.** A name, a symlinked project folder, a symlink in the new checkout or a junction never makes Satellite write or delete outside `<home>/worktrees/<segment>/<name>`. `worktree-folders.test.ts` and `include-copy.test.ts` pin it.
3. **No prompt and no hang on the network.** Offline, a missing remote, a remote that asks for a password and a hanging credential helper all end within their limits with a sentence.
4. **The comparison never drops a live workspace.** A failed `git worktree list`, a newline in a path under the newline fallback, or a workspace being made or archived keeps its record. `project-list.test.ts` pins each.
5. **Archive deletes only what the user saw.** The fingerprint, the locked refusal and the confirmed folder check in `workspace-archive.test.ts`.

---

### Task 1: git's environment and the readers

The safe environment for every git run, the one argument helper, and the three parsers the listing needs, with their tests. Nothing is wired yet.

**Files:**
- Modify: `src/main/platform/tools.ts`, `src/main/platform/tools.test.ts`
- Create: `src/main/workspaces/git-command.ts`, `src/main/workspaces/worktree-list.ts`, `src/main/workspaces/worktree-list.test.ts`, `src/main/workspaces/branch-tracking.ts`, `src/main/workspaces/branch-tracking.test.ts`, `src/main/workspaces/changed-files.ts`, `src/main/workspaces/changed-files.test.ts`

**Interfaces:**
- Consumes: `runTool`, `AbandonedRun`, `ToolRun` from `src/main/platform/tools.ts`, `BridgeFailure` from `src/main/bridge/registry.ts`, `gitReadTimeoutMs` from `src/main/projects/repository-check.ts`.
- Produces:
  - `export function toolEnvironment(tool: Tool, env: Record<string, string>): Record<string, string>` in `tools.ts`, exported for its test, with the git keys from Global Constraints.
  - In `git-command.ts`, the time limit constants from Global Constraints (`gitReadMs` is `gitReadTimeoutMs`), `gitArgs(folder: string, args: readonly string[]): string[]`, and `runGit(folder: string, args: readonly string[], timeoutMs: number): Promise<ToolRun | undefined>`. `runGit` calls `runTool("git", gitArgs(folder, args), { timeoutMs })`. It answers `undefined` when the run times out or fails to start, after awaiting `exited` of an `AbandonedRun` like `currentBranch` does today, and throws `BridgeFailure("tool-missing", "Satellite needs git for workspaces. Install git, then try again.")` when `runTool` answers `undefined`.
  - In `worktree-list.ts`, `interface ListedWorktree { path: string; head: string | null; branch: string | null; detached: boolean; bare: boolean; locked: boolean; prunable: boolean }`, `parseWorktreeList(stdout: string, separator: "\0" | "\n"): ListedWorktree[]` and `listWorktrees(root: string): Promise<{ worktrees: ListedWorktree[]; separator: "\0" | "\n" } | undefined>`. The parser splits records on an empty line (two separators in a row), reads `worktree <path>`, `HEAD <oid>` (all zeros becomes `null`), `branch refs/heads/<b>` (prefix removed, any other ref kept whole), `detached`, `bare`, `locked` with or without a reason, `prunable` with a reason, and ignores unknown labels, so a newer git still parses. A record without a `worktree` line is skipped. `listWorktrees` runs `worktree list --porcelain -z` and, when it exits 129 with `unknown switch` in stderr, runs `worktree list --porcelain` and remembers for the rest of the run that this git has no `-z`. Any other failure answers `undefined`.
  - In `branch-tracking.ts`, `parseTrack(track: string): { ahead: number; behind: number } | null`, where `""` is `{ ahead: 0, behind: 0 }`, `gone` and anything unreadable are `null`, and each number is capped at 1000000. `readTracking(root: string, branches: readonly string[]): Promise<Map<string, { ahead: number; behind: number } | null>>` runs one `for-each-ref --format=%(refname)%00%(upstream)%00%(upstream:track,nobracket)` with one `refs/heads/<b>` argument per distinct branch (at most 21), keeps only lines whose refname equals one asked for exactly, answers `null` for a branch with an empty upstream, and an empty map when git fails.
  - In `changed-files.ts`, `interface StatusEntry { code: string; path: string }`, `parseStatus(stdout: string): StatusEntry[]` for porcelain v1 with `-z`, where each entry is two status characters, a space and the path up to NUL, and an `R` or `C` code consumes the next NUL-ended field as its source path. `readStatus(folder: string): Promise<{ entries: StatusEntry[]; raw: string } | undefined>` runs the status command from Global Constraints with `gitReadMs`, answering `undefined` on a non-zero exit or a timeout.

- [ ] **Step 1: Tests.** Write these and see each fail because the modules do not exist.
  - `tools.test.ts`, `gives git an environment that never prompts`. `toolEnvironment("git", { PATH: "/usr/bin", GIT_ASKPASS: "/usr/bin/askpass", SSH_ASKPASS: "/usr/bin/ssh-askpass", GIT_DIR: "/tmp/x" })` has `GIT_TERMINAL_PROMPT` `"0"`, `GCM_INTERACTIVE` `"false"`, `SSH_ASKPASS_REQUIRE` `"never"`, `LC_ALL` `"C"`, keeps `PATH` and has none of the three dropped keys.
  - `worktree-list.test.ts`.
    - `reads every attribute of a NUL separated list`, the documented example from the git manual (bare source, a branch, a detached head, locked with and without a reason, prunable) joined with `\0` and ended by `\0\0`.
    - `reads the same list separated by newlines`.
    - `reads an unborn branch as a branch with no commit`, `worktree /Users/<name>/repo\0HEAD 0000000000000000000000000000000000000000\0branch refs/heads/main\0\0`.
    - `keeps a path with spaces and a newline whole when NUL separated`.
    - `reads Windows paths`, `worktree C:/Users/<name>/repo`.
    - `ignores labels it does not know`.
    - `reads the list real git prints`, against a temp repo from `mkdtemp` with real `git init -b main`, a commit, `git branch w1` and `git worktree add <temp>/wt/w1 w1`, run through `listWorktrees`, finding two worktrees with branches `main` and `w1` and the second path `samePath` with the real path of `<temp>/wt/w1`. The test's git runs with `GIT_CONFIG_GLOBAL` pointing at a temp file naming a user and `GIT_CONFIG_NOSYSTEM=1`.
  - `branch-tracking.test.ts`, `reads ahead and behind from every track shape`, with `""`, `ahead 2`, `behind 1`, `ahead 2, behind 1`, `gone` and `ahead 9999999`.
  - `changed-files.test.ts`.
    - `counts modified, staged and untracked files`, ` M a\0?? d/x\0?? new\0A  b\0` gives four entries.
    - `keeps a file name with spaces, quotes and unicode`, `?? a "b" é.txt\0`.
    - `reads a rename's source as part of one entry`, `R  new\0old\0 M c\0` gives two entries.
    - `answers nothing for empty output`.
- [ ] **Step 2: Implement** per the interfaces. Run `npx vitest run src/main/platform/tools.test.ts src/main/workspaces`, all pass.
- [ ] **Step 3: Prove it.** `./scripts/check` green. `npm run --silent journeys` green, since every existing git read now has the new environment.
- [ ] **Step 4: Commit.** `feat(git): run git without prompts and read worktrees, tracking and status`.

---

### Task 2: Workspace records, the listing and the sidebar

The shared name rule arrives first, since the contract needs it. `projects.json` moves to version 2, the listing answers every workspace with its branch and counts and drops the ones git no longer knows, the sidebar draws them, removing a project with workspaces is refused, and the driver can seed a workspace for the `unpushed-work` scenario.

**Files:**
- Modify: `src/shared/bridge-contract.ts`, `src/main/projects/projects-file.ts`, `src/main/projects/project-list.ts`, `src/main/projects/project-list.test.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/projects/sidebar.tsx`, `src/renderer/projects/use-projects.ts`, `src/renderer/projects/workspace-header.tsx`, `src/renderer/palette/palette.tsx`, `src/renderer/window/app-window.tsx`, `verify/scenario.ts`, `verify/driver.ts`, `verify/journeys/boundary.ts` (only if its `projects.drop` fixture needs the new view shape)
- Create: `src/shared/workspace-name.ts`, `src/shared/workspace-name.test.ts`, `src/main/projects/projects-file.test.ts`, `src/main/workspaces/workspace-reads.ts`, `verify/scenarios/unpushed-work/scenario.json`
- Delete: `src/main/projects/workspaces.ts`

**Interfaces:**
- Consumes: Task 1's readers and `runGit`, `samePath` and `isFullyQualified` from `src/main/platform/paths.ts`, `answerWithin` and `folderReadMs` from `repository-check.ts`, `createSlots` (move it from `project-list.ts` to `src/main/projects/slots.ts` and export it, since two files now use it).
- Produces, shared: `src/shared/workspace-name.ts` per Global Constraints, plus `isBranchName(name: string): boolean` (the check-ref-format rules with `--branch`'s leading dash rule, at most 255 characters) and `isStartRef(ref: string): boolean` (`refs/heads/` or `refs/remotes/` followed by a remainder for which `isBranchName` holds). It imports nothing.
- Produces, contract: everything in Global Constraints under Contract except the `workspaces.*` channels and the event, which Tasks 4 and 6 add. `projectView.workspaces` and `workspaceView` change now, and `projects.list` and `projects.remove` change now.
- Produces, main:
  - `projects-file.ts`. `interface StoredWorkspace { id: string; name: string; path: string; branch: string }`, `StoredProject` gains `workspaces: StoredWorkspace[]`, the version 2 schema with the version 1 migration as one `z.union([version1.transform(...), version2])`, and `workspaceLimit` re-exported from `bridgeLimits.workspacesPerProject`. Saves write version 2.
  - `workspace-reads.ts`. `interface Drop { workspaceId: string; sentence: string }` and `readWorkspaces(project: StoredProject, projectName: string, busy: ReadonlySet<string>, inStatusSlot: Slot): Promise<{ workspaces: WorkspaceView[]; drops: Drop[] }>`, run only for a project whose folder checks passed.
    1. `listWorktrees(project.path)`.
    2. The main view takes its branch from the first listed worktree, or from `git branch --show-current` (the old `currentBranch`, moved here) when the list failed. `key: "main"`, `name: null`.
    3. Each record finds its listed worktree with `samePath`. A record that is listed and not prunable gives a view with that worktree's branch. Every other record gives a view with `branch: null` and null counts while the list failed, and otherwise becomes a drop, unless its id is in `busy`, or the list was read with newline separators and `project.path` or any record path contains `\n`.
    4. Drop sentences, with `<name>` the record's name, `<project>` the project's name and `<branch>` the record's branch.
       - Listed as prunable, `<name> left <project> because its folder was deleted outside Satellite. git still counts <branch> as checked out there until you run git worktree prune.`
       - Not listed, and another listed worktree that is not prunable has `<branch>` checked out, `<name> left <project> because its worktree was removed outside Satellite. Its branch <branch> is checked out in <folder> now.`, where `<folder>` is `<project>` for the main worktree and the other worktree's folder name otherwise.
       - Not listed otherwise, `<name> left <project> because its worktree was removed outside Satellite.`
    5. `readTracking` for the branches of the views, and `readStatus` for the main folder and each kept record's path, each inside `inStatusSlot`, filling `ahead`, `behind` and `changed` (`entries.length` capped at 1000000), `null` where a read failed.
  - `project-list.ts`.
    - `readProject` keeps its bounded folder checks. Only those checks sit inside `answerWithin(..., folderReadMs)` and the hung-read slots. `readWorkspaces` runs after them with its own git limits, and the per-project pending read still covers both, so one project never has two reads in flight.
    - An unavailable project answers its main view plus one view per record, all with `branch: null` and null counts.
    - `projects.list` gathers every drop, removes the dropped records through one `replace`, and answers their sentences in `dropped`, at most 20. A failed save keeps the records and answers no sentences.
    - `createProjects` returns `store: ProjectStore` beside `handlers` and `flush`, with `interface ProjectStore { project(projectId: string): Promise<StoredProject>; addWorkspace(projectId: string, workspace: StoredWorkspace): Promise<void>; removeWorkspace(projectId: string, workspaceId: string): Promise<void>; busy: Set<string>; creating: Set<string> }`. `project` throws `BridgeFailure("not-found", "That project is not in Satellite.")`. `addWorkspace` throws `BridgeFailure("limit", "<project> has 20 workspaces, as many as Satellite holds. Archive one, then make this one.")` when full, `not-found` as above when the project is gone, and `BridgeFailure("failed", "Satellite couldn't save the workspace list. Nothing changed.")` on a failed save. `busy` holds workspace ids being archived and `creating` project ids being created in, filled by Tasks 4 and 6.
    - `projects.remove`. A project id in `creating` is refused with `Satellite is still making a workspace in <project>. Try again when it's done.` A project with workspaces whose folder checks pass is refused with `<project> still has <n> workspaces. Archive them first, then remove the project.` (`<project> still has 1 workspace. Archive it first, then remove the project.` for one). A project whose folder or `.git` is gone, or whose checks do not answer within `folderReadMs`, is forgotten with its records and answers `forgotWorkspaces` with how many it had. Otherwise `forgotWorkspaces: 0`.
- Produces, renderer:
  - `workspaceLabel(project, workspace)`. `unavailable` when the project is missing, else the branch, else the workspace name, else `detached`.
  - Sidebar rows for every workspace, main first, each a `button` as today. `aria-current="true"` only on the row whose project id and key both equal the selection. Each row's readouts sit in a `span` at `ml-auto flex flex-none items-center gap-[7px] font-pixel text-[12px] uppercase text-dim` with test id `<row test id>-meta`, showing `↑<ahead>` when ahead is above 0, `↓<behind>` when behind is above 0, and the `folder` icon at 12 then `<changed>` when changed is above 0, and nothing when all are 0 or null. Its `aria-label` lists the shown parts as `<n> ahead`, `<n> behind`, `<n> changed files`, joined with `, `. The branch `span` stays `min-w-0 truncate` so the readouts keep their size.
  - `WorkspaceHeader`. For a worktree workspace the `h1` is the workspace name and the project's name follows in `text-[13px] text-dim truncate`, then the branch icon and branch as today. Main stays as today.
  - The switcher lists every workspace with `label` the row label and test id `switch-<project>-<name or main>`. `SwitcherItem` gains `testKey: string`.
  - `AppWindow`. A selection whose workspace key is no longer in its project becomes that project's main workspace and persists. `dropped` sentences arrive as info toasts. `project.remove` shows `Satellite forgot <name>. Its folder is untouched.` when `forgotWorkspaces` is 0, and otherwise `Satellite forgot <name> and its <n> workspaces. Every folder stays where it is.` (`1 workspace` for one). `useProjects` passes `dropped` and `forgotWorkspaces` through.
- Produces, verify:
  - `prepareFolders` builds `folders` before `repo`, so a repo step can clone a folder.
  - Scenario field `workspaces?: { name: string; steps: RepoStep[] }[]`, names kebab-case. After the repo is built, for each, the recipe runs `git branch --no-track <name> HEAD` and `git worktree add <home>/worktrees/repo/<name> <name>` in the repo, then the steps inside the new folder. Then the driver writes `<home>/projects.json` as version 2 with one project, a random id, the real path of the repo and one record per workspace with a random id, its name, the real path of its folder and `branch` its name. A scenario that also lists `projects.json` under `home` fails with `scenario <name> seeds projects.json twice`.
  - The app's environment gains `GIT_CONFIG_GLOBAL` (the recipe's `<temp>/gitconfig`) and `GIT_CONFIG_NOSYSTEM=1`, added after the inherited `GIT_*` variables are stripped, so the app's git never reads the user's own git config or hooks during verification.
  - `unpushed-work`, described as "A clone of a local upstream with one workspace, fix-login, holding a commit that isn't pushed, a changed file and a new one." `folders` holds `upstream`, which writes `README.md` (`# Verify repo\n`) and `.gitignore` (`node_modules/\n`), then `git init -b main`, `git add .`, `git commit -m "first commit"`. `repo` is `git clone ../folders/upstream .`. `workspaces` holds `fix-login` with the steps write `src/login.ts` (`export const redirect = "/home";\n`), `git add src/login.ts`, `git commit -m "fix the login redirect"`, write `README.md` (`# Verify repo\n\nLogin notes.\n`), write `notes.md` (`Ask about the session timeout.\n`). `home` seeds `interface.json` as `default` does. `gh` and `claude` as in `default`.

- [ ] **Step 1: The name rule.** Write `workspace-name.test.ts` from Step 2, see it fail, implement `src/shared/workspace-name.ts`, see it pass.
- [ ] **Step 2: Tests.** See each fail first.
  - `workspace-name.test.ts`.
    - `accepts the names Satellite suggests`, `fix-login`, `a`, `x1-2`.
    - `refuses names git refuses as branches`, `-x`, `x-`, `a..b`, `a.lock`, `a b`, `a~b`, `a^b`, `a:b`, `a?b`, `a*b`, `a[b`, `a\b`, `@`, `a@{b`, `.x`, `x.`, each answering the pattern sentence.
    - `refuses names that climb or nest folders`, `..`, `../x`, `a/b`, `/abs`, `C:\x`.
    - `refuses uppercase so names never collide by case`, `Fix-Login`.
    - `refuses names Windows keeps for itself`, `con`, `nul`, `com1`, `lpt9`, `com0`.
    - `refuses an empty and a long name`, `""` and 49 characters.
    - `checks start refs like git`, `refs/heads/feature/x` and `refs/remotes/origin/main` pass, `refs/tags/v1`, `HEAD`, `refs/heads/a..b`, `refs/heads/-x` and `refs/heads/a.lock` fail.
  - `projects-file.test.ts`, against real temp homes.
    - `reads a version 1 file as version 2 with no workspaces`.
    - `writes version 2 after a change`.
    - `sets aside a file with two workspaces on one path`.
    - `sets aside a project with 21 workspaces`.
  - `project-list.test.ts`, with real git in temp folders and the same test git environment as Task 1.
    - `lists a workspace with its branch and changed files`. A repo with a record whose worktree has one untracked file lists that workspace with its branch and `changed: 1`, and main with `changed: 0`.
    - `drops a workspace whose folder was deleted and says why`. Delete the worktree folder with `rm` in the test, list, and see the record gone from `projects.json` and the prunable sentence in `dropped`.
    - `explains a dropped workspace whose branch is checked out elsewhere`. Run `git worktree remove` on it, then `git switch <branch>` in the main folder, and see the elsewhere sentence naming the project.
    - `keeps a workspace that is being archived`. Its id in `store.busy` keeps the record although git no longer lists it.
    - `keeps every record when git cannot list worktrees`, with `git.abandon` from the existing mock.
    - `refuses to remove a project that has workspaces`, and `forgets a missing project with its workspaces`, answering `forgotWorkspaces: 1`.
  - `registry.test.ts`, update the spies to the new shapes, and add `refuses a selection with a workspace that is neither main nor a uuid` to the interface state test cases.
- [ ] **Step 3: Implement** per the interfaces. Run the tests, they pass. Fix the `projects.drop` fixture in `registry.test.ts` and anything in `boundary.ts` that reads a view.
- [ ] **Step 4: Renderer** per the interfaces.
- [ ] **Step 5: Driver and scenario** per the interfaces.
- [ ] **Step 6: Prove it.**
  - `npm run --silent verify -- unpushed-work wait-for=workspace-repo-fix-login text=workspace-repo-fix-login-meta click=workspace-repo-fix-login text=workspace-header tree shot=rows-light theme=dark shot=rows-dark` answers `2` for the readout (a changed and a new file), shows the main row then `fix-login` under `repo`, only `fix-login` with `aria-current` in the tree, and the header reading `fix-login`, `repo` and `fix-login`.
  - The drop after a deleted folder is proven by `project-list.test.ts` here and in the real app by Task 7's journey. Never delete a folder by hand to prove it.
  - `npm run --silent verify -- unpushed-work wait-for=workspace-repo-fix-login click=workspace-repo-main click=remove-project wait-for=toast text=toast` answers `repo still has 1 workspace. Archive it first, then remove the project.`
  - `./scripts/check` and `npm run --silent journeys` green.
- [ ] **Step 7: Commit.** `feat(workspaces): list each workspace with its branch and counts`, `fix(sidebar): mark only the selected workspace as current`, `test(verify): seed a workspace and build folders before the repo`.

---

### Task 3: Names, folders and the include matcher

Pure modules with their tests, the shared name rule, the name generator, the folder rules and the `.worktreeinclude` matcher and copy. Nothing is wired yet.

**Files:**
- Create: `src/main/workspaces/workspace-names.ts`, `src/main/workspaces/workspace-names.test.ts`, `src/main/workspaces/worktree-folders.ts`, `src/main/workspaces/worktree-folders.test.ts`, `src/main/workspaces/worktree-include.ts`, `src/main/workspaces/worktree-include.test.ts`, `src/main/workspaces/include-copy.ts`, `src/main/workspaces/include-copy.test.ts`

**Interfaces:**
- Produces:
  - `workspace-names.ts`. `nameAdjectives` = `bright, calm, clear, crisp, deep, far, fast, keen, light, lunar, mild, near, neat, quick, quiet, rapid, sharp, solar, steady, still, swift, vivid, warm, wide` and `nameNouns` = `apex, arc, beam, comet, core, dawn, drift, echo, flare, halo, lander, nova, orbit, probe, pulse, quasar, ray, relay, signal, spark, star, tide, vector, zenith`, both `readonly string[]`. `suggestName(taken: (name: string) => boolean, random: () => number = Math.random): string` tries 20 random `<adjective>-<noun>` pairs, then the first pair with `-2` up to `-99`, and answers the first that is not taken, or the last candidate tried.
  - `worktree-folders.ts`.
    - `worktreesRoot(home: string): string`, `join(home, "worktrees")`.
    - `projectSegment(projectRoot: string): string` per Global Constraints.
    - `prepareWorktreeFolder(home: string, projectRoot: string, name: string): Promise<{ ok: true; path: string; segment: string } | { ok: false; refusal: string }>`. It refuses a name `workspaceNameProblem` refuses with that sentence. It makes `worktreesRoot(home)` and then the segment folder each with one `mkdir` (mode `0o700`), accepting `EEXIST`, and requires each, by `lstat`, to be a folder and not a link, otherwise `Satellite's worktrees folder isn't a plain folder, so it won't make a workspace there.` It requires the real path of the segment folder to be inside the real path of the root by `isInsidePath`. It refuses when an entry of the segment folder is `samePath` with the name, with `A folder named <name> is already in Satellite's worktrees for <segment>. Pick another name.` On Windows it refuses a path over 150 characters with `That workspace's folder would be too long for Windows. Pick a shorter name.` It answers `join(<real segment folder>, name)` without making that folder, which `git worktree add` makes.
    - `isWorktreeFolder(home: string, path: string): Promise<boolean>`, true only when `path` is a folder and not a link by `lstat`, and its real path is exactly two levels below the real path of `worktreesRoot(home)`, compared with `samePath` and `isInsidePath`. Archive and every undo call it before touching a folder.
  - `worktree-include.ts`.
    - `interface IncludePattern { negated: boolean; directoryOnly: boolean; anchored: boolean; segments: string[] }`, `parseWorktreeInclude(text: string): IncludePattern[]`. It splits on `\r?\n`, drops blank lines and lines starting with `#`, unescapes a leading `\#` or `\!`, trims trailing spaces unless the last is escaped with `\`, reads a leading `!` as negation, a trailing `/` as directory only, a `/` anywhere else as anchored (a leading `/` is then removed), and prefixes an unanchored pattern with the segment `**`. It keeps at most 1000 patterns.
    - `createIncludeMatcher(patterns: readonly IncludePattern[]): { matches(path: string, isDirectory: boolean): boolean; reaches(directory: string): boolean }`, paths relative with `/`. Segments match with `*` (any run without `/`), `?` (one character), `[...]` with ranges and a leading `!` or `^`, and `\` escapes, and `**` matches zero or more whole segments. `matches` is true when a parent folder of the path matches as a directory, otherwise the last pattern that matches the whole path decides, negation meaning false. `reaches` is true when some pattern that is not negated could match a path strictly inside the folder. For a pattern whose first segment is `**`, that holds when its next segment matches one of the folder's segments. Otherwise its segments match the folder's segments one by one and the pattern has more segments, or reaches a `**` while they still match.
  - `include-copy.ts`.
    - `interface IncludeSelection { files: string[]; links: number }`, `collectIncludedFiles(root: string, ignored: readonly string[], matcher: IncludeMatcher): Promise<IncludeSelection | "too-many" | "too-large">`. `ignored` are the entries of `git ls-files ... --directory`. An entry with a `..`, `.` or empty segment, a backslash, NUL or an absolute form is skipped. A file entry that `matches` is checked with `lstat` and kept when it is a regular file, counted in `links` when it is a link, and skipped otherwise. A folder entry (trailing `/`) is copied whole when it `matches` as a directory, walked when it `reaches`, and skipped otherwise, and a walk reads each folder with `readdir(..., { withFileTypes: true })`, never descends into a link, counts links, skips anything that is not a regular file or a folder and keeps files that `matches`. More than 100000 entries visited or 10000 files kept is `too-many`, more than 1073741824 bytes by `lstat` sizes is `too-large`.
    - `copyIncludedFiles(root: string, worktree: string, files: readonly string[]): Promise<{ copied: number; skipped: number }>`. For each file, every parent folder under `root` must be a folder and not a link by `lstat`, the source opens with `O_RDONLY` plus `O_NOFOLLOW` where `fs.constants.O_NOFOLLOW` is defined, and `fstat` must say regular file. Every parent under `worktree` is made with one `mkdir` when missing and must otherwise be a folder and not a link. The destination opens with flag `wx` (plus `O_NOFOLLOW` where defined) and the source's mode masked with `0o777`, and the bytes stream across. A source that fails a check, a destination parent that is a link, and a destination that exists are skipped and counted, never written through. Any other error rejects.
- [ ] **Step 1: Tests.** See each fail first.
  - `workspace-names.test.ts`, `suggests only names the shared rule accepts`, every `<adjective>-<noun>` pair passes `workspaceNameProblem`, and `skips taken names and adds a number when every pair is taken`, with a `taken` that refuses everything but `bright-apex-2` and a fixed `random` of `() => 0`.
  - `worktree-folders.test.ts`, against temp homes from `mkdtemp`.
    - `makes a safe segment from any folder name`, `my repo` gives `my-repo`, `..` gives `project`, `.hidden` gives `hidden`, `CON` gives `CON-project`, `プロジェクト` gives `project`, 60 characters cut to 48.
    - `answers a folder inside the worktrees folder`.
    - `refuses a name that already has a folder, whatever its case`, a folder `Quiet-Orbit` refuses `quiet-orbit` on macOS and Windows (`it.skipIf(process.platform === "linux")`).
    - `refuses a worktrees folder that is a link`, `it.skipIf(process.platform === "win32")`, a link `worktrees` pointing to another temp folder.
    - `refuses a segment folder that is a link`, same skip.
    - `confirms only folders two levels inside`, `isWorktreeFolder` true for `worktrees/p/n`, false for `worktrees/p`, `worktrees/p/n/deeper`, a path outside, and a link at `worktrees/p/n` (skip on Windows).
  - `worktree-include.test.ts`.
    - `matches an unanchored name at any depth`, `.env` matches `.env` and `sub/.env`.
    - `anchors patterns with a slash`, `config/*.local.json` matches `config/dev.local.json`, not `config/a/dev.local.json` and not `other/config/dev.local.json`, and `/root.txt` matches only `root.txt`.
    - `matches folders only with a trailing slash`, `build/` matches the folder `build` and not a file `build`.
    - `lets a later negation win`, `.env*` then `!.env.example`.
    - `reads comments, escapes and trailing spaces`, `# note`, `\#hash`, `\!bang`, `trail   `, `keep\ `.
    - `matches double stars`, `**/x.json`, `a/**/b.json` (with zero and two folders between), `logs/**`.
    - `matches classes and single characters`, `[ab].txt`, `[!ab].txt`, `file?.txt`.
    - `reaches into an ignored folder only as the docs say`, `.env` does not reach `node_modules/x`, `vendor/**/config.json` reaches `vendor`, `**/.claude/skills/*.md` reaches `.claude`, `**/config.json` does not reach `vendor`, `node_modules/` matches the folder itself.
  - `include-copy.test.ts`, against temp folders.
    - `copies the bytes and the executable bit of matched files`, mode checked with `it.skipIf(process.platform === "win32")`.
    - `copies a matched file from inside an ignored folder it reaches`.
    - `skips links instead of following them`, a link `.env` to a file outside the root, skipped and counted (skip on Windows).
    - `never writes through a link in the new checkout`, the worktree has `config` as a link to an outside folder, `config/dev.local.json` is skipped and the outside folder stays empty (skip on Windows).
    - `keeps a file the checkout already has`.
    - `skips a named pipe without waiting on it`, made with `mkfifo` (skip on Windows).
    - `stops at 10000 files`, 10001 small files in an ignored folder that matches, answering `too-many`.
- [ ] **Step 2: Implement** per the interfaces, and run the tests until they pass.
- [ ] **Step 3: Prove it.** `npx vitest run src/shared src/main/workspaces` and `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(workspaces): check workspace names and folders and match .worktreeinclude`.

---

### Task 4: Making a workspace in the background

The creation state machine, its real steps with their undo, and the `workspaces.prepare` and `workspaces.create` channels with the `workspaces.step` event.

**Files:**
- Create: `src/main/workspaces/workspace-creation.ts`, `src/main/workspaces/workspace-creation.test.ts`, `src/main/workspaces/create-steps.ts`, `src/main/workspaces/create-steps.test.ts`, `src/main/workspaces/workspace-handlers.ts`
- Modify: `src/shared/bridge-contract.ts`, `src/main/main.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/bridge/bridge-client.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3, `ProjectStore`, `BridgeOwner`, `workspaceNameProblem` and `isStartRef`.
- Produces:
  - `workspace-creation.ts`. `class StepFailure extends Error` (its message is a sentence for people), `interface CreationStepRun { id: CreationStep; run(): Promise<string | null>; undo?: () => Promise<boolean> }`, `interface StepReport { step: CreationStep; state: "running" | "done" | "failed" | "undone"; detail: string | null }`, and `runCreation(steps: readonly CreationStepRun[], report: (event: StepReport) => void): Promise<{ ok: true } | { ok: false; step: CreationStep; sentence: string; undone: boolean }>`. Steps run in order, each reported `running`, then `done` with the detail `run` answered. A throw reports `failed` with `null`, then every started step, the failed one first and then backwards, runs its `undo` when it has one, reporting `undone` when it answers true. An undo that answers false or throws makes `undone` false and the rest still run. The sentence is the `StepFailure`'s message, or for any other error, logged with `console.error`, the fixed sentence of that step from Step 3.
  - `create-steps.ts`. `interface CreationContext { home: string; root: string; project: string; name: string; start: StartChoice; save(workspace: StoredWorkspace): Promise<void> }` and `creationSteps(context: CreationContext): CreationStepRun[]`, the five steps of Step 3 sharing the resolved commit id, whether the branch was made, the worktree path and whether it was added. Also `prepareWorkspace(root: string, home: string): Promise<{ name: string; start: StartView; branches: { ref: string; label: string }[] }>`.
  - `workspace-handlers.ts`. `workspaceHandlers({ home, store }): Pick<BridgeHandlers, "workspaces.prepare" | "workspaces.create">`, and Task 6 adds the other two to the same function.
  - Contract. `workspaces.prepare`, `workspaces.create` and the `workspaces.step` event from Global Constraints. The event's empty `Set` joins `listeners` in `bridge-client.ts`.

- [ ] **Step 1: State machine tests** in `workspace-creation.test.ts`, with fake steps that record calls. See them fail first.
  - `runs every step in order and reports each`.
  - `undoes every started step backwards when one fails, the failed one first`, a failure in `files` gives undo calls `files`, `worktree`, `branch`, and `save` never runs.
  - `reports undone only for steps whose undo succeeded`.
  - `keeps undoing after an undo fails and says the undo was partial`.
  - `turns an unexpected error into the step's own sentence`.
- [ ] **Step 2: The machine.** Implement `runCreation`, run the tests until they pass.
- [ ] **Step 3: The steps.** `<project>` is the project's name, `<name>` the workspace name, `<remote>` and `<b>` as in Rulings checked, `<label>` the ref without `refs/heads/` or `refs/remotes/`. Every git call is `runGit` with the limit named.
  - **start.** For `{ kind: "ref" }`, `show-ref --verify <ref>` (`gitReadMs`) gives the commit, detail `Starts from <label>.`, and a missing ref fails with `<label> isn't in <project> anymore. Pick another starting point.` For `{ kind: "default" }`, the remote is chosen as in Rulings checked. With no remote, the first entry of `listWorktrees` gives the main folder's commit and branch, detail `<project> has no remote, so it starts from <branch>.` or `<project> has no remote, so it starts from the current commit.`, and an unborn head fails with `<project> has no commits yet. Make a first commit, then make a workspace.` With a remote, the default branch comes from `symbolic-ref` then `ls-remote` (`lsRemoteMs`), failing with `Satellite couldn't find the default branch of <remote>. Start from a branch you have instead.` Then the fetch (`fetchMs`) and `show-ref --verify refs/remotes/<remote>/<b>`. A fetch that succeeds gives detail `Fetched <b> from <remote>.` A fetch that fails or times out with the ref present gives `Couldn't reach <remote>, so it starts from <remote>/<b> as last fetched.` With the ref absent it fails with `Satellite couldn't reach <remote> and has no copy of <b> yet. Connect, or start from a branch you have.` No undo.
  - **branch.** `show-ref --verify --quiet refs/heads/<name>` exiting 0 fails with `A branch named <name> already exists in <project>. Pick another name.` Then `branch --no-track --end-of-options <name> <oid>` (`branchMs`), detail `null`, failing with `git couldn't make the branch <name>.` Undo, only when this step made the branch, `update-ref -d refs/heads/<name> <oid>`, true when it exits 0 or the ref is already gone, so a branch someone moved since is never deleted.
  - **worktree.** `prepareWorktreeFolder`, a refusal failing with its sentence. Then `worktree add --end-of-options <path> <name>` (`worktreeAddMs`), failing with `git couldn't check out the worktree, or one of the repository's hooks failed.` After success, `listWorktrees` must list the path, or it fails with the same sentence. Undo, when `isWorktreeFolder(home, path)` holds and `listWorktrees` lists the path, `worktree remove --force --end-of-options <path>` (`worktreeRemoveMs`), then when the folder still exists and `isWorktreeFolder` still holds, `rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })`. True when git no longer lists the path and the folder is gone.
  - **files.** `<root>/.worktreeinclude` by `lstat`. Missing gives detail `No .worktreeinclude, so nothing to copy.` A link, a folder or more than 65536 bytes fails with `.worktreeinclude isn't a plain file of at most 64 KiB, so Satellite won't read it.` Then `ls-files ...` (`ignoredListMs`) in the root, failing with `git couldn't list the ignored files.`, `collectIncludedFiles` (`too-many` and `too-large` fail with `.worktreeinclude matches more than 10000 files or 1 GiB. Narrow it, then try again.`), `copyIncludedFiles`, failing with `Satellite couldn't copy the files .worktreeinclude lists.` Details, `Nothing in .worktreeinclude matched an ignored file.` for none, `Copied <n> files.` (`Copied 1 file.`), with ` Skipped <m> that were links or already in the checkout.` appended when links plus skipped is above 0. Undo answers true, since the worktree's undo removes the copies.
  - **save.** `context.save({ id: randomUUID(), name, path, branch: name })`, its `BridgeFailure` sentence as the failure. No undo.
  - The final sentence for a failure in any step after **start** appends ` Satellite removed what it had made, so nothing changed.` when `undone` is true, and ` Satellite couldn't undo all of it. Check git worktree list and the branch <name> in <project>.` otherwise.
  - `prepareWorkspace`. Taken names are the local branches from `for-each-ref --format=%(refname) refs/heads/` and the entries of the segment folder, lowercased. `start` is `remote` with the chosen remote and the cached default branch from `symbolic-ref` only (no network), `local` with the main branch when there is no remote or no cached default, and `empty` when the main head is unborn. `branches` comes from the sorted `for-each-ref` with `--count=200`, without any `refs/remotes/<r>/HEAD`, each kept only when `isStartRef` holds.
- [ ] **Step 4: Integration tests** in `create-steps.test.ts`, real git in temp folders, the test git environment from Task 1, and a temp Satellite home. See them fail first.
  - `makes the workspace from the latest default branch on the remote`. An upstream with two commits, a clone whose `origin/main` and `main` are moved back one commit, then `runCreation(creationSteps(...))` makes the worktree at `<home>/worktrees/<segment>/<name>` with `HEAD` at the upstream's second commit and branch `<name>` with no upstream.
  - `starts from a chosen branch`.
  - `copies only ignored files .worktreeinclude names`. `.env` and `config/dev.local.json` arrive, `notes.log`, `node_modules/pkg/.env` and the untracked `scratch.txt` do not.
  - `undoes the branch and the worktree when a hook fails`. A `post-checkout` hook that exits 1 (skip on Windows, where the executable bit cannot be set this way) leaves no branch, no listed worktree and no folder.
  - `never deletes a branch that already existed`. A name equal to an existing branch fails in `branch`, and that branch still points where it did.
  - `starts from the cached copy when the remote is unreachable`. The remote URL changed to a missing folder gives the as last fetched detail.
  - `refuses an empty repository`.
- [ ] **Step 5: Handlers.**
  - Before any step runs, `workspaces.create` checks `show-ref --verify --quiet refs/heads/<name>` and the segment folder's entries, and refuses a taken name with the branch or folder sentence (`refused`) without emitting a step, so the dialog shows it at the name. The **branch** step and `prepareWorktreeFolder` keep their own checks for a race.
  - `workspaces.prepare` reads `store.project`, refuses a missing folder or repository with `<project> isn't available right now, so Satellite can't make a workspace in it.` (`refused`), and answers `prepareWorkspace`.
  - `workspaces.create`. It refuses when `store.creating` holds the project with `Satellite is already making a workspace in <project>.` and when four creations run with `Satellite is making four workspaces already. Try again when one is done.` (both `refused`), and when the project already has 20 workspaces with the `limit` sentence from Task 2. It adds the project to `creating`, runs `runCreation` with `save` calling `store.addWorkspace`, emits every report as `workspaces.step` with the request's `operationId` through `owner.emit`, and removes the project from `creating` in a `finally`. A failure throws `BridgeFailure` with the final sentence, code `refused` when the failed step is **start** or **branch** with the exists sentence, and `failed` otherwise. Success answers the new workspace's view with null counts and its branch.
  - Wire `workspaceHandlers({ home, store: projects.store })` in `main.ts`. A creation the page left keeps running to its end.
  - `registry.test.ts`, the spies, and `refuses workspace names that are not branches or that leave the folder`, `workspaces.create` with names `../x`, `a/b`, `-x`, `Fix`, `con`, 49 characters, `""`, a ref `refs/heads/a..b`, a ref `HEAD`, an `operationId` that is not a UUID and an extra key, each `invalid-request` with no handler run.
- [ ] **Step 6: Prove it.** `npx vitest run src/main/workspaces src/main/bridge` and `./scripts/check` green. The app is unchanged for people until Task 5, so `npm run --silent journeys` green.
- [ ] **Step 7: Commit.** `feat(workspaces): make a workspace step by step and undo it on failure`.

---

### Task 5: The new workspace dialog

The dialog part, the command, the per-project button, the step list, two scenarios and the `select` step.

**Files:**
- Create: `src/renderer/ui/dialog.tsx`, `src/renderer/workspaces/new-workspace-dialog.tsx`, `verify/scenarios/fresh-repo/scenario.json`, `verify/scenarios/failing-hook/scenario.json`
- Modify: `src/renderer/commands/command-registry.ts`, `src/renderer/window/app-window.tsx`, `src/renderer/projects/sidebar.tsx`, `src/renderer/projects/use-projects.ts`, `verify/scenario.ts`, `verify/repo-recipe.ts`, `verify/cli.ts`, `verify/journeys/projects.ts`

**Interfaces:**
- Consumes: `workspaces.prepare`, `workspaces.create`, `workspaces.step`, `subscribe`, `invoke`, `workspaceNameProblem`, `Button`, `KeyHint`, `StatusPixel`.
- Produces:
  - `Dialog({ title: string; description?: string; testId: string; onClose(): void; closable: boolean; children: ReactNode; footer: ReactNode })`. A fixed overlay `inset-0 z-50` with a `bg-bg/60` scrim that closes on click when `closable`. The panel `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title, test id, centred at `top-[12vh]`, `w-[min(480px,calc(100%-32px))] max-h-[calc(100%-24vh)] flex flex-col overflow-hidden rounded-[12px] border border-line bg-raised shadow-raised`. Header `px-[18px] pt-4 pb-[6px]` with the `h2` `text-[16px] font-semibold`. The description `px-[18px] text-[13px] text-dim`. The body `flex flex-col gap-[14px] px-[18px] py-4 overflow-y-auto min-h-0`. The footer `flex items-center justify-end gap-2 border-t border-line bg-side px-[18px] py-3`. Escape closes when `closable`. Tab and Shift+Tab cycle inside the panel. Focus returns on close to the element that had it on open, if it is still in the document.
  - `useProjects` gains `upsertWorkspace(projectId: string, workspace: WorkspaceView): void` and `dropWorkspace(projectId: string, key: string): void`, which change the local list at once and count as a change like `added` does.
  - `NewWorkspaceDialog({ project: ProjectView; onClose(): void; onCreated(workspace: WorkspaceView): void })`.
  - Commands `workspace.new` per Global Constraints. The sidebar's project row gains, at `ml-auto` after the missing readout, a small ghost icon-only `Button` with the plus icon, label `New workspace in <name>`, test id `new-workspace-<name>`, shown only when the project is not missing, which opens the dialog for that project.
  - `projects.ts` journey's `menuCommands` becomes 8, since `workspace.new` is available with alpha selected.
  - Scenario `write` gains `executable?: boolean`, which sets mode `0o755` after writing (a no-op on Windows). Step `select=<testid>:<label>` calls `page.getByTestId(testid).selectOption({ label })`, splitting at the first `:`, both parts required.

- [ ] **Step 1: The dialog's content.** Title `New workspace`, description `A fresh worktree and branch in <project>.`
  - On open it calls `workspaces.prepare`. While waiting the body reads `Reading <project>…` in `text-[13px] text-dim`. A failure shows the bridge's sentence in `role="alert"` `text-[13px] text-sigfg`, test id `workspace-failure`, and the footer holds only a ghost `Close`, test id `close-workspace-dialog`.
  - The name field. A `label` `Name` in `text-[12px] font-semibold text-fg2`, then the `input`, test id `workspace-name`, `h-8 px-[10px] rounded-[8px] border border-ctl bg-side text-[13px] text-fg font-mono outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgb(106_75_255/0.22)]`, `maxLength` 48, `spellCheck={false}`, `autoComplete="off"`, `autoCapitalize="off"`, prefilled with the suggested name, focused with its text selected. Below it `workspace-name-problem` in `text-[12px]`, showing `workspaceNameProblem`'s sentence in `text-sigfg` when there is one, a refusal sentence from create in `text-sigfg`, and otherwise `The branch takes the same name.` in `text-dim`. Typing clears a create refusal.
  - The start field. A `label` `Start from`, then a native `select`, test id `workspace-start`, styled like the input but in `font-sans`. Its first option is `Latest <branch> from <remote>` for `remote`, `<branch>, where <project> is now` for `local` with a branch, `The commit <project> is on now` for `local` without one, and its value means `{ kind: "default" }`. Then one option per branch with its `label` as text, meaning `{ kind: "ref", ref }`. For `empty` the field is replaced by `<project> has no commits yet. Make a first commit, then make a workspace.` in `text-[13px] text-fg2`, test id `workspace-start-note`, and Create stays disabled.
  - The note, test id `workspace-hooks-note`, `text-[12px] text-dim`, `git runs the repository's own checkout hooks and filters, as it does in your terminal.`
  - The footer. At the left `margin-right:auto` a plain `KeyHint` `Esc` with `to close` in `text-[12px] text-dim`. A ghost `Cancel`, test id `cancel-workspace`. A primary `Create workspace` with the hint `↵`, test id `create-workspace`, disabled while the name has a problem or the start is `empty`. Enter in the name field creates.
- [ ] **Step 2: Making it.** Create picks a fresh `crypto.randomUUID()` as `operationId`, subscribes to `workspaces.step` for that id first, then calls `workspaces.create`. While it runs the fields are disabled, the dialog is not closable and the footer holds only the disabled primary reading `Creating…`.
  - The steps replace the note, in a list `workspace-steps` with `aria-live="polite"`, `border border-line rounded-[10px] overflow-hidden`, one row per step, test ids `step-<id>`, `min-h-[42px] flex items-center gap-[10px] px-[14px] border-t border-line first:border-t-0 text-[13px]`. Titles, `Find the starting point`, `Make the branch <name>`, `Check out the worktree`, `Copy the files .worktreeinclude lists`, `Add the workspace to Satellite`. Pending rows are `text-dim` with an idle pixel. Running is `bg-side text-fg font-semibold` with an idle pixel and the readout `Running`. Done is `text-fg` with a ready pixel and the readout `✓`. Failed has a needs you pixel and the readout `Failed`. Undone has an idle pixel and the readout `Undone`. Readouts are `ml-auto font-pixel text-[12px] uppercase text-dim`. A step's detail shows under its title in `text-[12px] text-dim font-normal`.
  - Success calls `onCreated`. `AppWindow` then upserts the workspace, selects it and persists, shows the info toast `<name> is ready in <project>.` and closes the dialog.
  - A refusal with no step reported yet (name taken, limits, a creation already running) returns to the form with the sentence in `workspace-name-problem`. Any other failure keeps the steps, shows the sentence under them in `role="alert"`, test id `workspace-failure`, and the footer becomes a ghost `Close` (`close-workspace-dialog`) and a primary `Try again` (`try-again-workspace`), which returns to the form with the typed name and start kept.
- [ ] **Step 3: Scenarios.**
  - `fresh-repo`, described as "A clone of a local upstream whose main moved on since the last fetch, with a release branch, a .worktreeinclude and ignored files in the main folder." `folders` holds `upstream`. Write `README.md` (`# Verify repo\n`), `.gitignore` (`.env\n*.log\n*.local.json\nnode_modules/\n`) and `.worktreeinclude` (`.env\nconfig/*.local.json\nscratch.txt\n`), `git init -b main`, `git add .`, `git commit -m "first commit"`, `git switch -c release`, write `RELEASE.md` (`Release notes.\n`), `git add RELEASE.md`, `git commit -m "release notes"`, `git switch main`, write `CHANGELOG.md` (`Second commit.\n`), `git add CHANGELOG.md`, `git commit -m "second commit"`. `repo` is `git clone ../folders/upstream .`, `git branch release origin/release`, `git switch -C main HEAD~1`, `git update-ref refs/remotes/origin/main HEAD`, then writes `.env` (`API_URL=http://localhost:3000\n`), `config/dev.local.json` (`{}\n`), `notes.log` (`ignored and not listed\n`), `node_modules/pkg/.env` (`inside an ignored folder\n`) and `scratch.txt` (`untracked and not ignored\n`). `home`, `gh` and `claude` as in `default`.
  - `failing-hook`, described as "A fresh repo whose post-checkout hook fails, so making a workspace must undo itself." The `default` repo plus a write of `.git/hooks/post-checkout` with `#!/bin/sh\nexit 1\n` and `executable: true`, and `default`'s `home`, `gh` and `claude`.
- [ ] **Step 4: Prove it.**
  - `npm run --silent verify -- fresh-repo --keep choose-folder=repo click=add-first-project wait-for=new-workspace-repo click=new-workspace-repo wait-for=create-workspace shot=new-light theme=dark shot=new-dark type=first-look click=create-workspace wait-for=workspace-repo-first-look text=toast tree`. The toast answers `first-look is ready in repo.` and the tree shows `first-look` current. Then, with the printed `home` and `repo`, `git -C <home>/worktrees/repo/first-look log -1 --format=%s` prints `second commit`, `git -C <home>/worktrees/repo/first-look branch --show-current` prints `first-look`, `git -C <repo> log -1 --format=%s` prints `first commit`, `ls -a <home>/worktrees/repo/first-look` and `ls -a <home>/worktrees/repo/first-look/config` show `.env`, `dev.local.json` and no `notes.log`, `node_modules` or `scratch.txt`. Paste all output.
  - `npm run --silent verify -- fresh-repo --keep choose-folder=repo click=add-first-project wait-for=new-workspace-repo click=new-workspace-repo wait-for=create-workspace type=from-release select=workspace-start:release click=create-workspace wait-for=workspace-repo-from-release`, then `ls <home>/worktrees/repo/from-release` shows `RELEASE.md`.
  - `npm run --silent verify -- fresh-repo choose-folder=repo click=add-first-project wait-for=new-workspace-repo click=new-workspace-repo wait-for=create-workspace type=Bad text=workspace-name-problem` answers the pattern sentence, and `... type=main click=create-workspace wait-for=workspace-name-problem text=workspace-name-problem` answers `A branch named main already exists in repo. Pick another name.`
  - `npm run --silent verify -- failing-hook --keep choose-folder=repo click=add-first-project wait-for=new-workspace-repo click=new-workspace-repo wait-for=create-workspace type=will-fail click=create-workspace wait-for=workspace-failure text=workspace-failure text=workspace-steps shot=failed-light theme=dark shot=failed-dark`. The failure reads `git couldn't check out the worktree, or one of the repository's hooks failed. Satellite removed what it had made, so nothing changed.`, and then `git -C <repo> branch --list will-fail` prints nothing, `git -C <repo> worktree list` lists only the repo and `ls <home>/worktrees/repo` is empty.
  - A narrow run, `npm run --silent verify -- fresh-repo choose-folder=repo click=add-first-project wait-for=new-workspace-repo resize=960x600 click=new-workspace-repo wait-for=create-workspace shot=new-narrow` shows the whole dialog with its footer.
  - `./scripts/check` and `npm run --silent journeys` green.
- [ ] **Step 5: Commit.** `feat(workspaces): make a workspace from the sidebar or the command menu`, `test(verify): select an option and seed an executable hook`.

---

### Task 6: Archive

Inspection, the fingerprint, stopping terminals in the folder, removal with leftovers, the dialog and the command.

**Files:**
- Create: `src/main/workspaces/workspace-archive.ts`, `src/main/workspaces/workspace-archive.test.ts`, `src/renderer/workspaces/archive-dialog.tsx`
- Modify: `src/shared/bridge-contract.ts`, `src/main/workspaces/workspace-handlers.ts`, `src/main/terminal/terminal-sessions.ts`, `src/main/terminal/terminal-sessions.test.ts`, `src/main/main.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/ui/button.tsx`, `src/renderer/ui/icon.tsx`, `src/renderer/commands/command-registry.ts`, `src/renderer/window/app-window.tsx`, `src/renderer/projects/workspace-header.tsx`, `verify/journeys/projects.ts` (only if the menu count changes, it should not, since alpha's main cannot be archived)

**Interfaces:**
- Consumes: `readStatus`, `listWorktrees`, `runGit`, `isWorktreeFolder`, `ProjectStore`, `Dialog`.
- Produces:
  - `terminal-sessions.ts`. Each session keeps the `cwd` it started in. `createTerminalSessions()` also answers `sessionsInside: WorkspaceSessions` with `interface WorkspaceSessions { countInside(folder: string): number; stopInside(folder: string): Promise<void> }`, exported from that file. `countInside` counts running sessions whose cwd `isInsidePath(folder, cwd)`, and `stopInside` ends each with the existing `end` and awaits their kills. Specs 004 and 009 replace what stands behind these two methods.
  - `workspace-archive.ts`.
    - `inspectWorkspace(home: string, record: StoredWorkspace, sessions: number): Promise<InspectView>`, the `workspaces.inspect` response. It throws `BridgeFailure("failed", "Satellite couldn't read <name>, so it won't archive it. Try again.")` when `isWorktreeFolder` fails, the worktree is not listed, or the status read fails. `locked` from the listed worktree. `files` the first 50 status entries, `moreFiles` the rest. `commits`, with `git remote` empty, `no-remote`. On a branch, `unpushed` with `rev-list --count HEAD --not --remotes` and up to 5 subjects from `log`. Detached, `lost` with the `--branches --remotes --tags` forms. A failed count, `unknown`. `fingerprint` is the SHA-256 hex of `JSON.stringify([head, branch, locked, status raw, commits])`.
    - `archiveWorkspace(home: string, record: StoredWorkspace, fingerprint: string, sessions: WorkspaceSessions): Promise<{ leftover: boolean }>`, in this order. Inspect again and refuse a different fingerprint with `BridgeFailure("refused", "Something changed in <name> since you looked. Here is the latest.")`. Refuse a locked worktree with `BridgeFailure("refused", "<name> is locked in git, so Satellite won't archive it. Run git worktree unlock on it first.")`. `stopInside(record.path)`. `worktree remove --force --end-of-options <path>` (`worktreeRemoveMs`), never `--force` twice. If git still lists the path afterwards, throw `BridgeFailure("failed", "git couldn't remove the worktree, so <name> stays as it was.")`. If the folder still exists and `isWorktreeFolder` holds, `rm` it as in Task 4's undo. `leftover` is whether the folder still exists.
  - `workspaces.inspect` and `workspaces.archive` join `workspaceHandlers`, which now also takes `sessions: WorkspaceSessions`. Both find the record by id in `store.project(projectId)` or answer `not-found` with `That workspace is not in Satellite.` Archive adds the id to `store.busy`, runs `archiveWorkspace`, then `store.removeWorkspace`, and removes the id from `busy` in a `finally`, so the listing never reports it as removed outside Satellite.
  - `Button` gains the variant `danger`, `border-ctl bg-bg text-sigfg hover:bg-hover`. `IconName` gains `archive` with the BRAND.html `i-archive` symbol, `<rect x="2" y="2.75" width="12" height="3.25" rx="1" />` and `<path d="M3 6v6.25c0 .55.45 1 1 1h8c.55 0 1-.45 1-1V6M6.5 8.75h3" />`.
  - `ArchiveDialog({ project: ProjectView; workspace: WorkspaceView; onClose(): void; onArchived(leftover: boolean): void })`.
  - Command `workspace.archive` per Global Constraints. The header gains, before `remove-project`, a small ghost `CommandButton` for it with the archive icon and the text `Archive`, test id `archive-workspace`, only for a worktree workspace.

- [ ] **Step 1: Tests.** See each fail first.
  - `terminal-sessions.test.ts`, `stops only the terminals running inside a folder`, with the existing test's pty stand-in and two sessions started from different folders where each session records `workingFolder()` when it starts, so the test sets `vi.spyOn(process, "cwd")` to a different temp folder before each `terminal.start`.
  - `workspace-archive.test.ts`, real git in temp folders and a temp home whose worktree is made with real `git worktree add` under `<home>/worktrees/<segment>/<name>`.
    - `lists uncommitted files and commits that are not pushed`, one modified, one untracked, one commit not on the remote.
    - `says commits on a detached head would be lost`.
    - `says a repository with no remote has nothing pushed`.
    - `refuses when the workspace changed since it was inspected`, a file written after the inspection.
    - `refuses a locked worktree and never forces twice`.
    - `removes the worktree and keeps the branch`, after which `git worktree list` lists only the main folder and `git branch --list <name>` prints the branch.
    - `never touches a folder outside the worktrees folder`, a record whose path is a temp folder outside the home is refused before git runs, and that folder is untouched.
- [ ] **Step 2: Implement** the main side per the interfaces, wire it in `main.ts` with `terminals.sessionsInside`, and add the spies and `refuses to archive the main workspace or without a fingerprint` (`workspaceId: "main"`, a 63 character fingerprint, uppercase hex), each `invalid-request`.
- [ ] **Step 3: The dialog.** `Dialog` with title `Archive <name>`, description `Here is what happens to the work in this worktree.`, test id `archive-dialog`.
  - On open, and again after a fingerprint refusal, it calls `workspaces.inspect`. While waiting the body reads `Checking <name>…`. A failure shows the sentence in `role="alert"`, test id `archive-failure`, with only a ghost `Close`.
  - The rows follow `.s-loss`, each `flex items-center gap-[10px] min-h-8 text-[13px]` with a pixel.
    - Files, test id `archive-files`. With files, a needs you pixel and `<n> files aren't committed and will be deleted.` (`1 file isn't committed and will be deleted.`), then the paths in a list `max-h-[160px] overflow-y-auto font-mono text-[12px] text-fg2 pl-4`, each `<code> <path>`, and `and <k> more` when `moreFiles` is above 0. Without files, a ready pixel and `Nothing uncommitted.`
    - Commits, test id `archive-commits`. `unpushed` above 0, an idle pixel and `<n> commits aren't pushed. The branch <branch> keeps them.` (`1 commit isn't pushed. The branch <branch> keeps it.`) with the subjects listed below like the paths. `unpushed` at 0, a ready pixel and `Every commit is pushed.` `lost` above 0, a needs you pixel and `<n> commits aren't on any branch and will be lost.` (`1 commit isn't on any branch and will be lost.`). `lost` at 0, a ready pixel and `Every commit is on a branch.` `no-remote`, an idle pixel and `This repository has no remote, so nothing here is pushed. The branch <branch> keeps every commit.` `unknown`, an idle pixel and `Satellite couldn't count the commits that aren't pushed.`
    - Sessions, test id `archive-sessions`, only when above 0, an idle pixel and `<n> Claude Code terminals running here stop first.` (`1 Claude Code terminal running here stops first.`)
    - Always, an idle pixel and `Files git ignores, like dependencies and build output, are deleted with the folder.`
    - Locked, test id `archive-locked`, a needs you pixel and the locked sentence from the interfaces, and the confirm button is disabled.
    - After a fingerprint refusal, `Something changed in <name> since you looked. Here is the latest.` above the rows in `text-[13px] text-fg2`, test id `archive-notice`.
  - The footer. A ghost `Cancel` at `margin-right:auto`, test id `archive-cancel`. The confirm, test id `archive-confirm`, is a `danger` Button `Archive anyway` when any file or any lost commit is listed, and otherwise a primary `Archive workspace`. While archiving the dialog is not closable and the confirm is disabled and reads `Archiving…`. A failure other than the fingerprint shows its sentence in `archive-failure`.
  - Success calls `onArchived`. `AppWindow` drops the row, selects that project's main workspace when the archived one was selected and persists, and shows `Satellite archived <name>. The branch <branch> stays.` (`Satellite archived <name>.` with no branch), or with `leftover`, `Satellite archived <name>, but some files were in use and stayed in its folder.` as an error toast.
- [ ] **Step 4: Prove it.**
  - `npm run --silent verify -- unpushed-work --keep wait-for=workspace-repo-fix-login click=workspace-repo-fix-login click=archive-workspace wait-for=archive-files text=archive-files text=archive-commits shot=archive-light theme=dark shot=archive-dark click=archive-confirm wait-for=toast text=toast tree`. `archive-files` lists `README.md` and `notes.md` under `2 files aren't committed and will be deleted.`, `archive-commits` reads `1 commit isn't pushed. The branch fix-login keeps it.` with `fix the login redirect`, the confirm reads `Archive anyway`, the toast reads `Satellite archived fix-login. The branch fix-login stays.` and the tree has no `workspace-repo-fix-login` and the main row current. Then `git -C <repo> worktree list --porcelain` lists only the repo, `git -C <repo> branch --list fix-login` prints `fix-login`, and `ls <home>/worktrees/repo` is empty.
  - `npm run --silent verify -- unpushed-work wait-for=workspace-repo-fix-login click=workspace-repo-fix-login press=Meta+K type=archive tree` on macOS lists `command-workspace-archive`.
  - `./scripts/check` and `npm run --silent journeys` green.
- [ ] **Step 5: Commit.** `feat(workspaces): archive a workspace after showing what would be lost`.

---

### Task 7: The workspaces journey and the boundary cases

One journey that proves the two journey items of the spec, plus refusals in `boundary`.

**Files:**
- Create: `verify/journeys/workspaces.ts`
- Modify: `verify/journeys.ts`, `verify/journeys/boundary.ts`

**Interfaces:**
- Consumes: `launchApp`, `AppSession.relaunch`, `answerFolderDialog`, `gitEnv`, `waitUntil`, `withoutGitVariables`.
- Produces: `workspacesJourney: Journey` with scenario `fresh-repo`, listed after `projects` and before `quit`.

- [ ] **Step 1: The journey**, in this order, each assertion with a message that says what went wrong, every wait through `waitUntil` or `waitFor`, the modifier from the platform as in `projects.ts`, and nothing that depends on the window's width.
  1. Answer the dialog with the repo, click `add-first-project`, wait for `new-workspace-repo`.
  2. Click `new-workspace-repo`, read `workspace-name`'s value and assert it matches `workspaceNamePattern`, fill it with `first-look`, press Enter, wait for `workspace-repo-first-look` with `aria-current="true"`, and assert the toast reads `first-look is ready in repo.`
  3. In `<home>/worktrees/repo/first-look` assert `.env` and `config/dev.local.json` exist with the bytes the scenario wrote, `notes.log`, `node_modules` and `scratch.txt` do not, and `git log -1 --format=%s` there prints `second commit`.
  4. Press the new workspace shortcut, fill `second-look`, choose `release` with `selectOption`, click `create-workspace`, wait for `workspace-repo-second-look`.
  5. Write `src/only-here.ts` into first-look's folder with `writeFile`. Assert it is absent in second-look's folder and in the repo, that `RELEASE.md` exists in second-look and not in first-look, and that `CHANGELOG.md` exists in first-look and not in second-look.
  6. Delete second-look's folder with `rm(path, { recursive: true, force: true })` after asserting with `isInsidePath` that it is inside the session's home. `relaunch()`. Assert `workspace-repo-second-look` is gone, `workspace-repo-first-look` is still there with `workspace-repo-first-look-meta` containing `1` (the file from step 5), and a toast reads `second-look left repo because its folder was deleted outside Satellite. git still counts second-look as checked out there until you run git worktree prune.`
  7. Assert no console errors.

  Before trusting it, turn off one guard at a time for one run (list prunable worktrees as kept, skip the `.worktreeinclude` ignored check, start from the cached ref without fetching) and see the journey fail with a legible reason, then restore.
- [ ] **Step 2: Boundary.** Through the page's `window.satellite.invoke`, `workspaces.create` with name `../../outside` and with `-x` answers `invalid-request`, `workspaces.archive` with `workspaceId: "main"` answers `invalid-request`, and afterwards `<home>/worktrees` does not exist. Turn the shared name check off for one run and see the case fail.
- [ ] **Step 3: Prove it.** `npm run --silent journeys` prints `pass launch`, `pass boundary`, `pass projects`, `pass workspaces`, `pass quit`, and `./scripts/check` is green. Push nothing. The release matrix on `platforms/<slug>` is the controller's call.
- [ ] **Step 4: Commit.** `test(verify): prove two workspaces hold different files and a deleted one leaves on restart`.

---

### Task 8: Docs, skills and status Done

Every doc this spec made wrong, fixed in one change.

**Files:**
- Modify: `ARCHITECTURE.md`, `SATELLITE.md` (only if something is now true and missing), `DESIGN.md` (only the danger button and the dialog if absent), `.claude/skills/satellite-stack/SKILL.md`, `.claude/skills/satellite-verify/SKILL.md`, `.claude/skills/satellite-conventions/SKILL.md` (only if a rule changed), `specs/003-workspaces/spec.md`, `specs/README.md`

- [ ] **Step 1: ARCHITECTURE.md.**
  - Parts and Folder layout. `src/main/workspaces/` (the git helper and readers, names and folders, the include matcher and copy, creation, archive and their handlers), `src/renderer/workspaces/` (the two dialogs), `src/renderer/ui/dialog.tsx`, `src/shared/workspace-name.ts`, and `src/main/projects/workspaces.ts` gone.
  - Bridge. One row each for `workspaces.prepare`, `workspaces.create`, `workspaces.inspect`, `workspaces.archive` and the `workspaces.step` event, each with the hostile page reasoning from Global Constraints, and the changed `projects.list`, `projects.remove` and `interface.save` rows.
  - State. `projects.json` version 2 with workspace records, the migration, and `interface.json`'s widened selection.
  - Projects. The Read only paragraph rewritten to the commands Satellite now runs, that listing reads also run `git status` without optional locks and fsmonitor, which can run clean filters the repository's config names, that creation runs the repository's hooks and filters by design and says so, and that every git call carries the prompt-free environment and `gitArgs`. A new Workspaces section with the folder layout, the name rule, what creation writes into `.git` (the paragraph at the top of this plan), the steps and their undo, the comparison and its three sentences, and archive with its fingerprint, the locked refusal and leftovers.
  - Platform. The git environment keys.
  - Decisions. Rows for making the branch before the worktree, `--no-track`, never pruning, hooks running during creation, the fingerprint, and the `-z` fallback.
- [ ] **Step 2: Skills.** `satellite-stack`, the folder map pointer stays, add that every git call goes through `gitArgs` and `runGit` and that a new git command lists its config-driven programs and writes before it ships. `satellite-verify`, the `workspaces` and `write.executable` fields, folders built before the repo, the app's git config, the `select` step, the three scenarios, the `boundary` and `projects` row changes (eight commands), the `workspaces` journey row, and feature map rows for 003. `satellite-conventions` names worktree create and delete safety already, so it changes only if a rule did.
- [ ] **Step 3: SATELLITE.md.** Add only what is now true and missing, if anything. Do not restate the spec.
- [ ] **Step 4: Status.** Spec and index to **Done**. Leave `plan.md` to the controller.
- [ ] **Step 5: Check.** `./scripts/check` and `npm run --silent journeys` green, last lines in the report. Commit `docs: describe workspaces and mark spec 003 done`.

---

## Acceptance map

| Acceptance item or scope bullet | Task | Proof |
| --- | --- | --- |
| Creating a workspace makes the worktree and branch from the remote default branch and selects it | 4, 5, 7 | `create-steps.test.ts`, the `fresh-repo` run in Task 5 Step 4 with `second commit` in the worktree, journey step 2 and 3 |
| Files listed by `.worktreeinclude` are present in the new worktree and other ignored files are not | 3, 4, 5, 7 | `worktree-include.test.ts`, `include-copy.test.ts`, `create-steps.test.ts`, the `fresh-repo` run, journey step 3 |
| A name that is not a valid branch or that escapes the worktrees folder is refused | 2, 3, 4, 7 | `workspace-name.test.ts`, `worktree-folders.test.ts`, the registry refusals, the `boundary` cases |
| Archive lists uncommitted files and commits that are not pushed before anything is removed | 6 | `workspace-archive.test.ts`, the `unpushed-work` run in Task 6 Step 4 |
| After archive the worktree is gone, `git worktree list` is clean and the branch exists | 6 | the same run with `git worktree list --porcelain` and `git branch --list fix-login`, `workspace-archive.test.ts` |
| A worktree deleted outside the app disappears from the sidebar on the next start | 2, 7 | `project-list.test.ts`, journey step 6 |
| Two workspaces of one project hold different files at the same time | 7 | journey step 5 |
| Scope, the name is generated and can be changed, the branch takes the same name | 3, 5 | `workspace-names.test.ts`, journey step 2 |
| Scope, the branch starts from an existing branch chosen from a list | 4, 5, 7 | `create-steps.test.ts`, the `select=workspace-start:release` run, journey step 4 |
| Scope, the worktree lives under `~/.satellite/worktrees/<project>/<workspace>`, never inside the repo | 3, 5 | `worktree-folders.test.ts`, the `ls <home>/worktrees/repo/first-look` checks |
| Scope, each step of creation is visible and a failure leaves nothing half made | 4, 5 | `workspace-creation.test.ts`, `create-steps.test.ts`, the `failing-hook` run |
| Scope, the sidebar shows branch, ahead and behind and changed files | 1, 2 | the parser tests, the `unpushed-work` rows run in Task 2 Step 6, journey step 5 |
| Scope, archive stops the workspace's sessions and processes and removes the worktree, the branch stays | 6 | `terminal-sessions.test.ts`, `workspace-archive.test.ts`, the `unpushed-work` run |
| Scope, a branch already checked out elsewhere is explained instead of failing | 2 | `project-list.test.ts` explains a dropped workspace whose branch is checked out elsewhere, the prunable sentence in journey step 6 |
| Scope, a project's main workspace cannot be archived | 6, 7 | `workspaceId` is a UUID, the registry refusal, the `boundary` case, no archive button or command on main |
| Carry-over, unique `aria-current` and test id per workspace row | 2 | the `unpushed-work` tree in Task 2 Step 6 |
| Carry-over, the workspace key widens beyond `main` | 2 | the contract and the registry refusal |
| Carry-over, removing a project that still has workspaces | 2 | `project-list.test.ts`, the `remove-project` run in Task 2 Step 6 |
