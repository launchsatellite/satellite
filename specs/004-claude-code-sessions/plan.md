# Claude Code Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The right column runs the user's own `claude` in the selected workspace's folder, as tabs, several per workspace. Every session keeps running and keeps its screen while another workspace is selected. Each launch carries a session id Satellite chooses and status hooks for that process only, which post to a loopback listener guarded by a secret made for that launch. Each session is idle, working, needs you, done or stopped, and each sidebar row shows its workspace's most urgent session as one pixel. After a restart a workspace offers to resume its last session. Send to Claude Code types a cleaned request into the prompt and never submits it. Links open in the system browser after a check, image paste and dropped files work, and Satellite draws only the moments around Claude Code.

**Architecture:** The background process owns everything that runs. `terminal.start` now names a workspace, never a folder, and the background process looks the folder up in `projects.json`, builds Claude Code's arguments itself and writes a per-launch settings file holding only HTTP hooks into the Satellite home. A small `node:http` server on `127.0.0.1` takes the hooks, checks the launch's secret, answers `204` with no body, and feeds a pure status machine whose changes go to the page as an event. The last resumable Claude Code session id per workspace lives in a new `sessions.json`. The interface keeps one xterm.js instance per session mounted for the whole page load, hides the ones whose workspace is not selected, and draws tabs, the pixels, the resume offer and the ended, stopped and missing moments. Links go through a new `links.open` channel that only takes `http` and `https`.

**Tech Stack:** As in spec 003. Electron 45, React 19, TypeScript 6, zod 4, Tailwind 4, Vitest 5, playwright-core 1.65, Node 24, `@xterm/xterm` 6.0.0, node-pty 1.1.0. One new dev dependency, `@xterm/addon-web-links` 0.12.0, the current release, MIT, bundled into the renderer like the other xterm addons. No new runtime dependency.

**Spec:** `specs/004-claude-code-sessions/spec.md`

## What this writes and where

Nothing goes into the user's Claude Code settings or into a repository. Satellite writes two things, both in the Satellite home.

- `<home>/sessions/<launch id>.json`, one file per running launch, mode `0600` in a folder of mode `0700`, holding the hooks and that launch's secret. It is removed when the launch's process exits, and every leftover is removed at the next start.
- `<home>/sessions.json`, the last resumable Claude Code session id of each workspace, ids only.

Claude Code itself keeps writing what it always writes during a session, its transcript under its own config folder, its trust answers and its own state files. That is the user's own Claude Code at work, exactly as in their terminal.

## Rulings checked

Each was checked against current official documentation while planning, and the CLI against `claude --help` of Claude Code 2.1.329.

- **Session id and resume (code.claude.com/docs/en/cli-reference, `claude --help`).** `--session-id <uuid>` makes the session use that id and it must be a valid UUID. `-r, --resume [value]` resumes by id. The sessions page says `--resume <id>` finds a session from any folder, looking in the current project and its worktrees first, and an unknown id prints `No conversation found with session ID: <id>`. `/clear` starts a new session id in the same process. Resuming one session in two processes at once corrupts its transcript, so Satellite never resumes an id that is live. `--settings` is not restored by resume and has to be passed again, which every launch does.
- **`--settings <file-or-json>` (code.claude.com/docs/en/settings).** It loads extra settings from a file or a JSON string for one session, above the user, project and local files and below managed settings, and writes no file. Array settings such as hooks merge across levels, so the user's own hooks still run. Inline JSON was rejected because the argument list is readable by other users on the machine through `ps`, and the secret would be on it.
- **HTTP hooks (code.claude.com/docs/en/hooks).** A hook of `"type": "http"` takes `url`, `headers`, `allowedEnvVars` and `timeout` in seconds. Claude Code posts the event's JSON with `Content-Type: application/json`. A `2xx` with an empty body is success with no decision, and a non-`2xx` or a failed connection is a non-blocking error, so a listener that is down never stops Claude Code. Header values expand `$VAR` only for names listed in `allowedEnvVars`, and Satellite lists none and writes the secret as a literal, so `httpHookAllowedEnvVars` cannot break it. Omitting `matcher` matches every tool, source and notification type. The common input carries `session_id`, `transcript_path`, `cwd` and `hook_event_name`. `SessionStart` adds `source` of `startup`, `resume`, `clear`, `compact` or `fork`, and `Notification` adds `notification_type`. `SessionStart` runs only `command` and `mcp_tool` hooks, so Satellite's HTTP hook for it never posts, which the real run in Task 7 confirmed. The first hook of a launch is therefore its first prompt.
- **Which events say what.** `UserPromptSubmit` fires when the user submits a prompt. `PermissionRequest` fires when Claude Code is about to show a permission dialog. No event fires when the user answers one. An approval is followed by `PostToolUse` or `PostToolUseFailure` for that tool, and a manual deny or an interrupt has no event at all. `Notification` with `permission_prompt` follows about six seconds after an unanswered ask, `elicitation_dialog`, `elicitation_url_dialog` and `agent_needs_input` ask the user too, `elicitation_complete` and `elicitation_response` close an ask, and `idle_prompt` follows about 60 seconds of waiting after a finished turn. `Stop` ends a turn, `StopFailure` ends one on an API error, and neither fires on a user interrupt. A Stop hook of the user's own that blocks makes Claude Code carry on after `Stop`, so tool events after `Stop` mean working again. An interrupted turn therefore stays working until `idle_prompt` makes it done about a minute later, and a turn that ends in `StopFailure` looks done like any other.
- **What can block Satellite's hooks.** `disableAllHooks`, a managed `allowManagedHooksOnly`, and `allowedHttpHookUrls` defined at any level without Satellite's address all stop them. An interactive session also holds back every hook until its workspace trust dialog is accepted. In a git repository trust is kept for the repository root, and a linked worktree uses its main checkout's root, so every workspace of a trusted project is trusted. In each of these cases the session runs normally and its status stays idle.
- **Proxies (code.claude.com/docs/en/network-config).** Claude Code honours `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` in space or comma separated form. The docs do not say whether HTTP hooks bypass a proxy for loopback, so when one of the four proxy variables Claude Code reads is set, never `ALL_PROXY` since Claude Code supports no SOCKS proxy, Satellite adds `127.0.0.1` to `NO_PROXY` and `no_proxy` for Claude Code only. That shadows a `NO_PROXY` the user keeps in their Claude Code settings, since a launch environment value wins, so the real run in Task 7 under a proxy settles whether the rule stays.
- **Nested sessions.** Claude Code marks its own children with `CLAUDECODE`, and a `claude` that inherits it refuses to start as a nested session. Claude Code also sets `CLAUDE_CODE_CHILD_SESSION` in the processes its tools and hooks start, and a nested interactive `claude` that inherits it is left out of `--resume` and history. Satellite removes both, matched without regard to case on Windows, because the login environment inherits them when Satellite itself was started from a Claude Code session. For the same reason it removes the other markers Claude Code sets in its children, the IDE port and entry point an IDE terminal hands on, and the variables a terminal program, tmux, screen or VS Code sets, which Claude Code reads to pick key handling, colours and notification escapes for a terminal that is not Satellite's.
- **Terminal behaviour (code.claude.com/docs/en/terminal-config, interactive-mode).** A new line is `Ctrl+J`, `\` then Enter, or Shift+Enter where the terminal has an extended keyboard protocol, which xterm.js lacks, so the existing ESC CR stays. Image paste is `Ctrl+V`, and `Alt+V` on Windows, and Claude Code reads the system clipboard itself. A paste over 800 characters or three lines is shown as a placeholder, so Send keeps at most 800. Claude Code reads the terminal's background through OSC 11 at start to pick its theme, and xterm.js answers that query, but a later change of Satellite's theme is not seen by a running session.
- **xterm.js 6.0.0 (its typings and source).** `paste()` turns `\r\n` and `\n` into `\r` and, when the program turned on bracketed paste with mode 2004, wraps the text in `ESC [200~` and `ESC [201~`. It does not remove ESC, so pasted text holding `ESC [201~` would end the bracket early and its CR would submit. OSC 8 links reach `linkHandler.activate(event, text, range)`, and with `allowNonHttpProtocols` left false only `http` and `https` reach it. `@xterm/addon-web-links` 0.12.0 finds plain-text addresses and calls its handler with the event and the address.
- **Opening links (electronjs.org security checklist, item 15).** `shell.openExternal` must never get untrusted content unchecked, because other schemes can run programs. Satellite passes only a parsed `http:` or `https:` address with a host and no user name or password.
- **Browsers and loopback (fetch standard, CORS safelisted headers).** A web page may only send `Accept`, `Accept-Language`, `Content-Language`, `Content-Type` of three form types and `Range` without a preflight. `Authorization` and `Content-Type: application/json` both force a preflight, which Satellite answers with `405` and no CORS headers, so no browser page can send the hook request. DNS rebinding is closed by accepting only the `Host` `127.0.0.1:<port>`.
- **Windows (code.claude.com/docs/en/setup, nodejs.org child_process).** The native installer and the Windows package manager put `claude.exe` on the path. npm makes a `.cmd` shim, and a batch file needs `cmd.exe`, which re-parses its arguments. Node refuses to spawn one without a shell for that reason and node-pty has no such guard. Satellite keeps refusing `.cmd` and `.bat`.
- **Not confirmed.** Whether Claude Code's HTTP client sends an `Origin` header. The listener refuses any request that carries one, so the real `claude` run in Task 7 is the proof, and a refused hook there shows as a status that never leaves idle.

## Decisions the plan made

| Decision | Why | Cost if wrong |
| --- | --- | --- |
| The hooks go in a file in the Satellite home passed with `--settings <file>`, mode `0600`, removed when the process exits and swept at start | Inline JSON puts the secret on the argument list, and the environment would hand it to every program the agent runs | A crash leaves one file holding a dead secret until the next start |
| One 32 byte secret per launch, not per app run, in the header `Authorization: Bearer <64 hex>`, with the launch id in the hook's path | A secret one launch knows can never speak for another launch, and the path names which secret to compare against | None, it is a strict reading of "a secret made at start" |
| Hooks for `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `Stop` and `StopFailure` only, each with `"timeout": 5` | Those are the events the status needs. `PreToolUse` would add a round trip before every tool, and `SessionEnd` would spend Claude Code's 1.5 second exit budget on nothing the process exit does not already say | A state those events cannot see stays as it was until the next one |
| An `idle` status before the first prompt and after `/clear`, drawn grey like `stopped` | A session that has done nothing yet is neither working nor done | One more state than the spec names |
| `done` draws the lilac pixel the kit already has for done, `working` ultraviolet, `needs-you` signal, `idle` and `stopped` grey | The status pixel's states exist since spec 002 and signal is kept for needs you | A later spec that wants volt for a finished session changes one map |
| A workspace pixel shows needs you, then working, then done, then idle, then stopped | "Most urgent" from the spec, and only needs you is orange | None |
| The resumable id is the id a launch started with, or of its last `SessionStart` if one ever arrives, recorded per workspace in `sessions.json` once it has a `UserPromptSubmit` | A session never prompted has no transcript to resume | With hooks blocked there is no resume offer, and since Claude Code posts no HTTP `SessionStart`, after `/clear` resume brings back the conversation from before it |
| A resumed launch that exits non-zero before any hook arrived forgets the record and says so | An unknown id makes `claude` exit at once, and offering it again would fail forever | With hooks blocked and a crash right after resume, a good record is forgotten |
| The page never sees a Claude Code session id. `sessions.resumable` answers a boolean and `terminal.start` takes `resume: true` | A hostile page cannot pick which transcript is resumed | None |
| Claude Code gets the user's environment minus a deny list, `ELECTRON_*`, the AppImage launch keys, the identity of whatever started Satellite (Claude Code's own markers, the IDE port and entry point, the terminal program, tmux, screen and VS Code variables), plus `TERM`, `COLORTERM`, and `127.0.0.1` in `NO_PROXY` and `no_proxy` when a proxy is set | It needs the user's own `PATH`, proxy and provider variables, which Satellite passes on without reading. An allow list would break sign-in through any variable it forgot | A variable that confuses a nested `claude` and is neither marker still passes through |
| Keep refusing `.cmd` and `.bat` on Windows | Running a batch file means `cmd.exe` re-parsing a path Satellite wrote | An npm install on Windows shows as missing, and the tool check names the native installer |
| Send to Claude Code is the renderer function `sendToClaudeCode(text)`, which dispatches the window event `satellite:send-to-claude-code`, and the sessions pane is its one listener | Specs 006 and 008 call the function, and the driver dispatches the same event, so there is one path and no new channel | A page script can send text that way too, which is less than `terminal.write` already allows |
| Send replaces CR, LF, CRLF, tab and the two Unicode line separators with a space, removes every other control character, DEL, C1, lone surrogate, format character and supplementary variation selector apart from a zero-width joiner between emoji and a zero-width joiner or non-joiner between two Arabic or Indic letters, and keeps at most 800 characters, since Claude Code folds a longer paste into a placeholder. Dropped paths are refused for the same characters | The spec strips control characters and nothing may submit | A multi-line request arrives on one line |
| Sessions live for the page load, as terminals do today | Reload and crash cleanup already rely on it | A reload ends every session, and the resume offer brings each back |
| Scrollback stays 5000 lines per session | It is the documented limit, and 16 sessions of 200 columns stay near 200 MB at worst | A heavy user with 16 wide sessions uses that memory |
| Every link from terminal output, a plain-text address or an OSC 8 link, follows Cmd+click on macOS and Ctrl+click elsewhere and asks first in a dialog naming the site and the full address | An OSC 8 link's text can say anything, and output can hide part of a plain address with concealed text or a colour like the background | One extra click for every link |
| An image paste sends `Ctrl+V`, or `Alt+V` on Windows, and Claude Code reads the clipboard itself. Dropped files type their quoted paths | Satellite never reads the clipboard's image and Claude Code already knows how | None |
| Closing a tab ends its process without asking | The transcript is kept by Claude Code and the worktree is untouched, and resume brings the conversation back | A user who closes a working session by mistake starts it again |
| `links.open` records the address in a file named by `SATELLITE_VERIFY_LINKS` instead of opening the browser, like the folder dialog's verify file | Journeys must never open the user's browser | None outside verification |
| The CLI gains `wait-state`, `wait-text` and `send` steps | Real-app proofs need to wait on a status and on terminal text without fixed waits | None |

## Global Constraints

Every task is bound by `.superpowers/sdd/global-constraints.md`, `AGENTS.md`, `.claude/skills/satellite-conventions/SKILL.md`, `.claude/skills/satellite-stack/SKILL.md` (the bridge recipe) and `.claude/skills/satellite-verify/SKILL.md`. No comments, no casts, no `any`, kebab-case files, named exports, tests only where listed and each seen failing once, no home-folder paths in any file, never push. Example paths in tests are `/Users/<name>/` or `/home/<name>/`. Never read or write the real `~/.claude`, `~/.claude.json` or `~/.satellite`. The command guard matches text, so write a file whose content it would refuse with the file tools.

### Names and limits

- **Launch.** A launch id is `randomUUID()` from the background process, one per process started. A new session's Claude Code session id is another `randomUUID()` from the background process.
- **Settings files.** `<home>/sessions/<launch id>.json`, the folder made with mode `0o700`, the file written with flag `wx` and mode `0o600`. Leftover sweep, one promise per run that the first `terminal.start` begins and every start awaits before it writes, lists `<home>/sessions` once and unlinks each entry whose name matches `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/` and that `lstat` reports as a regular file or a symbolic link. A link is unlinked and its target never touched. Nothing else is removed and nothing is removed recursively.
- **Windows.** The settings file inherits the Satellite home's access list, which only the user and the system can read.
- **Secret.** `randomBytes(32).toString("hex")`, compared with `timingSafeEqual` on equal-length buffers. It lives only in the settings file and in the listener's memory, never on an argument list, in an environment, a log, a state file or an event.
- **Listener.** `127.0.0.1`, port `0`. `maxConnections = 64`, `headersTimeout = 5000`, `requestTimeout = 10_000`, `connectionsCheckingInterval = 1000`, `maxHeaderSize = 8192` with `maxHeadersCount = 0` so no header can hide past a count, every answer `Connection: close`, and at most 100 events per launch per second, beyond that `429`. Bodies are kept only for `SessionStart`, `Notification`, `PermissionRequest`, `PostToolUse` and `PostToolUseFailure`, at most 65536 bytes for the first two and 1 MiB for the three tool events, and every other body is drained unread before the answer, so a large one never breaks Claude Code's request.
- **Hook URL.** `http://127.0.0.1:<port>/hook/<launch id>/<event name>`.
- **Session events.** `hookEvents = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "Notification", "Stop", "StopFailure"] as const`.
- **Last sessions.** At most 4200 entries, 200 projects of 21 workspaces. Setting a new entry beyond that drops the oldest.
- **Send.** `promptTextLimit = 800` characters, cut on a code point boundary, from at most the first 12800 characters of the input. Claude Code folds a paste of more than 800 characters or more than three lines into a `[Pasted text #N]` placeholder (code.claude.com/docs/en/terminal-config, Paste large content), and sent text is always one line.
- **Links.** At most 2048 characters, one opened per 1000 milliseconds across the app.
- **Drops.** At most 20 files at a time, each path at most 4096 characters.
- **Terminals.** 16 at once as today, sessions of every workspace together.

### State

- **`sessions.json` version 1.** `{ "version": 1, "last": [{ "projectId": "<uuid>", "workspace": "main" | "<uuid>", "sessionId": "<uuid>" }] }`, at most 4200 entries, one per project and workspace pair. Read and written through `src/main/state/json-file.ts`. A file that fails to read is set aside like the others, logged with `console.error`, and shows no toast, since it only loses resume offers. An entry whose project or workspace is gone is never offered, because `sessions.resumable` resolves the folder first.
- `projects.json` and `interface.json` do not change.

### Contract

In `src/shared/bridge-contract.ts`.

- `sessionStatus = z.enum(["idle", "working", "needs-you", "done", "stopped"])`, type `SessionStatus`.
- `"terminal.start"` request becomes `z.strictObject({ id: z.uuid(), program: z.literal("claude"), workspace: workspaceRef, resume: z.boolean(), cols, rows })`. Response stays empty.
- `"sessions.resumable": { request: z.strictObject({ workspace: workspaceRef }), response: z.strictObject({ resumable: z.boolean() }) }`.
- `"links.open": { request: z.strictObject({ url: z.string().min(1).max(2048) }), response: empty }`.
- Event `"sessions.status": z.strictObject({ id: z.uuid(), status: sessionStatus, ready: z.boolean() })`, the terminal id, its new status and whether any hook from it has arrived, which Claude Code allows only once its trust question is answered.
- Event `"terminal.exit"` gains `ending: z.enum(["ended", "unexpected", "resume-failed"])`. `resume-failed` is a launch that resumed, exited with a non-zero code or a signal and never had a hook arrive. `unexpected` is any other exit with a non-zero code or a signal that Satellite did not cause by closing, archiving, removing, reloading or quitting. Everything else is `ended`.
- `"links.open"` arrives in Task 5, the rest in Task 3.
- Each new channel gets a spy in `src/main/bridge/registry.test.ts`, each new event a listeners `Set` in `src/renderer/bridge/bridge-client.ts`, and each a row in the Bridge table of `ARCHITECTURE.md` (Task 8).

### What a page running hostile script could do

Recorded in `ARCHITECTURE.md` in Task 8, decided here.

- **Can it start a process other than `claude`, or `claude` with arguments it chose?** No. `program` is the literal `claude`, which the background process resolves itself, from `SATELLITE_CLAUDE` or the path, never from the page. The arguments are built by `claudeArgs` from fixed flags, a UUID the background process made or read from `sessions.json`, and the settings file path it wrote. The strict schema refuses any extra field, so no `args`, `cwd`, `env` or `command` can ride along.
- **Can it start one in a folder that is not a recorded workspace?** No. The page names a project UUID and `main` or a workspace UUID. The folder is that project's recorded path or that workspace's recorded path, it must still be a directory, and a workspace being archived is refused.
- **Can it type into a session and submit?** Yes, as it could since spec 001. `terminal.write` is typing, Enter included, so such a page can make Claude Code do anything the user could ask, its `!` shell included. Claude Code's own permission prompts guard its tools, not the `!` shell. What guards this is the integrity of the interface, no remote content, the content security policy and terminal output drawn as text. Send to Claude Code adds nothing to it, and it is the only path that promises not to submit.
- `terminal.start` with `resume: true` can only resume the one id recorded for that workspace, never one that is live, within the 16 terminal limit.
- `sessions.resumable` answers one boolean for a workspace the page names. The id itself never reaches the page.
- `links.open` can open an `http` or `https` address in the system browser without a click, at most once a second. It cannot open `file:`, `javascript:`, `data:`, a custom scheme that starts a program, or an address with a user name or password. A browser page is less than what `terminal.write` and Claude Code's own web tools already reach.
- `sessions.status` goes only to the page that started the terminal and carries a status word and the ready flag.

### The hook listener and the settings file, threats

1. **A web page posting to the port.** `Authorization` and `application/json` force a preflight, answered `405` with no `Access-Control-*` header, so no browser sends the real request. A form post has no secret and gets `401`, and any request carrying `Origin` gets `403`.
2. **DNS rebinding.** Only `Host: 127.0.0.1:<port>` is accepted, anything else gets `403`.
3. **Another account on the machine.** It can find the port but not the secret, which is in a `0600` file in a `0700` folder and never on an argument list. Each guess is one 256 bit secret.
4. **Forged status from the same account, the agent included.** A process running as the user can read the settings file and post events, so it can make pixels lie. It can do nothing else through the listener, and a process running as the user already can do anything the user can.
5. **Influencing Claude Code.** Every accepted request gets `204` with no body, so the listener can never approve, deny or change anything Claude Code does. Whoever answers on the hook port can decide, though, so the listener stops only after every `claude` it configured has exited, and a process that cannot be ended keeps it running.
6. **Flooding.** 64 connections at most, headers within 5 seconds, a request within 10, no body read before the secret matches, bodies kept for five events and at most 65536 bytes, or 1 MiB for a tool event, a larger `SessionStart` or `Notification` answered `413` and dropped, a larger tool event taken without its agent, and at most 100 events per launch per second.
7. **Hostile event content.** Bodies are untrusted. Only `session_id` (a UUID or ignored), `source` and `notification_type` (strings of at most 64 characters) and `agent_id` (a string of 1 to 128 characters, else unknown) are read through a zod schema. Nothing from a body is stored except a validated session id and, while a session needs you, the agent that asked, and nothing is logged or shown.
8. **A stale launch.** A launch's secret is dropped from the listener as its process exits, so its file is useless afterwards and is removed.
9. **No listener.** When the server cannot start, sessions run without `--settings`, their status stays idle, and the error is logged once.

### Test ids

Kept, every test id from spec 003. `terminal`, `terminal-notice` and `start-claude` now sit only inside the shown session, or in the empty pane for `start-claude`, so each stays unique on screen. New.

- Sidebar, `<row test id>-status` on each workspace row's pixel, with `data-state` set to the pixel state.
- Pane, `sessions-empty`, `resume-session`, `session-tabs`, `new-session`, `session-tab-<n>` with `data-state` set to the session status and `aria-selected`, `close-session-<n>`, `claude-missing-fix`.
- Links, `link-dialog`, `link-address`, `link-open`, `link-cancel`.

### Commands

`session.new` "New Claude Code session", shortcut `{ key: "t" }`, available when a workspace is selected and its project's folder is there. `session.close` "Close this session", no shortcut, available when the selected workspace has a session tab. `session.next` "Go to the next session" and `session.previous` "Go to the previous session", no shortcut, available when the selected workspace has two tabs or more, wrap around. The registry list in `AppWindow` becomes `palette.commands`, `project.add`, `project.remove`, `workspace.new`, `workspace.archive`, `session.new`, `session.close`, `session.next`, `session.previous`, `palette.switcher`, `tools.check`, `theme.system`, `theme.light`, `theme.dark`.

### Copy

Every sentence is fixed in the task that shows it, and nothing else may be shown. No colons in prose, sentences end with a full stop, titles and button labels do not.

### Scenarios, steps and journeys

The stand-in gains the `hook` and `await` steps, resume output and a `hook` log event (Task 3). New scenarios `needs-permission` (Task 3) and `settings-files` (Task 7), and `flood` gains `"workspaces": []` (Task 3). New scenario field `claudeConfig` and the driver's temporary `CLAUDE_CONFIG_DIR` (Task 7). New steps `wait-text` (Task 3), `wait-state` (Task 4) and `send` (Task 6). New `AppSession` members `dropFiles`, `openedLinks` and `claudeConfig` (Tasks 5 and 7). New journeys `sessions` and `settings` (Task 7), changed journeys `boundary`, `launch` and `quit` (Tasks 3 and 7).

## Review Focus

1. **A page names no program, argument or folder.** `terminal.start` refuses extra fields, the folder comes from records, the arguments from `claudeArgs`. The registry refusals and `claude-launch.test.ts` pin it.
2. **The listener trusts nothing.** Every refusal in `hook-listener.test.ts`, no CORS header ever, `204` with no body, no body read before the secret matches, and nothing from a body stored, logged or shown beyond a validated id.
3. **Nothing lands in the user's settings or the repository.** The settings file sits in the Satellite home with mode `0600`, is gone after the process exits, and the `settings` journey compares every Claude Code settings file byte for byte.
4. **Send never submits.** No CR, LF or ESC survives `promptText`, and the journey shows the stand-in received the bracketed text with no CR after it.
5. **Links.** Only `http` and `https` with a host and no credentials reach `shell.openExternal`, every link asks first, and nothing opens without the modifier.
6. **No process outlives its tab.** Closing a tab, archiving, removing a project, reloading and quitting each end the process tree and remove the settings file.

---

### Task 1: Arguments, hook settings, the status machine and Claude Code's environment

The pure rules, with their tests. Nothing is wired yet.

**Files:**
- Create: `src/main/sessions/claude-launch.ts`, `src/main/sessions/claude-launch.test.ts`, `src/main/sessions/session-status.ts`, `src/main/sessions/session-status.test.ts`, `src/renderer/sessions/session-pixel.ts`, `src/renderer/sessions/session-pixel.test.ts`
- Modify: `src/shared/bridge-contract.ts` (only `sessionStatus` and its type), `src/main/platform/tools.ts`, `src/main/platform/tools.test.ts`

**Interfaces:**
- Consumes: `isFullyQualified` from `src/main/platform/paths.ts`, `PixelState` from `src/renderer/ui/status-pixel.tsx`.
- Produces:
  - In `claude-launch.ts`, `hookEvents` and `type HookEventName = (typeof hookEvents)[number]` as in Global Constraints.
  - `type ClaudeStart = { kind: "new"; sessionId: string } | { kind: "resume"; sessionId: string }`.
  - `claudeArgs(start: ClaudeStart, settingsFile: string | undefined): string[]`. New answers `["--session-id", id]`, resume answers `["--resume", id]`, each followed by `["--settings", settingsFile]` when a file is given. It throws an `Error` when the id fails `z.uuid()` or the file is not fully qualified, so a value can never be read as an option.
  - `hookSettings(baseUrl: string, secret: string): { hooks: Record<HookEventName, [{ hooks: [{ type: "http"; url: string; headers: { Authorization: string }; timeout: 5 }] }]> }`, one entry per event with `url` `${baseUrl}/${event}`, header `Bearer ${secret}`, no `matcher`, no `allowedEnvVars`.
  - In `session-status.ts`, `type Agent = string | null` with `mainThread = ""` for the main thread and `null` for an agent the listener could not read, `interface SessionState { status: SessionStatus; askers: readonly Agent[] }`, `type SessionEvent = { name: "SessionStart"; source: string | null; sessionId: string | null } | { name: "Notification"; type: string | null; agent: Agent } | { name: "PermissionRequest" | "PostToolUse" | "PostToolUseFailure"; agent: Agent } | { name: "UserPromptSubmit" | "Stop" | "StopFailure" } | { name: "Exit" }` and `nextState(current: SessionState, event: SessionEvent): SessionState` following this table for the status, where `ask` is a `Notification` of `permission_prompt`, `elicitation_dialog`, `elicitation_url_dialog` or `agent_needs_input`, `answered` one of `elicitation_complete` or `elicitation_response`, `idle prompt` one of `idle_prompt`, `other` any other or null type, `start` a `SessionStart` of any source but `compact`, and `post` either `PostToolUse` or `PostToolUseFailure`. Entering needs you records the asking agent, a `PermissionRequest` always and an ask only when the session did not need you yet. Every agent asking at once is kept, at most 16, the oldest dropped beyond that. While it needs you, a post answers that agent's ask, or else an ask whose agent is unknown, and the session works again once no ask is left, so another agent or the main thread finishing a tool beside an open dialog changes nothing, and a post whose agent is unknown changes nothing either. Leaving needs you forgets every asker.

    | Current | start | compact | UserPromptSubmit | PermissionRequest | post | ask | answered | idle prompt | other | Stop, StopFailure | Exit |
    | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
    | idle | idle | idle | working | needs-you | working | needs-you | idle | idle | idle | done | stopped |
    | working | idle | working | working | needs-you | working | needs-you | working | done | working | done | stopped |
    | needs-you | idle | needs-you | working | needs-you | working | needs-you | working | done | needs-you | done | stopped |
    | done | idle | done | working | needs-you | working | needs-you | done | done | done | done | stopped |
    | stopped | stopped | stopped | stopped | stopped | stopped | stopped | stopped | stopped | stopped | stopped | stopped |

  - In `session-pixel.ts`, `pixelOf(status: SessionStatus): PixelState` (idle and stopped to `idle`, the rest by name) and `mostUrgent(statuses: readonly SessionStatus[]): PixelState` in the order needs-you, working, done, then `idle`, also for an empty list.
  - In `tools.ts`, `claudeEnvironment(env: Record<string, string>, platform = process.platform): Record<string, string>`. It drops, in any case on Windows, `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SSE_PORT`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_BRIDGE_SESSION_ID`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_EFFORT`, `CLAUDE_JOB_DIR`, `CLAUDE_PID`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_CHILD_NOTES_DIR`, `CLAUDE_CODE_SESSION_ATTENDED`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERM_SESSION_ID`, `ITERM_SESSION_ID`, `LC_TERMINAL`, `KITTY_WINDOW_ID`, `KITTY_PID`, `KITTY_LISTEN_ON`, `KITTY_PUBLIC_KEY`, `WT_SESSION`, `TMUX`, `TMUX_PANE`, `STY` and every `VSCODE_` key, never a broad `CLAUDE_CODE_` prefix, since users set real options with it. When any of `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy` or `https_proxy`, the only proxy variables Claude Code reads, is non-empty, each of `NO_PROXY` and `no_proxy` becomes its value with `,127.0.0.1` added, or `127.0.0.1` when absent or empty, and stays as it is when one of its comma or space separated entries already is `127.0.0.1`.

- [ ] **Step 1: Tests.** Write these and see each fail because the modules do not exist.
  - `claude-launch.test.ts`.
    - `starts a new session with Satellite's id and settings`, exact array for `/Users/<name>/.satellite/sessions/<uuid>.json`.
    - `resumes a recorded session with the settings passed again`.
    - `leaves the settings out when there is no listener`.
    - `refuses an id that is not a UUID`, with `--help`, `-x` and an empty string, and `refuses a settings path that is not absolute`.
    - `posts every hook to its own path with the secret as a literal`, keys equal `hookEvents`, each URL ends with its event name, no `$` anywhere in the JSON text, no `allowedEnvVars`, no `matcher`.
  - `session-status.test.ts`.
    - `moves through every status from every status`, one case per cell of the table.
    - `follows a prompt that asks for permission and is approved`, `UserPromptSubmit`, `PermissionRequest`, `Notification permission_prompt`, `PostToolUse`, `Stop` gives working, needs-you, needs-you, working, done.
    - `stays done when the idle notice arrives late`, and `works again when a blocked Stop lets Claude Code carry on`, `Stop` then `PostToolUse` gives working.
    - `ignores everything once stopped`.
  - `session-pixel.test.ts`, `shows the most urgent session of a workspace`, including an empty list and `["stopped", "done"]` giving `done`.
  - `tools.test.ts`, `gives Claude Code the user's environment without the nesting marker` and `keeps loopback away from a proxy`, for an absent `NO_PROXY`, `NO_PROXY=example.com`, a list already holding `127.0.0.1`, and no proxy set, where nothing is added.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main/sessions src/renderer/sessions src/main/platform/tools.test.ts`, all pass.
- [ ] **Step 3: Prove it.** `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(sessions): build claude's arguments, its hooks, its status and its environment`.

---

### Task 2: The hook listener, the settings files and the last sessions

The loopback server, the per-launch file and the resume record, with their tests. Still not wired.

**Files:**
- Create: `src/main/sessions/hook-listener.ts`, `src/main/sessions/hook-listener.test.ts`, `src/main/sessions/settings-files.ts`, `src/main/sessions/settings-files.test.ts`, `src/main/sessions/last-sessions.ts`

**Interfaces:**
- Consumes: `hookEvents`, `HookEventName` from Task 1, `SessionEvent`, `createJsonWriter`, `readJsonFile` from `src/main/state/json-file.ts`, `workspaceRef`, `WorkspaceRef` from the contract.
- Produces:
  - In `hook-listener.ts`, `interface HookListener { readonly port: number; open(launchId: string): string; close(launchId: string): void; stop(): Promise<void> }` and `startHookListener(onEvent: (launchId: string, event: SessionEvent) => void): Promise<HookListener>`. `open` makes and keeps the launch's secret and answers it, `close` forgets it. Requests are checked in this order, and the first that fails answers and nothing else runs.
    1. Method other than `POST`, `OPTIONS` included, `405`.
    2. Path other than `/hook/<uuid>/<one of hookEvents>`, `404`.
    3. `Host` other than `127.0.0.1:<port>`, `403`.
    4. Any `Origin` header, `403`.
    5. `Authorization` missing, not `Bearer <64 lowercase hex>`, for an unknown launch, or not equal under `timingSafeEqual`, `401`.
    6. `Content-Type` whose type is not `application/json`, `415`.
    7. More than 100 events for the launch in the current second, `429`.
    8. For `SessionStart` and `Notification`, a body over 65536 bytes `413`. For those and for `PermissionRequest`, `PostToolUse` and `PostToolUseFailure`, JSON that fails to parse or to match `z.object({ session_id: z.string().max(100).optional(), agent_id: z.unknown().optional(), source: z.string().max(64).optional(), notification_type: z.string().max(64).optional() })` `400`. A `session_id` that fails `z.uuid()` becomes null. An absent `agent_id` is the main thread `mainThread`, a string of 1 to 128 characters is that agent, anything else and a tool event body over 1 MiB is unknown, `null`. Other events never read the body and drain it.
    9. Otherwise `onEvent` runs once and the answer is `204` with no body.
    No answer carries an `Access-Control-*` header or a body, and errors from `onEvent` are logged and still answered `204`.
  - In `settings-files.ts`, `writeSettingsFile(home: string, launchId: string, settings: object): Promise<string>`, which makes `<home>/sessions` with mode `0o700`, writes the JSON with flag `wx` and mode `0o600` and answers the path, `removeSettingsFile(path: string): Promise<void>`, which unlinks and ignores `ENOENT`, and `sweepSettingsFiles(home: string): Promise<void>` per Global Constraints.
  - In `last-sessions.ts`, `interface LastSessions { get(ref: WorkspaceRef): Promise<string | undefined>; set(ref: WorkspaceRef, sessionId: string): Promise<void>; forget(ref: WorkspaceRef, sessionId: string): Promise<void>; flush(): Promise<void> }` and `createLastSessions(home: string): LastSessions` for `<home>/sessions.json` per State. `set` with the id already recorded writes nothing, and `forget` removes the entry only while it still holds that id.

- [ ] **Step 1: Tests.** Write these and see each fail.
  - `hook-listener.test.ts`, against a real listener, sending with `node:http` `request` so `Host` and `Origin` can be set.
    - `takes an event with the launch's secret and answers with no body`, `204`, empty body, one event.
    - `refuses a request without the secret`, `401`, no event.
    - `refuses another launch's secret and a closed launch`.
    - `refuses a browser`, `OPTIONS` gets `405` with no `access-control-allow-origin`, a `POST` with `Origin: https://example.com` and the right secret gets `403`.
    - `refuses another host`, `Host: localhost:<port>` and `Host: example.com` get `403`.
    - `refuses a path it does not know`, `/hook/<uuid>/PreToolUse` and `/other` get `404`.
    - `refuses a body that is too large or not JSON`, `413` and `400`, no event.
    - `reads the session id and source of a session start`, and `drops a session id that is not a UUID`.
    - `never reads the body of other events`, a 1 MiB `Stop` body still answers `204` with one event.
    - `tells which agent asked and which finished a tool` and `takes a tool event too large to read without knowing its agent`.
    - `refuses a launch that sends too many events at once`, and an `Origin` after 1500 other headers is still refused.
  - `settings-files.test.ts`, in a `mkdtemp` folder.
    - `writes the file only its owner can read`, mode `0o600` checked on macOS and Linux only.
    - `never overwrites a file`.
    - `sweeps only leftover launch files`, it removes `<uuid>.json` files and a `<uuid>.json` link while the link's target outside stays, and keeps `notes.txt`, `<uuid>.txt` and a folder named `<uuid>.json`.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main/sessions`, all pass.
- [ ] **Step 3: Prove it.** `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(sessions): listen for hooks on loopback and keep the last session of each workspace`.

---

### Task 3: Sessions in workspaces, in the background process

`terminal.start` names a workspace, the launch writes its settings file, passes its arguments and environment, the listener feeds statuses to the page, the resume record is kept, and removing a project ends its sessions. The stand-in learns to post hooks. The interface changes only as far as it must to stay working.

**Files:**
- Modify: `src/shared/bridge-contract.ts`, `src/main/terminal/terminal-sessions.ts`, `src/main/terminal/terminal-sessions.test.ts`, `src/main/platform/pty.ts`, `src/main/main.ts`, `src/main/projects/project-list.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/bridge/bridge-client.ts`, `src/renderer/terminal/terminal-view.tsx`, `src/renderer/proving/claude-pane.tsx`, `src/renderer/window/app-window.tsx`, `verify/scenario.ts`, `verify/stand-ins/claude.ts`, `verify/stand-ins/stand-in-log.ts`, `verify/scenarios/flood/scenario.json`, `verify/journeys/quit.ts`, `verify/journeys/boundary.ts`, `verify/cli.ts`
- Create: `src/main/sessions/session-folder.ts`, `verify/scenarios/needs-permission/scenario.json`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2, `ProjectStore` from `src/main/projects/project-list.ts`, `childEnvironment`, `resolveTool`.
- Produces:
  - The contract changes from Global Constraints apart from `links.open`.
  - The CLI step `wait-text=<testid>:<text>`, waiting until that element's inner text holds the text, bounded by the existing wait limit, with an error naming what it last read.
  - `spawnPty(command: ResolvedCommand, args: readonly string[], options)`, spawning `command.file` with `[...command.args, ...args]`, and `PtyProcess.onExit(listener: (exitCode: number, signal: number | undefined) => void)` passing node-pty's signal on, with `0` read as none.
  - In `session-folder.ts`, `sessionFolder(home: string, store: ProjectStore, ref: WorkspaceRef): Promise<string>`. It answers the project's path for `main` and the workspace's recorded path otherwise, and throws `BridgeFailure("not-found", "That workspace is not in Satellite.")` for an unknown workspace, `BridgeFailure("refused", "Satellite is archiving that workspace, so Claude Code can't start there.")` while its id is in `store.busy`, and `BridgeFailure("not-found", "That folder is gone, so Claude Code can't start there.")` when `stat` does not report a directory within 6 seconds or a workspace's folder fails the plain folder rule inside `<home>/worktrees/<project>`. It reads the record again after those checks. An unknown project throws as `store.project` does.
  - `createTerminalSessions({ home, folder, listener, last })` with `folder: (ref: WorkspaceRef) => Promise<string>`, `listener: Promise<HookListener | undefined>` and `last: LastSessions`. It answers `{ handlers, sessionsInside, hookEvent, closeAll }`, where `handlers` also holds `"sessions.resumable"`, `hookEvent(launchId, event)` is what the listener calls, and `closeAll` stops the listener once every `claude` it configured has exited.
  - `createProjects` takes `stopSessions: (folder: string) => Promise<void>`, and `projects.remove` calls it with the project's path and each forgotten workspace's path after the record is forgotten.
  - In `main.ts`, the listener starts before the bridge is registered, a failure logged once with `console.error` and the listener left `undefined`. Terminals are made after projects with `folder: (ref) => sessionFolder(home, projects.store, ref)`, `stopSessions` passes through to `terminals.sessionsInside.stopInside`, and quit flushes `last` after `closeAll` inside the same bound as the terminals.
- **The launch**, in this order, inside `terminal.start` after today's quitting, duplicate and limit checks.
  1. `cwd = await folder(workspace)`.
  2. With `resume`, the recorded id from `last.get(workspace)`, else `BridgeFailure("not-found", "There's no session to resume here. Start a new one.")`, and when a running launch holds that id, `BridgeFailure("refused", "That session is already open in another tab.")`.
  3. `resolveTool("claude")`, missing answered as today.
  4. A launch id. With a listener, `secret = listener.open(launchId)`, the sweep once per run, and `writeSettingsFile(home, launchId, hookSettings("http://127.0.0.1:<port>/hook/<launch id>", secret))`.
  5. `spawnPty(command, claudeArgs(start, file), { cwd, env: claudeEnvironment(await childEnvironment()), cols, rows })`.
  6. On a failure in steps 4 or 5, `listener.close(launchId)` and `removeSettingsFile`, then today's failure.
  7. Each launch remembers its terminal id, owner, workspace, current Claude Code session id, which starts as the id passed to `claude`, status, whether it resumed, whether any hook arrived and whether Satellite ended it. `onEvent` for a launch that is gone does nothing. Otherwise a `SessionStart` with a session id becomes the current id, a `UserPromptSubmit` calls `last.set(workspace, current id)`, and each event goes through `nextState` from `{ status: "idle", askers: [] }`, and when the status or readiness changed `owner.emit("sessions.status", { id, status, ready })`, `ready` turning true at the first accepted hook of the launch.
  8. On exit, the status becomes `stopped` and is emitted, `listener.close(launchId)`, `removeSettingsFile`, and the `ending` from the Contract. For `resume-failed` it calls `last.forget(workspace, id)`. Then `terminal.exit` is emitted with `exitCode` and `ending`. `closeAll` and `stopInside` wait for this cleanup, the file removal included, inside the existing bounds.
  - `"sessions.resumable"` answers false when `folder(workspace)` throws, and otherwise whether a recorded id exists that no running launch holds.
- **Stand-in.**
  - Script steps `{ "hook": <one of hookEvents>, "fields"?: Record<string, string> }` and `{ "await": string }`. `hook` reads the file after `--settings`, takes the event's `url` and `headers`, posts `{ session_id, transcript_path: "", cwd, hook_event_name, ...fields }` with `fetch`, where `session_id` is the value after `--session-id` or `--resume`, and logs `{ type: "hook", event, status }`, status `0` when there is no settings file, no such event or the request failed. `await` waits until the input not yet consumed holds the text, then consumes it up to and including the match, so input that arrives in one chunk still meets each `await` in turn.
  - The input listener is attached before the script plays, so `await` sees it, and it echoes as today.
  - With `--resume <id>` it prints `Resumed session <id>` and CRLF before the script.
- **Scenario `needs-permission`**, the default repo with one more committed file `with space.txt`, the default gh answers, `"workspaces": [{ "name": "alpha", "steps": [] }, { "name": "beta", "steps": [] }]`, and the script `print "Claude Code stand-in\r\n"`, `print "\u001b[?2004h"`, `hook SessionStart { source: startup }`, `print "> "`, `await "\r"`, `hook UserPromptSubmit`, `print "\r\nWorking on it.\r\n"`, `await "\r"`, `hook PermissionRequest { tool_name: Bash }`, `print "Allow Bash to run? Press y to allow.\r\n"`, `await "y"`, `hook PostToolUse { tool_name: Bash }`, `await "\r"`, `hook Stop`, `print "Done.\r\n> "`.
- **Interface, the least that keeps the app working.** `ClaudePane` takes `workspace: WorkspaceRef | null` from `AppWindow`'s selection and is keyed by it. With no selection it shows `<p data-testid="sessions-empty">Pick a workspace to start Claude Code there.</p>`. `TerminalView` sends `workspace` and `resume: false`. Task 4 replaces both.

- [ ] **Step 1: Tests.**
  - `registry.test.ts`, a spy for `sessions.resumable`, and `terminal.start` refusing `program: "bash"`, an extra `args: ["-c", "id"]`, an extra `cwd`, a missing `workspace` and `workspace: { projectId, workspace: "../x" }` with `invalid-request` and no handler run.
  - `terminal-sessions.test.ts`, extended where it already stubs the pseudo terminal, `starts claude in the workspace's folder with Satellite's arguments`, `refuses to resume a session that is open`, `removes the settings file when claude exits`, and `tells its page when a hook changes the status`, through a fake listener. Each seen failing first.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main`, all pass.
- [ ] **Step 3: Journeys stay green.** `flood` gets `"workspaces": []`, and `quit` clicks `workspace-repo-main` before `start-claude`. `boundary` clicks the dropped project's main row before `startClaude`.
- [ ] **Step 4: Prove it.**
  - `npm run --silent verify -- needs-permission click=workspace-repo-alpha click=start-claude wait-text=terminal:stand-in type=one press=Enter press=Enter type=y press=Enter wait-text=terminal:Done. log` shows a `start` event whose args are `--session-id <uuid> --settings <home>/sessions/<uuid>.json`, and `hook` events for `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `PostToolUse` and `Stop`, each with status `204`. Paste the JSON into the report. The stand-in prints `Done.` only after its last hook was answered, so the log is complete when the text shows.
  - `npm run --silent verify -- claude-missing choose-folder=repo click=add-first-project click=start-claude wait-for=terminal-notice text=terminal-notice` reads `Satellite can't find Claude Code. Install it, then start it again.`
  - `npm run --silent journeys`, all `pass`.
  - `./scripts/check` green.
- [ ] **Step 5: Commit.** `feat(sessions): start claude in its workspace with hooks for that process`.

---

### Task 4: Tabs, live sessions and the pixel

The sessions pane, several tabs per workspace, every session kept mounted while another workspace is selected, the pixel in the sidebar and on each tab, the resume offer, and the ended, stopped and missing moments.

**Files:**
- Create: `src/renderer/sessions/use-sessions.ts`, `src/renderer/sessions/sessions-pane.tsx`, `src/renderer/sessions/session-tabs.tsx`
- Modify: `src/renderer/terminal/terminal-view.tsx`, `src/renderer/window/app-window.tsx`, `src/renderer/projects/sidebar.tsx`, `src/renderer/ui/status-pixel.tsx`, `src/renderer/commands/command-registry.ts`, `src/renderer/setup/tool-check.tsx` (export `leads` only), `src/renderer/workspaces/archive-dialog.tsx`, `verify/cli.ts`, `verify/journeys/workspaces.ts` (only if it reads the archive sentence)
- Delete: `src/renderer/proving/claude-pane.tsx`, with `git rm` on that one file

**Interfaces:**
- Consumes: `pixelOf`, `mostUrgent`, `invoke`, `subscribe`, `Dialog`, `Button`, `Icon`, `StatusPixel`, `keyboardPlatform`.
- Produces:
  - `useSessions(notify: Notify): Sessions` in `use-sessions.ts`, with `interface SessionTab { key: string; terminalId: string; number: number; workspace: WorkspaceRef; resume: boolean; status: SessionStatus; ready: boolean }` and `Sessions { tabsOf(ref): SessionTab[]; all: SessionTab[]; activeOf(ref): string | undefined; open(ref, resume: boolean): void; restart(key): void; close(key): void; activate(key): void; forgetWorkspace(ref): void; forgetProject(projectId): void; pixelFor(projectId: string, workspace: WorkspaceKey): PixelState }`. `key` is a UUID that never changes, `terminalId` a fresh UUID per start, `number` counts up per workspace from 1 for the page load and is never reused. `open` makes the new tab active. `close` and the forgets drop tabs, which unmounts their terminals, and the next active tab is the right neighbour, else the left one. It subscribes to `sessions.status` once and updates the tab whose `terminalId` matches.
  - `TerminalView` props become `{ terminalId: string; workspace: WorkspaceRef; resume: boolean; shown: boolean; onRestart(): void }`. The test ids `terminal`, `terminal-notice` and `start-claude` render only while `shown`. While its host has zero width or height it never fits, and when it becomes shown it fits, sends its size and takes focus. Everything else stays as today.
  - `StatusPixel` gains optional `testId` and `label`. With a label it renders `role="img"` and `aria-label`, without one `aria-hidden` as today, and it always sets `data-state`.
  - The CLI step `wait-state=<testid>:<state>`, waiting until that element's `data-state` equals the state, bounded by the existing wait limit, with an error naming the state it last read.
- **Layout.** `AppWindow` renders `<SessionsPane>` inside `column-sessions`, which renders the tab bar for the selected workspace, then every tab's `TerminalView` of every workspace in one stack, each in a wrapper with the `hidden` attribute unless it is the selected workspace's active tab. Switching never unmounts a terminal.
- **Tab bar** (`session-tabs`, `role="tablist"`, `aria-label="Claude Code sessions"`, a 40 pixel bar on `side`). Each tab is a `role="tab"` button `session-tab-<n>` with `aria-selected`, `data-state` and a 6 pixel `StatusPixel`, reading `Session <n>`, with an icon button `close-session-<n>` labelled `Close Session <n>`. Then an icon button `new-session` labelled `New session` with the `plus` icon. Arrow keys move between tabs.
- **Pane states**, all text through `role="status"` where it is a notice.
  - No selection, `sessions-empty` `Pick a workspace to start Claude Code there.`
  - A workspace with no tabs that `sessions.resumable` answers false for, `sessions-empty` `No Claude Code session here yet.` and a primary button `start-claude` `Start Claude Code`. The answer is asked each time such a workspace is shown.
  - The same answered true, `sessions-empty` `Your last session here can pick up where it left off.`, a primary button `resume-session` `Resume session` and a secondary button `start-claude` `Start a new session`.
  - A tab whose process exited with `ending` `ended` reads `Claude Code ended.`, with `unexpected` `Claude Code stopped unexpectedly. The workspace and its changes are safe.`, and with `resume-failed` `Claude Code couldn't resume that session, so Satellite let it go. Start a new one.` Each with `start-claude` `Start Claude Code`, which calls `restart`, focused as today.
  - A 17th tab across the app opens nothing and toasts `Satellite keeps 16 Claude Code sessions open at most. Close one first.`
  - A failed start shows its sentence as today. When its code is `tool-missing` the tab also asks `tools.check` and, when `claude` is `missing`, shows the matching `leads` sentence and its fix text in Geist Mono in `claude-missing-fix`.
- **Sidebar.** Every workspace row's pixel uses `pixelFor`, with `testId` `<row test id>-status` and the label `Working`, `Needs you` or `Done` for those states and none for idle.
- **Commands.** `session.new` and `session.close` per Global Constraints, through `guarded()`. Archiving a workspace calls `forgetWorkspace` after it succeeds, and removing a project calls `forgetProject`.
- **Archive copy.** `1 Claude Code session running here stops first.` and `<n> Claude Code sessions running here stop first.`

- [ ] **Step 1: Implement** per the interfaces. No new unit test, the pure parts are pinned in Task 1.
- [ ] **Step 2: Prove it.**
  - `npm run --silent verify -- needs-permission click=workspace-repo-alpha click=start-claude wait-text=terminal:stand-in type=one press=Enter wait-state=workspace-repo-alpha-status:working press=Enter wait-state=workspace-repo-alpha-status:needs-you shot=alpha-needs-you type=y wait-state=workspace-repo-alpha-status:working press=Enter wait-state=workspace-repo-alpha-status:done click=workspace-repo-beta click=start-claude wait-text=terminal:stand-in click=workspace-repo-alpha text=terminal tree shot=alpha-again` answers with alpha's terminal text holding `Done.`, the tree holding `session-tab-1` and alpha's pixel labelled `Done`. Look at both screenshots, at a narrow window too with `resize=900x700`, in light and dark.
  - `npm run --silent verify -- needs-permission click=workspace-repo-alpha click=start-claude wait-text=terminal:stand-in type=one press=Enter wait-text=terminal:Working restart click=workspace-repo-alpha wait-for=resume-session click=resume-session wait-text=terminal:Resumed log` shows a second `start` whose args are `--resume <the first --session-id> --settings ...`.
  - `npm run --silent verify -- claude-missing choose-folder=repo click=add-first-project click=start-claude wait-for=claude-missing-fix text=column-sessions` reads the missing sentence and the platform's fix.
  - `npm run --silent journeys` and `./scripts/check` green.
- [ ] **Step 3: Commit.** `feat(sessions): keep several claude sessions per workspace alive with their status`.

---

### Task 5: Links, image paste, dropped files and the theme

**Files:**
- Create: `src/main/terminal/link-check.ts`, `src/main/terminal/link-check.test.ts`, `src/main/terminal/link-handlers.ts`, `src/main/platform/browser.ts`, `src/renderer/terminal/terminal-keys.ts`, `src/renderer/terminal/dropped-paths.ts`, `src/renderer/terminal/dropped-paths.test.ts`, `src/renderer/sessions/link-dialog.tsx`
- Modify: `package.json`, `package-lock.json` (through `npm install --save-dev --save-exact @xterm/addon-web-links@0.12.0`), `src/main/main.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/terminal/terminal-view.tsx`, `src/renderer/sessions/sessions-pane.tsx`, `verify/driver.ts`
- Licence notices regenerate through the existing step if `./scripts/check` asks for it.

**Interfaces:**
- Produces:
  - `checkedLink(raw: string): URL | null` in `link-check.ts`. It answers null when the text holds any `\p{Cc}` or whitespace, does not parse with `URL.parse`, has a protocol other than `http:` or `https:`, an empty hostname, or a non-empty username or password, and the parsed `URL` otherwise.
  - `linkHandlers(): Pick<BridgeHandlers, "links.open">`. A refused address throws `BridgeFailure("refused", "Satellite opens only web addresses that start with http or https.")`, a second open within 1000 milliseconds `BridgeFailure("limit", "Satellite opens one link at a time. Try again in a moment.")`, and a failed open `BridgeFailure("failed", "Satellite couldn't open that link in your browser.")`. It opens `url.href` through `openInBrowser`.
  - `openInBrowser(href: string): Promise<void>` in `browser.ts`. When `SATELLITE_VERIFY_LINKS` is an absolute path it appends `href` and a newline to that file instead, otherwise `shell.openExternal(href)`.
  - In `terminal-keys.ts`, `newlineSequence` and `isShiftEnter` moved from `terminal-view.tsx`, `opensLink(event: MouseEvent): boolean` (`metaKey` on macOS, `ctrlKey` elsewhere, from `keyboardPlatform()`), and `imagePasteSequence(): string`, `"\u001bv"` when `navigator.userAgent` holds `Windows` and `"\u0016"` otherwise.
  - `droppedPaths(paths: readonly string[]): string | null` in `dropped-paths.ts`. It answers null when any path is empty or holds a character `promptText` removes, which `holdsHiddenText` in `src/shared/prompt-text.ts` finds. A path made only of `[A-Za-z0-9._/:@%+=,~-]` stays as it is, any other is wrapped in double quotes with `"` written `\"`. The paths are joined by single spaces and end with one space.
  - `AppSession.dropFiles(testId: string, paths: string[])`, the existing CDP drop aimed at the centre of that test id, and `AppSession.openedLinks(): Promise<string[]>`, the lines of `<temp>/links.txt`, which the driver names in `SATELLITE_VERIFY_LINKS`.
- **Terminal behaviour** in `TerminalView`.
  - Links. `WebLinksAddon` and `linkHandler.activate` both do nothing unless `opensLink(event)`, and otherwise open `LinkDialog` with the parsed address, never `links.open` directly. Text that does not parse is refused in the page with `links.open`'s own sentence and never sent. `allowNonHttpProtocols` stays false.
  - `LinkDialog`, the kit's dialog, `link-dialog`, title `Open this link`, description `The text Claude Code showed points to this address. Check it before you open it.`, the address in Geist Mono in `link-address` with `break-all`, footer `link-cancel` `Cancel` on the left, where focus starts, and primary `link-open` `Open in browser`, which invokes `links.open`.
  - Image paste. A `paste` listener in the capture phase on the terminal host. When `clipboardData` has no `text/plain` and has an item of kind `file`, it prevents the default, stops propagation and sends `imagePasteSequence()` through the terminal's write queue.
  - Drops. `dragover` on the host, when the types hold `Files`, prevents the default and sets `dropEffect` to `copy`, after the window's folder drop handler, so the sessions column takes files. `drop` takes at most 20 files, else toasts `Drop up to 20 files at a time.`, maps each through `window.satellite.pathForFile`, and toasts `Satellite couldn't read where that file came from.` for an empty one and `Satellite can't type a path that holds a line break or another control character.` when `droppedPaths` answers null. Otherwise it calls `terminal.paste` with the result and focuses the terminal.
  - Theme. Every mounted terminal, hidden or shown, follows the theme change as one does today. Scrollback stays 5000.

- [ ] **Step 1: Tests.** See each fail first.
  - `link-check.test.ts`, `opens only web addresses`, accepting `https://example.com/a?b#c` and `http://127.0.0.1:3000/`, refusing `file:///etc/passwd`, `javascript:alert(1)`, `data:text/html,x`, `ssh://example.com`, `https://user:pass@example.com`, `https://`, `https://exa mple.com`, `https://example.com/\nx` and `mailto:a@example.com`.
  - `dropped-paths.test.ts`, `types dropped paths the way Claude Code reads them`, with a plain path, a path with spaces, one with a double quote, a Windows path `C:\Users\<name>\shot one.png`, unicode, and a newline or ESC in a name answering null.
  - `registry.test.ts`, `links.open` refusing a 2049 character address and an extra field.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main/terminal src/renderer/terminal`, all pass.
- [ ] **Step 3: Prove it.** Add to the `needs-permission` scenario's script, right after the banner, a `print` of `See https://example.com/docs and \u001b]8;;https://example.com/real\u001b\\the docs\u001b]8;;\u001b\\\r\n`. Then `npm run --silent verify -- needs-permission click=workspace-repo-alpha click=start-claude wait-text=terminal:docs shot=links` and look at the underline on hover in the screenshot. The clicks themselves are proven in Task 7's journey, which knows the cell positions.
- [ ] **Step 4: Check.** `./scripts/check` and `npm run --silent journeys` green.
- [ ] **Step 5: Commit.** `feat(terminal): open checked links, paste images and type dropped paths`.

---

### Task 6: Send to Claude Code

**Files:**
- Create: `src/shared/prompt-text.ts`, `src/shared/prompt-text.test.ts`, `src/renderer/sessions/send-to-claude-code.ts`
- Modify: `src/renderer/sessions/sessions-pane.tsx`, `src/renderer/terminal/terminal-view.tsx`, `verify/cli.ts`

**Interfaces:**
- Produces:
  - `promptTextLimit = 800` and `promptText(raw: string): string` in `prompt-text.ts`. `\r\n`, `\r`, `\n`, `\t`, U+2028 and U+2029 each become one space. Every other `\p{Cc}` character, which covers C0, DEL and C1, is removed, and so are U+061C, U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069. The result is cut to 800 characters without splitting a surrogate pair.
  - `sendToClaudeCodeEvent = "satellite:send-to-claude-code"` and `sendToClaudeCode(text: string): void` in `send-to-claude-code.ts`, which dispatches `new CustomEvent(sendToClaudeCodeEvent, { detail: { text } })` on `window`.
  - `TerminalView` registers `{ paste(text: string): void; focus(): void }` for its terminal id with the pane while mounted.
  - The pane listens once. It reads `detail.text` only when it is a string, cleans it with `promptText`, does nothing for an empty result, toasts `Start a Claude Code session in this workspace first.` when the selected workspace has no active tab or its process has exited, toasts `Satellite sends here only after Claude Code reports your first request. Type this one yourself.` while that tab's `ready` is false, toasts `Answer Claude Code first, then send this again.` while that tab needs you, and otherwise calls that tab's `paste` with the clean text and focuses it after the current event unless a text field, dialog or the command menu outside the pane holds focus then. `paste` is xterm.js's own `terminal.paste`, so the text is bracketed when Claude Code turned bracketed paste on, and with no CR, LF or ESC left it can neither end the bracket nor submit.
  - The CLI step `send=<text>`, which dispatches the event with the text in the page.
- [ ] **Step 1: Tests.** `prompt-text.test.ts`, see each fail first.
  - `never leaves a way to submit`, `"fix it\r\nnow\rthen\nend"` gives `"fix it now then end"`.
  - `removes escapes so a paste cannot end early`, `"a\u001b[201~\rb"` gives `"a[201~ b"`.
  - `removes bell, delete, C1 and direction marks`, `"\u0007x\u007f\u0085\u202ey\u2066"` gives `"xy"`.
  - `keeps unicode text whole`, `"résumé 日本 👩‍💻"` unchanged.
  - `cuts long text on a whole character`, 3999 `a` and an emoji give 3999 `a`.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/shared/prompt-text.test.ts`, all pass.
- [ ] **Step 3: Prove it.** `npm run --silent verify -- needs-permission click=workspace-repo-alpha click=start-claude wait-text=terminal:stand-in send=look-at-this wait-text=terminal:look-at-this log` shows one `input` event equal to `\u001b[200~look-at-this\u001b[201~` and no `UserPromptSubmit` hook. `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(sessions): send a cleaned request to the prompt without submitting it`.

---

### Task 7: Journeys, the settings files and the real Claude Code

**Files:**
- Create: `verify/journeys/sessions.ts`, `verify/journeys/settings.ts`, `verify/scenarios/settings-files/scenario.json`
- Modify: `verify/journeys.ts`, `verify/journeys/boundary.ts`, `verify/journeys/launch.ts` (only if a test id moved), `verify/journeys/conditions.ts`, `verify/driver.ts`, `verify/scenario.ts`

**Interfaces:**
- Produces:
  - Scenario field `claudeConfig: [{ path, content }]`, optional, each path kept inside the folder with `resolveInside`.
  - The driver makes `<temp>/claude-config`, seeds `claudeConfig` there and sets `CLAUDE_CONFIG_DIR` to it for every run except `--real-claude`, which keeps the user's own. `AppSession.claudeConfig` is its path.
  - Scenario `settings-files`, the default repo with `.claude/settings.json` `{"permissions":{"allow":["Bash(npm test)"]}}` and `.claude/settings.local.json` `{"permissions":{"allow":["Bash(ls)"]}}` written and committed, `"workspaces": [{ "name": "alpha", "steps": [] }]`, `claudeConfig` `settings.json` `{"theme":"dark","hooks":{"Stop":[{"hooks":[{"type":"command","command":"exit 0"}]}]}}` and `.claude.json` `{"projects":{}}`, and the script banner, `\u001b[?2004h`, `hook SessionStart { source: startup }`, `print "> "`, `await "\r"`, `hook UserPromptSubmit`, `hook Stop`, `print "Done.\r\n> "`.
- **Journey `sessions`, scenario `needs-permission`.** Every wait through `waitUntil`, `wait-state` style polling or Playwright's own waiting, never a fixed delay, and the window keeps the size the driver opens, with one pass at 900 by 700.
  1. Alpha. Start, set a `data-mark` attribute on the `terminal` element, type `one` and Enter, alpha's pixel is `working`. Enter, `needs-you`, and `session-tab-1`'s `data-state` is `needs-you`. `y`, `working`. Enter, `done`.
  2. Beta. Start, type `two` and Enter, beta is `working` while alpha stays `done`, and both stand-in pids are alive.
  3. Back and forth. Alpha's terminal text holds `one` and `Done.` and not `two`, beta's holds `two` and not `one`, and the alpha terminal is the same element as before the switch, checked through the `data-mark` from step 1.
  4. Tabs. `new-session` in beta makes `session-tab-2` with a third pid, `close-session-2` ends that pid within `goneTimeoutMs` and its settings file is gone, and `session-tab-1` stays.
  5. Send. In alpha, dispatch the event with `"fix it\r\nnow\u001b[201~\u0007 \u202e"`. The input the stand-in logs after the dispatch, joined, is exactly `\u001b[200~fix it now[201~ \u001b[201~`, no input before step 9 holds `\r`, and no `UserPromptSubmit` hook follows.
  6. Image and drop. A `paste` event whose `DataTransfer` holds only a PNG file sends `\u0016`, or `\u001bv` on Windows. `dropFiles("terminal", [<repo>/README.md, <repo>/with space.txt])`, with the repo's real path, types `<repo>/README.md "<repo>/with space.txt" ` into the stand-in's input.
  7. Links. The journey finds each link's cell from the rendered rows' text and the character measure, as `launch` measures cells, and holds Meta on macOS or Control elsewhere with `keyboard.down` around the click. A modifier click on the plain address shows `link-dialog` reading `https://example.com/docs`, and a modifier click on the visible part of the `Hidden` line reads `https://example.com.evil.example/login`. A plain click records nothing. A modifier click on the OSC 8 text shows `link-dialog` with `link-address` reading `https://example.com/real`, `link-cancel` records nothing and `link-open` records it. A `links.open` of `file:///etc/passwd` through `invoke` answers `refused`.
  8. Restart. `relaunch`, and while closed `<home>/sessions` holds no `.json` file. Alpha shows `resume-session`, a click starts a stand-in whose args hold `--resume` with alpha's first `--session-id`, and its terminal reads `Resumed session`.
  9. Endings. Start beta again, Ctrl+D in its tab shows `Claude Code ended.`, killing alpha's stand-in pid with `SIGKILL` from the journey shows `Claude Code stopped unexpectedly. The workspace and its changes are safe.`, and both tabs' `data-state` read `stopped`.
  10. Closing. `session.close()` reports no leftover, and every stand-in pid is gone.
- **Journey `settings`, scenario `settings-files`.** Hash with SHA-256 every file under `claudeConfig`, the repo's `.claude/` and alpha's `.claude/`, and list `git status --porcelain=v1 -z --untracked-files=all` in both. Run a session in main and one in alpha, each through a prompt to `done`. While they run, the settings file named after `--settings` sits inside `<home>/sessions`, with mode `0o600` on macOS and Linux, and holds only the key `hooks`. Close both tabs, quit, and compare. Every hash and the file lists are equal, the status lists are equal, and `<home>/sessions` holds no `.json` file.
- **Journey `boundary`**, added cases. `terminal.start` with `program: "sh"`, with an extra `args` and with an extra `cwd` answer `invalid-request`, with a made-up project UUID `not-found`, and none logs a `start`. `terminal.start` with `resume: true` where nothing is recorded answers `not-found`. Read the hook URL from the running session's settings file and post to it from the journey with no `Authorization`, with a wrong secret and with an `Origin`, getting `401`, `401` and `403`, and the pixel stays as it was. `links.open` with `javascript:alert(1)` answers `refused`.
- `journeys.ts` lists `launch`, `boundary`, `projects`, `workspaces`, `sessions`, `settings`, `quit`.

- [ ] **Step 1: Write the journeys.** Before trusting each, break one rule at a time for one run and see the journey fail with a legible reason, then restore. Answer `PermissionRequest` with JSON instead of `204`, skip the settings file removal, leave CR in `promptText`, and mount only the selected workspace's terminals.
- [ ] **Step 2: Prove it.** `npm run --silent journeys` prints `pass` for all seven. `./scripts/check` green.
- [ ] **Step 3: The real Claude Code on macOS.** Ask the user before each run, as the verify skill says, because it uses their own Claude Code and its sign-in, writes the throwaway repo's trust answer and transcript into their Claude Code home, and spends a little of their usage. Run in `default`, whose repo is a throwaway temp folder, with a temporary Satellite home.
  - Working then done. `npm run --silent verify -- default --real-claude choose-folder=repo click=add-first-project click=start-claude "wait-text=terminal:Yes, I trust this folder" press=ArrowDown press=Enter "type=Reply with the single word ready" press=Enter wait-state=workspace-repo-main-status:working wait-state=workspace-repo-main-status:done shot=real-done`. If the trust dialog's wording differs, read it with `text=terminal` and wait on what it says.
  - Resume with history. The same run continued with `restart click=workspace-repo-main wait-for=resume-session click=resume-session "wait-text=terminal:Reply with the single word ready" shot=real-resumed`.
  - If the status never leaves idle, the hooks were refused or blocked. Report it with the `Origin` question first, and change the listener only on evidence.
  - Without the user's yes, report these two acceptance items as unproven and stop there.
- [ ] **Step 4: Commit.** `test(verify): prove live sessions, their status, send, links and untouched settings`.

---

### Task 8: Docs, skills and status Done

**Files:**
- Modify: `ARCHITECTURE.md`, `SATELLITE.md` (only if something is now true and missing), `DESIGN.md` (only the session tabs and the link dialog, if absent), `.claude/skills/satellite-stack/SKILL.md`, `.claude/skills/satellite-verify/SKILL.md`, `.claude/skills/satellite-conventions/SKILL.md` (only if a rule changed), `specs/004-claude-code-sessions/spec.md`, `specs/README.md`

- [ ] **Step 1: ARCHITECTURE.md.**
  - Parts and Folder layout. `src/main/sessions/` (arguments, hook settings, status, listener, settings files, last sessions, folder lookup), `src/main/terminal/link-check.ts` and `link-handlers.ts`, `src/main/platform/browser.ts`, `src/renderer/sessions/`, `src/renderer/terminal/terminal-keys.ts` and `dropped-paths.ts`, `src/shared/prompt-text.ts`, and `src/renderer/proving/claude-pane.tsx` gone.
  - Security boundary. The listener paragraph, the settings file in the home, and that nothing is written into Claude Code's settings or the repository.
  - Bridge. The changed `terminal.start` and `terminal.exit` rows and new rows for `sessions.resumable`, `links.open` and `sessions.status`, each with the reasoning from Global Constraints, the three questions answered in the `terminal.start` row.
  - State. `sessions.json` version 1 and `<home>/sessions/`.
  - Terminal. Sessions in workspaces, tabs and live hidden terminals, the launch order, the status machine's table, the environment's deny list and proxy rule, links, image paste, drops, Send, and the limits. The Links bullet and the Environment bullet rewritten.
  - Decisions. Rewrite the links row to the check and the dialog, and add rows for the settings file over inline JSON, the per-launch secret, `204` with no body, the hooks chosen, the deny list environment and keeping `.cmd` refused.
- [ ] **Step 2: Skills.** `satellite-stack`, that `src/main/sessions/` owns launching `claude` and nothing else builds its arguments. `satellite-verify`, the `hook` and `await` steps, `--resume` output and the `hook` log event, `claudeConfig` and the temporary `CLAUDE_CONFIG_DIR`, `SATELLITE_VERIFY_LINKS`, the `wait-state`, `wait-text` and `send` steps, `dropFiles` and `openedLinks`, the two scenarios, the `sessions` and `settings` journey rows, the `boundary` changes, and feature map rows for 004. `satellite-conventions` changes only if a rule did.
- [ ] **Step 3: SATELLITE.md.** Add only what is now true and missing, if anything. Its decision row says the launch flag writes nothing, which still holds for the user's settings and repository. Do not restate the spec.
- [ ] **Step 4: Status.** Spec and index to **Done**. Leave `plan.md` to the controller.
- [ ] **Step 5: Check.** `./scripts/check` and `npm run --silent journeys` green, last lines in the report. Commit `docs: describe claude code sessions and mark spec 004 done`.

---

## Acceptance map

| Acceptance item or scope bullet | Task | Proof |
| --- | --- | --- |
| The real `claude` answers a prompt and shows working then done in the sidebar | 3, 4, 7 | the real `claude` run on macOS in Task 7 Step 3, with the user's yes |
| A permission request turns the pixel to needs you and approving it turns it back | 1, 3, 4, 7 | scenario `needs-permission` in Task 4 Step 2 and `sessions` journey step 1 |
| Hook events map to the right status in every order they can arrive | 1 | `session-status.test.ts` |
| A hook request without the secret is refused | 2, 7 | `hook-listener.test.ts`, the `boundary` journey |
| Two sessions in two workspaces run at once and each keeps its own screen | 4, 7 | `sessions` journey steps 2 and 3 |
| After a restart the workspace offers to resume and the resumed session shows its history | 2, 3, 4, 7 | the real `claude` resume run in Task 7 Step 3, and with the stand-in `sessions` journey step 8 |
| Send to Claude Code places the text in the prompt and does not submit it | 6, 7 | the `send` run in Task 6 Step 3, `prompt-text.test.ts`, `sessions` journey step 5 |
| With `claude` missing the pane says so and names the fix | 4 | the `claude-missing` run in Task 4 Step 2 |
| The user's Claude Code settings files are byte for byte unchanged after a session | 7 | `settings` journey |
| Scope, runs the user's `claude` in the selected workspace's folder | 3 | `terminal-sessions.test.ts`, the stand-in's `cwd` in the `sessions` journey |
| Scope, several sessions per workspace as tabs, with a button and a command to start and close one | 4, 7 | `sessions` journey step 4, the `session.new` and `session.close` commands |
| Scope, a session id Satellite chooses and hooks for that process only, posting to a loopback listener with a secret | 1, 2, 3 | `claude-launch.test.ts`, `hook-listener.test.ts`, the `log` run in Task 3 Step 4 |
| Scope, nothing written to the user's settings or the repo | 3, 7 | `settings` journey |
| Scope, the workspace pixel shows the most urgent status | 1, 4 | `session-pixel.test.ts`, `sessions` journey step 2 |
| Scope, Shift+Enter, image paste, dropped files, links after a check, theme colours, bounded scrollback | 5, 7 | `link-check.test.ts`, `dropped-paths.test.ts`, `sessions` journey steps 6 and 7, the `launch` journey's Shift+Enter, the Task 4 screenshots in both themes |
| Scope, not installed, session ended, stopped unexpectedly drawn by Satellite | 4 | the `claude-missing` run, the ended and stopped notices in `sessions` journey step 9 |
| Carry-over, links in terminal output | 5 | `link-check.test.ts`, `sessions` journey step 7 |
| Carry-over, Claude Code no longer starts in the app's folder | 3 | `terminal-sessions.test.ts` |
