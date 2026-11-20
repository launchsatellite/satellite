# Inbox and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The top of the sidebar holds the inbox, every workspace with a Claude Code session that needs the user, across all projects, newest first, each row with one sentence saying why and a count above them. Selecting a row selects that workspace, shows the session tab that asks and puts focus in its terminal, without typing anything. A row leaves by itself once no session there needs the user. When a workspace starts needing the user while the window is not in front, the background process raises one system notification built only from Satellite's own words and the workspace and project names, and a click brings the window forward on that workspace. The app icon carries the inbox count on macOS and on Linux launchers that support it. One switch in the command menu turns notifications off, and the inbox and the count keep working.

**Architecture:** Nothing new is stored but one boolean. The inbox is derived state on both sides of the bridge, from the session statuses that already exist. The interface derives its rows from the tabs `useSessions` keeps, which already carry each session's status through `sessions.status`, so no new request channel exists. The background process derives the set of workspaces that need the user from its own session states in `terminal-sessions.ts` and hands every change to a small controller, `createNotices`, which sets the badge when the count changes and decides when to notify, with what words, rate-bounded and coalesced. The platform module owns the system calls, `Notification`, `app.setBadgeCount` and the Windows app identity, plus a recorder that replaces all three under the live driver check, so no verification ever raises a real notification. A notification click reaches the page through one new event, `notices.open`, sent by the background process only. The setting is a new `notifications` field in `interface.json`, which becomes version 2, and the user flips it with one of two commands.

**Tech Stack:** As in spec 004. Electron 45 (45.3.4 in `package.json`), React 19, TypeScript 6, zod 4, Tailwind 4, Vitest 5, playwright-core 1.65, Node 24. No new dependency of any kind.

**Spec:** `specs/005-inbox-and-notifications/spec.md`

## What this writes and where

- `<home>/interface.json` gains the field `"notifications": true | false` and is written as version 2. A version 1 file reads as version 2 with notifications on.
- The system keeps what Satellite shows in its own notification history, the title and the body only, which hold Satellite's fixed words, a workspace name and a project folder name, cleaned and bounded. Nothing a session said, no tool name and no tool argument ever reaches them.
- Under verification only, `<temp>/notices.jsonl` in the run's temp folder, one JSON line per notification, closed notification and badge change.

Nothing goes into a repository or into Claude Code's settings.

## Rulings checked

Each was checked against current official documentation while planning. The docs at electronjs.org/docs/latest describe Electron 45.4.1, the current stable, and every API this plan uses existed well before 45.3.4.

- **`Notification` in the main process (electronjs.org/docs/latest/api/notification).** It is a main process EventEmitter. `Notification.isSupported()` answers whether desktop notifications work on this system. `new Notification({ title, body })` builds one and only `show()` shows it, `close()` dismisses it and on Windows also removes it from Action Center. Events `click`, `close`, `show` and `failed`, the last on macOS and Windows with an error string. `close` is not guaranteed to fire. Only notifications from `getHistory()` are documented to keep working after their object is collected, so Satellite holds a reference to the notification it showed until it closes it or shows the next. `id`, `groupId`, actions, replies and `toastXml` are not used, so no reply text, button or markup from anywhere reaches a notification.
- **What each system needs (electronjs.org/docs/latest/tutorial/notifications).** macOS uses the UserNotifications framework and the app must be code-signed, and an unsigned binary gets a `failed` event. Satellite's release is ad-hoc signed, so whether a release build shows notifications on macOS is not confirmed, and `failed` is logged once per run and changes nothing else. A notification is limited to 256 bytes on macOS and truncated beyond. Windows needs a Start Menu shortcut carrying the app's AppUserModelID, and outside Squirrel the app calls `app.setAppUserModelId` itself. Linux sends through libnotify to a server that follows the Desktop Notifications Specification, and with no server nothing shows and nothing fails visibly.
- **Windows app identity (electron.build configuration, Microsoft "How to enable desktop toast notifications through an AppUserModelID").** electron-builder uses `appId` as the AppUserModelID of the NSIS install's shortcut, and its docs ask the app to call `app.setAppUserModelId(appId)` before any window opens. `electron-builder.yml` has `appId: app.satellite.desktop`, so Satellite sets exactly that on Windows. Without an installed shortcut carrying it, as in a development run, Windows raises no toast. A click on a toast that already moved into Action Center needs a toast activator, which Electron registers only for Squirrel, so such a click may do nothing. Both are accepted, and a second launch from any click still only focuses the first window, since `second-instance` ignores its arguments.
- **Denied permission.** The docs say nothing about a user who turned notifications off for the app. On macOS the system then drops the notification, possibly with `failed`, and on Windows and Linux it is silently discarded. Satellite never asks, never retries and never tells the user, because the system's own setting is the user's answer. The inbox and the count are unaffected.
- **The app icon count (electronjs.org/docs/latest/api/app).** `app.setBadgeCount(count)` is documented for macOS, on the Dock icon, and Linux, on docks and taskbars that implement the LauncherEntry D-Bus API, where the badge belongs to the app's `.desktop` file and its name must match. `0` hides it. On macOS it needs permission to show notifications. Windows has no count. `win.setOverlayIcon(image, description)` only lays a fixed 16 by 16 image over the taskbar icon, so a count there would mean drawing digits into images, which this plan does not do. Whether the deb's desktop file name matches is not confirmed, and the AppImage installs no desktop file, so it has no badge.
- **Focus (electronjs.org/docs/latest/api/browser-window).** `isFocused()` answers whether the window has focus, `isVisible()` whether it is shown, `isMinimized()` whether it is minimised. Hidden with Cmd+H on macOS is not visible, minimised is minimised, another app or another desktop in front leaves it unfocused. So the window is in front exactly when it is visible, not minimised and focused, and in every other case a need notifies. `show()` shows and focuses, `restore()` brings it back from minimised, `focus()` focuses. The same three calls already serve `second-instance`. Windows may refuse to bring a window forward and flash the taskbar instead, which is the system's rule and accepted.
- **Quiet verification.** The window is never shown and the driver emulates focus only inside the page, so `isFocused()` in the background process is always false there, while on Windows and Linux runners the window is shown and its focus depends on the machine. Under the recorder the window therefore always counts as not in front, so every run gets the same answer on every system and nobody's real focus is touched. The in-front rule itself is three calls, pinned by the controller's unit tests through its `inFront` option.
- **Text a notification may carry.** Notifications show on lock screens and stay in the system's history, and a Linux server that advertises `body-markup` interprets a subset of HTML in the body (Desktop Notifications Specification, markup section, and the libnotify reports of bodies cut at `<`). It is not documented whether Electron escapes the body on Linux. So the sentences are fixed by Satellite, and the only outside text is a workspace name, which already passes the name rule, and a project folder name, reduced to letters, marks, digits, spaces and `._+()-`, which leaves no markup character, no control, no direction mark and no line break, and cut to 32 characters. The worst title and body stay far under 256 bytes. Session text, tool names and tool arguments never reach the background process's notices at all, because the listener keeps none of them.

## Decisions the plan made

| Decision | Why | Cost if wrong |
| --- | --- | --- |
| The inbox is derived state on both sides, never stored. The interface derives rows from its tabs, the background process derives the needing set from its sessions | Reasons end with their sessions, which end with the page load, so nothing is worth keeping, and the statuses already reach both sides | A burst of hooks inside the 100 millisecond status gap shows in the page up to 100 milliseconds after the badge |
| A reason is one session that needs you, `{ kind: "session", workspace, session, since }`, and a row groups the reasons of one workspace | Spec 008 adds a second `kind` to the same union without changing rows, order or count | None now, `kind` has one value |
| "Most recent first" orders rows by when the workspace entered the inbox, the smallest `since` of its reasons, newest first. `since` is a page-load counter that rises each time a tab starts needing you, never a clock and never persisted | Nothing shows a time, and a counter has no ties and no clock drift | A second session asking in a workspace already listed does not move that row up |
| One notification when a workspace enters the needing set, none while it stays there, whatever more sessions or agents ask inside it, and a new one after it left and enters again | The spec's "one notification, not a second for the same reason", and a need answered and asked again is a new need | A user who answers one session while another in the same workspace keeps asking gets no new notification for the second, since the workspace never left |
| At most one notification every 5 seconds. Workspaces entering during the gap wait and come as one notification when it ends, naming the workspace for one and the count for several, and a workspace answered while it waits drops out | A burst of many workspaces must not flood the system, and a need inside the gap is still announced | A need may be announced up to 5 seconds late |
| Showing a notification closes the one shown before, and a shown notification closes once every workspace it named has left the needing set | The system's list keeps only needs that are still open | On systems where `close()` cannot reach a delivered notification it stays, and its click still only opens the workspace |
| A click brings the window forward and sends `notices.open` with the workspace to the page that owns the asking session. The page selects that workspace only while it is listed and no dialog is open, shows its tab that has asked longest, and focuses that terminal | The click is outside input, and only a page-owned list decides what can be selected. Focus moves only through the system's own click | A click after a reload only brings the window forward |
| The setting is `notifications` in `interface.json`, default on, read as on from a version 1 file, flipped by `notifications.off` "Turn notifications off" or `notifications.on` "Turn notifications on" in the command menu, only one available at a time | Satellite has no settings pages, the theme is set the same way, and the one file the user's choices live in already exists | A user who never opens the command menu does not find the switch |
| Notifications off stops notifications only. The inbox and the badge keep working | The spec says the inbox still fills, and the badge is the inbox's count | A user who wants a silent Dock icon turns notifications off for Satellite in the system settings |
| No sound of Satellite's own, no `silent`, no urgency, no actions or replies | The system's default and the user's per-app settings decide sound, which is free | None |
| Windows shows no count | Windows has no count API for desktop apps, and drawn digits are more than the spec asks | Windows users see notifications but no number on the taskbar |
| The inbox sits in the sidebar right under Commands and Go to a workspace, above Projects | "At the top of the sidebar", and the two command rows are the sidebar's search, as in the kit's sidebar | None |
| One more command, `inbox.newest` "Go to the newest workspace that needs you", available while the inbox has a row | Every action is one command, and this is the row click from the keyboard | None |
| The recorder writes to the file `SATELLITE_VERIFY_NOTICES` names, only while the live driver check passes, and the window then always counts as not in front | Verification never raises a real notification or badge, and runs give the same answer on every system | The in-front rule is proven by unit tests, not in the app |
| The click's last hop is proven by the controller's unit test and the page's handler shares the row's `openFromInbox`, which the journey proves | The driver cannot click a recorded notification, and no verification may raise a real one | A broken event subscription would show only in a manual check |

## Global Constraints

Every task is bound by `.superpowers/sdd/global-constraints.md`, `AGENTS.md`, `.claude/skills/satellite-conventions/SKILL.md`, `.claude/skills/satellite-stack/SKILL.md` and `.claude/skills/satellite-verify/SKILL.md`. No comments, no casts, no `any`, kebab-case files, named exports, tests only where listed and each seen failing once, no home-folder paths in any file, never push. Never read or write the real `~/.satellite`, `~/.claude` or `~/.claude.json`. Never raise a real system notification or badge on this machine, so never run `npm run dev` and never launch the app outside the verify driver, and never call the real `Notification` or `app.setBadgeCount` from a test. Before the final report, list processes whose command is this repo's `node_modules/electron` binary and confirm none is left.

### Names and limits

- `noticeGapMs = 5000`, exported from `src/main/inbox/notices.ts`.
- `noticeNameLimit = 32` code points.
- A name in a notification keeps only characters matching `/[\p{L}\p{M}\p{N} ._+()-]/u`. Every other character becomes a space, runs of spaces become one, the result is trimmed, cut to 32 code points and trimmed again. An empty result becomes the fallback, `a project` for a project and `a workspace` for a workspace.
- The workspace key of a reason or a needing entry is `${projectId}/${workspace}`, the same place key `use-sessions.ts` uses.
- `appUserModelId = "app.satellite.desktop"`, equal to `appId` in `electron-builder.yml`.
- The needing set holds at most one entry per workspace and is bounded by the 16 terminals, so the badge is at most 16 and a notification names at most 16 workspaces.

### State

- **`interface.json` version 2.** `{ "version": 2, "selected", "columns": { "left", "right" }, "theme", "notifications" }`, `notifications` a boolean. The file schema is a union of version 1, the current strict shape with `version: z.literal(1)` and no `notifications`, transformed to version 2 with `notifications: true`, and version 2, strict with `version: z.literal(2)`, as `projects-file.ts` does for its versions. Every write is version 2. Any other version, an unknown key or a non-boolean `notifications` sets the file aside as today.
- `defaultInterfaceState` gains `notifications: true`.
- No other file changes.

### Contract

In `src/shared/bridge-contract.ts`.

- `interfaceState` gains `notifications: z.boolean()`, so `interface.load` answers it and `interface.save` requires it. Nothing else in either channel changes.
- New event `"notices.open": z.strictObject({ workspace: workspaceRef })`, sent only by the background process, only after a click on a notification it showed, only to the page that owns the session that made that workspace need you.
- No new request channel. `window.satellite` keeps its three functions.
- The event gets a listeners `Set` in `src/renderer/bridge/bridge-client.ts` and a row in the Bridge table of `ARCHITECTURE.md` (Task 6). The `interface.load` and `interface.save` rows gain the field (Task 6).

### What a page running hostile script could do

Recorded in `ARCHITECTURE.md` in Task 6, decided here.

- **Raise a notification with text it chose.** No. There is no channel that shows one. The background process decides from its own session states, with its fixed sentences, the workspace record's name and the project folder's cleaned name.
- **Raise notifications without bound.** No. The worst it can do is drive a session through `terminal.write` into asking for permission again and again, which it can already do, and the controller shows at most one notification every 5 seconds whatever the number of workspaces.
- **Set an arbitrary badge.** No. The badge is the size of the needing set, at most 16, set only when it changes.
- **Steal focus.** No. Focus moves only on a click the system delivers on a notification Satellite showed. `notices.open` is an event the page receives and can never send.
- **Change the setting.** Yes. `interface.save` can turn notifications off or on, as it can change the theme, which costs the user notifications and nothing else.
- **Forged hooks.** A process running as the user can post hooks that make a session need you, as it can make any pixel lie today, and gets the same bounded notifications.

### The page's inbox

- `InboxReason = { kind: "session"; workspace: WorkspaceRef; tab: string; terminalId: string; session: number; onlySession: boolean; since: number }`, the tab being the session tab's key, the session its number, and `onlySession` true when it is the one tab open in its workspace. `InboxTarget` is its `workspace`, `tab` and `terminalId`.
- `needsSince(previous, status, next)` in `inbox.ts` is the counter rule, `null` for any status but `needs-you`, the previous value while the tab already needed you, else `next()`.
- `InboxRow = { workspace: WorkspaceRef; since: number; reasons: InboxReason[] }`.
- `SessionTab` gains `needsSince: number | null`. A `sessions.status` that moves a tab into `needs-you` from any other status sets it to the next value of one counter per page load, starting at 1. A status other than `needs-you` sets it to `null`, and so does `restart`. A tab that already needs you keeps its value.

### Test ids

Kept, every test id from spec 004. New.

- Sidebar, `inbox` on the inbox section, `inbox-count` on the count, `inbox-empty` on the empty sentence, `inbox-<project name>-<workspace name or main>` on each row, made unique with `withUniqueTestIds`, and `<row test id>-reason` on its sentence.
- Commands, `command-notifications-off`, `command-notifications-on` and `command-inbox-newest`, which the palette derives from the ids.

### Commands

`notifications.off` "Turn notifications off", available while `state.notifications` is true. `notifications.on` "Turn notifications on", available while it is false. `inbox.newest` "Go to the newest workspace that needs you", available while the inbox has a row. None has a shortcut. All go through `guarded()`, so none runs while a dialog is open. The registry list in `AppWindow` becomes `palette.commands`, `project.add`, `project.remove`, `workspace.new`, `workspace.archive`, `session.new`, `session.close`, `session.next`, `session.previous`, `inbox.newest`, `palette.switcher`, `tools.check`, `theme.system`, `theme.light`, `theme.dark`, `notifications.off`, `notifications.on`.

### Copy

Every sentence is fixed here, nothing else may be shown, and no text is shown that a session wrote. No colons in prose, sentences end with a full stop, titles and labels do not.

- Inbox heading `Inbox`. The count shows the number of rows in Geist Pixel, `0` included.
- The count's screen reader text, `Nothing needs you.` for 0, `1 workspace needs you.` and `<n> workspaces need you.`
- Empty, `Nothing needs you right now.`
- A row's sentence, short enough for the sidebar's narrowest column. `Claude Code needs you.` for the one session of its workspace, `Session <n> needs you.` for one of several, and `<k> sessions need you.` when several ask, counting only the reasons of that kind.
- A row's accessible name and tooltip, `<workspace>, <project>. <sentence>`, the project followed by ` in <parent>` when another project has the same name.
- Toasts, after turning off `Notifications are off. The inbox still shows what needs you.` and after turning on `Notifications are on for every workspace that needs you.`
- Notification for one workspace with a record, title `<workspace> needs you` and body `Claude Code is waiting for you in <project>.`
- Notification for one main workspace, title `<project> needs you` and body `Claude Code is waiting for you in the main workspace.`
- Notification for several workspaces, title `<n> workspaces need you` and body `Open Satellite to answer them from the inbox.`

### Scenarios, steps and journeys

New scenario `inbox` and journey `inbox` (Task 5). New driver environment variable `SATELLITE_VERIFY_NOTICES`, new `AppSession.notices()` and new CLI step `notices` (Task 4). The `projects` journey's `menuCommands` becomes 10 (Task 1). `journeys.ts` lists `inbox` after `sessions` (Task 5).

## Review Focus

1. **No outside text in a notification.** `noticeText` takes only names, and `noticeName` leaves no markup, control, direction or line break character. Nothing in `src/main/inbox/` reads anything from a hook body.
2. **Bounded.** At most one notification per 5 seconds, a burst coalesced, the badge set only on change, the needing set one entry per workspace.
3. **No real notification in verification.** The recorder replaces `Notification`, the badge and the in-front rule only behind `drivenByVerify()`, and the driver sets the variable on every launch.
4. **Focus moves only on a real click.** `notices.open` is an event, the page acts only for a listed workspace and only while no dialog is open, and nothing types into the terminal.
5. **The setting reads back.** A version 1 file reads as notifications on, every write is version 2, and a bad field sets the file aside.

---

### Task 1: The notifications setting

`interface.json` version 2 with `notifications`, the two commands, their toasts, and the background process applying the setting. Nothing notifies yet.

**Files:**
- Modify: `src/shared/bridge-contract.ts`, `src/main/state/interface-file.ts`, `src/main/state/interface-file.test.ts`, `src/main/main.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/commands/command-registry.ts`, `src/renderer/window/app-window.tsx`, `verify/journeys/projects.ts`

**Interfaces:**
- Consumes: `readJsonFile`, `createJsonWriter`, `interfaceState`, `defaultInterfaceState`, `applyThemeChoice`.
- Produces:
  - The `interfaceState` and `defaultInterfaceState` changes from Contract and State.
  - `interfaceHandlers(file: InterfaceFile, apply: (state: InterfaceState) => void)`, replacing the theme callback. `interface.save` calls `apply(state)` before it saves.
  - In `main.ts`, `start` defines `const applyInterface = (state: InterfaceState) => { applyThemeChoice(state.theme); }`, calls it with the loaded state where it now applies the theme, and passes it to `interfaceHandlers`. Task 4 adds the notices' `setEnabled(state.notifications)` inside it.
  - `CommandId` gains `"notifications.off"`, `"notifications.on"` and `"inbox.newest"`. This task registers the first two per Commands, each running `update((current) => ({ ...current, notifications: <false or true> }), true)` and then `notify(<the toast from Copy>, "info")`. `inbox.newest` is registered in Task 2.

- [ ] **Step 1: Tests.** See each fail first.
  - `interface-file.test.ts`, `reads a layout saved before notifications as notifications on`, a version 1 file loads with `notifications: true` and the rest as written, and `writes the layout as version 2`, a save then flush leaves a file whose parsed JSON has `version: 2` and `notifications: false` after saving that.
  - `registry.test.ts`, the existing `interface.save` payloads gain `notifications: true`, and `interface.save` with `notifications: "yes"` or without `notifications` answers `invalid-request` with no handler run.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main/state src/main/bridge`, all pass.
- [ ] **Step 3: Journeys stay green.** In `verify/journeys/projects.ts`, `menuCommands` becomes `10`, since `notifications.off` is now listed with a workspace selected.
- [ ] **Step 4: Prove it.**
  - `npm run --silent verify -- default --keep press=Meta+K wait-for=command-notifications-off click=command-notifications-off "wait-text=toast:Notifications are off" restart press=Meta+K wait-for=command-notifications-on tree` on macOS, with `Control+Shift+K` on Windows and Linux, shows the toast before the restart and `command-notifications-on` listed after it. `<home>/interface.json` in the kept temp folder holds `"version":2` and `"notifications":false`. Leave the kept folder where it is, never delete it by hand.
  - `npm run --silent journeys`, all `pass`.
  - `./scripts/check` green.
- [ ] **Step 5: Commit.** `feat(window): remember whether notifications are on`.

---

### Task 2: The inbox in the sidebar

The page derives the inbox from its tabs, draws it at the top of the sidebar and opens a workspace on the session that asks.

**Files:**
- Create: `src/renderer/inbox/inbox.ts`, `src/renderer/inbox/inbox.test.ts`, `src/renderer/inbox/inbox-list.tsx`, `src/renderer/sessions/focus-session.ts`
- Modify: `src/renderer/sessions/use-sessions.ts`, `src/renderer/sessions/sessions-pane.tsx`, `src/renderer/projects/sidebar.tsx`, `src/renderer/ui/icon.tsx`, `src/renderer/window/app-window.tsx`

**Interfaces:**
- Consumes: `SessionTab`, `Sessions`, `ProjectView`, `workspaceLabel`, `withUniqueTestIds`, `StatusPixel`, `Icon`, the registry from Task 1.
- Produces:
  - In `inbox.ts`, the types from The page's inbox, plus:
    - `inboxReasons(tabs: readonly SessionTab[]): InboxReason[]`, one per tab whose status is `needs-you` and whose `needsSince` is a number.
    - `inboxRows(reasons: readonly InboxReason[], listed: (ref: WorkspaceRef) => boolean): InboxRow[]`, grouping by workspace key, dropping workspaces `listed` refuses, each row's `since` the smallest of its reasons and its reasons ordered by `since`, rows ordered by `since` newest first.
    - `reasonSentence(row: InboxRow): string`, per Copy, from an exhaustive `Record` keyed by `kind` that gets only the reasons of the first reason's kind, so a second kind fails typecheck until it has a sentence and never counts another kind as sessions.
  - `focusSessionEvent = "satellite:focus-session"` and `focusSession(terminalId: string): void` in `focus-session.ts`, dispatching `new CustomEvent(focusSessionEvent, { detail: { terminalId } })` on `window`, read back with a zod `z.object({ terminalId: z.string() })` like `sentText`.
  - `SessionsPane` listens once and, for a string `terminalId`, calls `targets.current.get(terminalId)?.focus()` inside `setTimeout`, so it runs after React has shown the tab.
  - In `use-sessions.ts`, `SessionTab.needsSince` per The page's inbox, kept in a `useRef` counter, set in the `sessions.status` subscription and reset in `open` and `restart`.
  - `IconName` gains `"bell"`, drawn `<path d="M4 11V7a4 4 0 0 1 8 0v4l1.25 1.5H2.75zM6.5 14.25h3" />`.
  - `InboxList({ rows, projects, selected, onOpen }: { rows: readonly InboxRow[]; projects: readonly ProjectView[]; selected: WorkspaceRef | null; onOpen: (ref: WorkspaceRef) => void })` in `inbox-list.tsx`.
  - In `AppWindow`, `openFromInbox(target: InboxTarget)`, given the row's oldest reason. It does nothing while `modal` is true. Otherwise it calls `select(target.workspace)`, `activateSession(target.tab)` and `focusSession(target.terminalId)`. It reads no session state, so a status event never rebuilds the command registry. It never writes to a terminal.
- **Layout.** `Sidebar` takes `inbox: ReactNode` and renders it right after the `open-switcher` row and before the Projects header. The inbox is a `<section aria-label="Inbox" data-testid="inbox">`, never inside the `nav`, so `focusSidebarIfLost` and the created-workspace focus keep finding project rows. Its header copies the Projects header's classes, the `bell` icon at 12 pixels, `Inbox`, and on the right `inbox-count` in `font-pixel text-[12px]`, `text-sigfg` when above 0 and `text-dim` at 0, `aria-hidden`, beside an `sr-only` span with the count sentence. With no rows, `<p data-testid="inbox-empty" className="px-2 py-1 text-[13px] text-dim">`. Otherwise an unnamed `<ul className="flex flex-col gap-px">` of rows. Each row is a `button` with the row test id, the accessible name and tooltip from Copy, the selected fill when it is the selected workspace but no `aria-current`, which belongs to the project row, the same rounded, hover and focus ring classes as a workspace row, `px-2 py-[6px]`, a 6 pixel `StatusPixel` in `needs-you` with no label, then two lines. The first line is the workspace's `workspaceLabel`, or its name or `main` when the project's folder is missing, in `text-fg font-medium` truncated, and the project's name with ` in <parent>` from the shared `shownParent` in `text-dim`, never wider than half the line, so a long label gives way first, the second the sentence in `text-[12.5px] text-fg2` truncated, with the `-reason` test id. When a focused row leaves, focus moves to the row now in its place, the one above it at the end, or the inbox section.
- **Rows** come from `useMemo(() => inboxRows(inboxReasons(sessions.all), listed), …)` in `AppWindow`, where `listed` answers whether `projects` holds that project and workspace.
- **Command.** `inbox.newest` per Commands, running `openFromInbox` on the first row's workspace.

- [ ] **Step 1: Tests.** `inbox.test.ts`, see each fail first.
  - `lists each workspace that needs you once, newest first`, three tabs in two workspaces where the older workspace has two asking tabs, giving two rows in the right order with the reasons grouped.
  - `orders a workspace by when it started needing you`, a second asking tab in an older row does not move it above a newer row.
  - `leaves out tabs that do not need you and workspaces that are not listed`.
  - `says which session waits, or how many, short enough for the sidebar`, `Claude Code needs you.`, `Session 2 needs you.` and `3 sessions need you.`
  - `names a session only when its workspace has another, and finds it by its key`.
  - `keeps when a tab started needing you until it stops, then counts afresh`.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/renderer`, all pass.
- [ ] **Step 3: Prove it** with scenario `needs-permission`, whose stand-in asks for permission at the second Enter.
  - `npm run --silent verify -- needs-permission wait-for=inbox-empty click=workspace-repo-alpha click=start-claude wait-text=terminal:stand-in type=one press=Enter press=Enter wait-state=workspace-repo-alpha-status:needs-you click=workspace-repo-beta wait-for=inbox-repo-alpha text=inbox-repo-alpha text=inbox-count shot=inbox-light theme=dark shot=inbox-dark` reads `Claude Code needs you.` in the row and `1` in the count while beta is selected. Look at both screenshots and once more after `resize=900x700`.
  - Append to the same command `click=inbox-repo-alpha type=y wait-state=workspace-repo-alpha-status:working wait-for=inbox-empty tree`. The tree shows `workspace-repo-alpha` with `aria-current`, `session-tab-1` selected, no `inbox-repo-alpha` and `inbox-count` reading `0`. `type=y` reaching the stand-in proves the row put focus in the terminal.
  - `npm run --silent journeys` and `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(inbox): list every workspace that needs you at the top of the sidebar`.

---

### Task 3: The notice rules

The words and the controller that decides when to notify, with their tests. Nothing is wired yet.

**Files:**
- Create: `src/main/inbox/notice-text.ts`, `src/main/inbox/notice-text.test.ts`, `src/main/inbox/notices.ts`, `src/main/inbox/notices.test.ts`, `src/main/inbox/notice-subject.ts`

**Interfaces:**
- Consumes: `WorkspaceRef`, `type BridgeOwner`, `ProjectStore` and `projectName` from `src/main/projects/project-list.ts` (in `notice-subject.ts` only).
- Produces:
  - In `notice-text.ts`, `noticeNameLimit`, `interface NoticeSubject { project: string; workspace: string | null }` with `null` for the main workspace, `interface NoticeText { title: string; body: string }`, `noticeName(raw: string, fallback: string): string` per Names and limits, and `noticeText(subjects: readonly [NoticeSubject, ...NoticeSubject[]]): NoticeText` per Copy, cleaning every name through `noticeName`.
  - In `notice-subject.ts`, `noticeSubject(store: ProjectStore, ref: WorkspaceRef): Promise<NoticeSubject | undefined>`. It answers `{ project: projectName(project.path), workspace: null }` for `main`, the record's `name` for a workspace, and `undefined` when `store.project` throws or the record is gone.
  - In `notices.ts`, `noticeGapMs`, `interface Needing { workspace: WorkspaceRef; owner: BridgeOwner }`, `interface ShownNotice { close(): void }`, and
    ```ts
    interface NoticesOptions {
      inFront: () => boolean;
      subject: (ref: WorkspaceRef) => Promise<NoticeSubject | undefined>;
      show: (text: NoticeText, onClick: () => void) => ShownNotice | undefined;
      setBadge: (count: number) => void;
      open: (target: Needing) => void;
    }
    interface Notices {
      update(needing: readonly Needing[]): void;
      setEnabled(on: boolean): void;
    }
    createNotices(options: NoticesOptions): Notices
    ```
- **Behaviour of `createNotices`**, enabled at creation.
  - `update` keeps the first entry per workspace key. When the number of keys differs from the last call, `setBadge(count)`, so the first call with nothing needing sets no badge.
  - A key that is new since the last call, while enabled and `inFront()` is false, joins `pending`, an insertion-ordered map. A key gone since the last call leaves `pending`. When every key the shown notice named is gone, the shown notice is closed and forgotten.
  - Then, with `pending` not empty and no timer waiting, it flushes at once when nothing was shown yet or `noticeGapMs` has passed since the last show by `Date.now()`, else it sets one timer for the rest of the gap.
  - A flush clears the timer. While disabled or `inFront()` is true it empties `pending` and stops. Otherwise it takes `pending`'s entries, empties it and records the show time before any wait, so no second flush runs inside the gap. It resolves each entry's `subject`, drops the `undefined` ones and stops when none is left. Then it closes the shown notice, calls `show(noticeText(subjects), () => { open(target) })` with `target` the newest entry, and keeps the answer and the keys it named. A `show` that throws is logged once per run with `console.error("Satellite could not show a notification", error)`, and the next need tries again.
  - `setEnabled(false)` empties `pending` and clears the timer. `setEnabled(true)` only enables, so a need that began while off is never announced late.

- [ ] **Step 1: Tests.** See each fail first. `notices.test.ts` uses `vi.useFakeTimers()` and fakes for every option, with `inFront` returning a variable the test sets.
  - `notice-text.test.ts`
    - `names the workspace and its project`, `alpha needs you` and `Claude Code is waiting for you in repo.`
    - `names the project for its main workspace`, `repo needs you` and `Claude Code is waiting for you in the main workspace.`
    - `counts several workspaces`, `3 workspaces need you` and `Open Satellite to answer them from the inbox.`
    - `keeps markup, control and direction characters out of a name`, a project named `<b>x</b> & "y"\n‮z\u0007` gives a name with none of `<>&"\n‮\u0007`, and a project of only such characters gives `a project needs you`.
    - `cuts a long name and stays inside 256 bytes`, a name of 200 four-byte characters gives 32 code points, and the UTF-8 length of the title and of the body are each at most 256.
  - `notices.test.ts`
    - `notifies once when a workspace starts needing you`, one `show`, the badge set to 1.
    - `does not notify again while the workspace still needs you`, the same list again and a list with a second entry for the same workspace from another owner give no second `show`.
    - `notifies again after the workspace was answered`, needing, empty, needing past the gap gives two shows and badges 1, 0, 1.
    - `stays quiet while the window is in front or notifications are off`, no `show`, the badge still set.
    - `gathers a burst into one notification`, five workspaces at once give one `show` titled `5 workspaces need you`, and its click opens the fifth.
    - `waits out the gap before the next notification`, a second workspace two seconds after the first shows nothing until the gap ends and then shows one for it, and a third answered before the gap ends is left out.
    - `closes a notification once everything it named was answered`.
    - `opens the workspace the notification named on a click`, calling the `onClick` passed to `show` calls `open` with that entry.
    - `never announces a need that began while notifications were off`.
    - `skips a workspace that is gone by the time it shows`, `subject` answering `undefined` for every entry gives no `show`.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main/inbox`, all pass.
- [ ] **Step 3: Prove it.** `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(inbox): decide when to notify and with which words`.

---

### Task 4: Notifications and the badge, wired

The sessions feed the needing set to the controller, the platform module shows, records or badges, a click comes back to the page, and the driver reads what would have been shown.

**Files:**
- Create: `src/main/platform/system-notices.ts`
- Modify: `src/main/terminal/terminal-sessions.ts`, `src/main/terminal/terminal-sessions.test.ts`, `src/main/window/main-window.ts`, `src/main/main.ts`, `src/shared/bridge-contract.ts`, `src/renderer/bridge/bridge-client.ts`, `src/renderer/window/app-window.tsx`, `verify/driver.ts`, `verify/cli.ts`

**Interfaces:**
- Consumes: everything from Task 3, `drivenByVerify` from `src/main/window/verification.ts`, `openFromInbox` from Task 2, `applyInterface` from Task 1.
- Produces:
  - In `system-notices.ts`, the only file that imports `Notification` or calls `setBadgeCount` or `setAppUserModelId`.
    - `noticesRecorded(): boolean`, true when `SATELLITE_VERIFY_NOTICES` is an absolute path and `drivenByVerify()` passes, read once at the first call.
    - `prepareSystemNotices(): void`, which on Windows calls `app.setAppUserModelId(appUserModelId)` and does nothing elsewhere.
    - `showNotice(text: NoticeText, onClick: () => void): ShownNotice | undefined`. Recorded, it appends `{"kind":"notice","title","body"}` and answers a `ShownNotice` whose `close` appends `{"kind":"close"}`. Otherwise it answers `undefined` when `Notification.isSupported()` is false, else builds `new Notification({ title, body })`, listens to `click` with `onClick`, logs `failed` once per run with `console.error("The system refused a notification", error)`, calls `show()` and answers `{ close: () => { notice.close(); } }`.
    - `setAppBadge(count: number): void`. Recorded, it appends `{"kind":"badge","count"}`. Otherwise `app.setBadgeCount(count)` on macOS and Linux and nothing on Windows.
    - Every recorded line goes through one promise chain of `appendFile` so lines keep their order, and a failed append is logged and the chain goes on.
  - In `main-window.ts`, `bringToFront(): void`, moved from `focusMainWindow` in `main.ts`, restoring a minimised window, then `show()` and `focus()`, and `windowInFront(): boolean`, true only when the window exists, `isVisible()`, not `isMinimized()` and `isFocused()`. `second-instance` calls `bringToFront`.
  - `createTerminalSessions` takes `onNeeding: (needing: readonly Needing[]) => void`, and every existing call in `terminal-sessions.test.ts` passes `onNeeding: vi.fn()`. After every change of a session's state, in `hookEvent`, in `exited` and in `end`, it calls `onNeeding` with one entry per session that is not ended and whose `state.status` is `needs-you`, `{ workspace, owner }`.
  - The `notices.open` event from Contract and its listeners `Set`.
  - In `main.ts`, `Parts` gains `notices: Notices`, and `assemble` creates `notices = createNotices({ inFront: () => !noticesRecorded() && windowInFront(), subject: (ref) => noticeSubject(projects.store, ref), show: showNotice, setBadge: setAppBadge, open: ({ workspace, owner }) => { bringToFront(); owner.emit("notices.open", { workspace }); } })` and passes `onNeeding: (needing) => { notices.update(needing); }` to the terminals. `applyInterface` also calls `notices.setEnabled(state.notifications)`. `start` calls `prepareSystemNotices()` right after `app.whenReady()`.
  - `AppWindow` subscribes to `notices.open` in an effect and calls `openFromInbox(workspace)` only when `projects` lists that workspace. Read the latest `openFromInbox` through a ref, as `SessionsPane` reads its latest tab, so the subscription is made once.
  - Driver. `launchApp` sets `SATELLITE_VERIFY_NOTICES` to `<temp>/notices.jsonl` on every launch, and `AppSession.notices(): Promise<RecordedNotice[]>` reads it, parsing each line with `z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("notice"), title: z.string(), body: z.string() }), z.strictObject({ kind: z.literal("close") }), z.strictObject({ kind: z.literal("badge"), count: z.int() })])` and answering `[]` for a missing file. The CLI step `notices` answers that list.

- [ ] **Step 1: Tests.** `terminal-sessions.test.ts`, where it already drives hooks through a fake listener, `tells who needs you as hooks arrive`, a `PermissionRequest` gives one entry with the session's workspace and owner, a `PostToolUse` gives an empty list, and a session closed while it asks gives an empty list. See it fail first.
- [ ] **Step 2: Implement** per the interfaces. `npx vitest run src/main`, all pass.
- [ ] **Step 3: Prove it.**
  - `npm run --silent verify -- needs-permission click=workspace-repo-alpha click=start-claude wait-text=terminal:stand-in type=one press=Enter press=Enter wait-state=workspace-repo-alpha-status:needs-you click=workspace-repo-beta wait-for=inbox-repo-alpha wait=1000 notices click=inbox-repo-alpha type=y wait-for=inbox-empty wait=1000 notices`. The one second waits let the recorder's append land, which a CLI proof may do and a journey never does. The window counts as not in front under the recorder, so the selected workspace changes nothing here. The first `notices` holds one `notice` titled `alpha needs you` with the body `Claude Code is waiting for you in repo.` and a `badge` of 1, the second adds a `close` and a `badge` of 0. Paste both into the report.
  - `npm run --silent journeys` and `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(inbox): notify when a workspace needs you and count it on the app icon`.

---

### Task 5: The inbox journey

**Files:**
- Create: `verify/scenarios/inbox/scenario.json`, `verify/journeys/inbox.ts`
- Modify: `verify/journeys.ts`

**Interfaces:**
- Consumes: `AppSession.notices`, `noticeGapMs` from `src/main/inbox/notices.ts`, the helpers in `verify/journeys/conditions.ts`.
- **Scenario `inbox`.** The default repo, `README.md` committed on `main`, the default gh answers as in `needs-permission`, `interface.json` seeded as version 1 with `"theme":"light"`, `"workspaces": [{ "name": "alpha", "steps": [] }, { "name": "beta", "steps": [] }]`, and this script.
  1. `print "Claude Code stand-in\r\n"`, `print "\u001b[?2004h"`, `print "> "`.
  2. `await "\r"`, `hook UserPromptSubmit`, `print "\r\nWorking on it.\r\n"`.
  3. `await "\r"`, `hook PermissionRequest { tool_name: Bash }`, `hook Notification { notification_type: permission_prompt }`, `hook PermissionRequest { tool_name: Bash, agent_id: helper }`, `print "Allow Bash for both? Press y to allow.\r\n"`.
  4. `await "y"`, `hook PostToolUse { tool_name: Bash }`, `hook PostToolUse { tool_name: Bash, agent_id: helper }`, `print "Allowed.\r\n"`.
  5. `await "\r"`, `hook PermissionRequest { tool_name: Bash }`, `print "Allow Bash again? Press y to allow.\r\n"`, `await "y"`, `hook PostToolUse { tool_name: Bash }`, `print "Allowed again.\r\n"`.
  6. `await "\r"`, `hook PermissionRequest { tool_name: Bash }`, `print "Allow Bash once more? Press y to allow.\r\n"`, `await "y"`, `hook PostToolUse { tool_name: Bash }`, `hook Stop`, `print "Done.\r\n> "`.
- **Journey `inbox`, scenario `inbox`.** Every wait through `waitUntil` or Playwright's own waiting. The only fixed waits are the two settles below, each `noticeGapMs + 1000`, the one place the verify skill allows, since they prove something stays absent. The window keeps the size the driver opens. The command shortcut is `Meta+K` on macOS and `Control+Shift+K` elsewhere.
  1. `inbox-empty` reads `Nothing needs you right now.` and `inbox-count` reads `0`.
  2. Select alpha, start Claude Code, type `one` and Enter, alpha's pixel reads `working`. Enter, the terminal shows `Allow Bash for both`, the pixel reads `needs-you`. Select beta.
  3. With beta selected, `inbox-repo-alpha` is visible, its `-reason` reads `Claude Code needs you.`, `inbox-count` reads `1`. The recorded list holds one `notice`, `alpha needs you` and `Claude Code is waiting for you in repo.`, and a `badge` of 1. Settle, and the list still holds exactly one `notice`, though a permission notice and a second agent asked meanwhile.
  4. Click `inbox-repo-alpha`. `workspace-repo-alpha` has `aria-current`, `session-tab-1` is selected, and `terminalFocused` passes. The stand-in logged no input between the second Enter and this click, so opening typed nothing.
  5. Type `y`. The terminal shows `Allowed.`, `inbox-empty` is back, and the list gains a `close` and a `badge` of 0.
  6. Enter. The terminal shows `Allow Bash again`, the row is back, and within `promptTimeoutMs` the list holds a second `notice` with the same title.
  7. Open the command menu, fill `palette-input` with `notifications`, click `command-notifications-off`, and the toast reads `Notifications are off. The inbox still shows what needs you.` Click `inbox-repo-alpha`, `terminalFocused` passes, type `y`, the terminal shows `Allowed again.`
  8. Enter. The terminal shows `Allow Bash once more`, `inbox-repo-alpha` is visible and the last `badge` is 1. Settle, and the list still holds exactly two `notice` entries.
  9. Type `y`. The terminal shows `Done.`, the pixel reads `done`, `inbox-empty` is back and the last `badge` is 0.
  10. `relaunch`. The command menu lists `command-notifications-on` and not `command-notifications-off`. `close()` reports no leftover, and the stand-in's pid is gone.
- `journeys.ts` lists `inbox` right after `sessions`.

- [ ] **Step 1: Write the journey.** Before trusting it, break one rule at a time for one run and see the journey fail with a legible reason, then restore. Notify on every `update` call, ignore `setEnabled(false)`, and drop the `focusSession` call from `openFromInbox`.
- [ ] **Step 2: Prove it.**
  - `npm run --silent journeys` prints `pass` for every journey.
  - The off acceptance through the driver, `npm run --silent verify -- inbox press=<the shortcut> wait-for=command-notifications-off click=command-notifications-off click=workspace-repo-alpha click=start-claude wait-text=terminal:stand-in type=one press=Enter press=Enter wait-for=inbox-repo-alpha wait=6000 notices text=inbox-count` answers a list with a `badge` of 1 and no `notice`, and the count `1`.
  - `./scripts/check` green.
- [ ] **Step 3: Commit.** `test(verify): prove the inbox, one notification per need and the switch`.

---

### Task 6: Docs, skills and status Done

**Files:**
- Modify: `ARCHITECTURE.md`, `SATELLITE.md`, `DESIGN.md`, `.claude/skills/satellite-stack/SKILL.md`, `.claude/skills/satellite-verify/SKILL.md`, `specs/005-inbox-and-notifications/spec.md`, `specs/README.md`

- [ ] **Step 1: ARCHITECTURE.md.**
  - Bridge. The `interface.load` and `interface.save` rows gain the `notifications` boolean, and the `interface.save` row says a hostile page can also turn notifications off or on. A new row for the `notices.open` event, with what a page could do from Global Constraints.
  - State. `interface.json` version 2 with `notifications`, and that a version 1 file reads as version 2 with notifications on.
  - A new section `## Inbox and notifications` after Sessions, saying in a few bullets that the inbox is derived on both sides and never stored, the needing set and the badge, the in-front rule, the gap and the coalescing, the words and the name cleaning, the click and the page's checks, and the platform notes on macOS signing, the Windows app identity and the Linux launcher, from Rulings checked.
  - Platform. `system-notices.ts` in the module's list, and the Quiet verification bullet names `SATELLITE_VERIFY_NOTICES` beside the links file, with the window counting as not in front under it.
  - Folder layout. `src/main/inbox/`, `src/renderer/inbox/`, `src/main/platform/system-notices.ts`, `src/renderer/sessions/focus-session.ts`, and `main-window.ts` bringing the window forward.
  - Decisions. Rows for derived inbox state over a stored one, the 5 second gap with coalescing over one notification per need, and the setting in `interface.json` with two commands over a settings page.
- [ ] **Step 2: SATELLITE.md.** The Layout or Sessions section says in one or two sentences that the inbox at the top of the sidebar lists every workspace that needs you, newest first, that a notification reaches you when the window is in the back unless you turned notifications off in the command menu, and that the app icon carries the count on macOS and Linux.
- [ ] **Step 3: DESIGN.md.** In App, one bullet for the inbox, its header and count in signal text only while something needs you, its rows with the signal pixel, the workspace, the project and the sentence, and the empty sentence.
- [ ] **Step 4: Skills.** `satellite-stack`, that `src/main/platform/system-notices.ts` owns notifications and the badge, and `SATELLITE_VERIFY_NOTICES` in Run and prove. `satellite-verify`, the `notices` step, `AppSession.notices()`, the recorder and that the window counts as not in front under it, scenario `inbox`, the `inbox` journey row, the `projects` journey's ten commands, and feature map rows for 005.
- [ ] **Step 5: Status.** Spec and index to **Done**, and tick the spec's acceptance items. Leave `plan.md` to the controller.
- [ ] **Step 6: Check.** `./scripts/check` and `npm run --silent journeys` green, last lines in the report. Commit `docs: describe the inbox and notifications and mark spec 005 done`.

---

## Acceptance map

| Acceptance item or scope bullet | Task | Proof |
| --- | --- | --- |
| A session asking for permission in a workspace that is not selected appears in the inbox with its reason | 2 | scenario `needs-permission` in Task 2 Step 3, `inbox` journey step 3 |
| Answering the session removes the row | 2 | scenario `needs-permission` in Task 2 Step 3, `inbox` journey step 5 |
| With the window unfocused, needing the user raises one notification, and not a second one for the same reason | 3, 4, 5 | `notices.test.ts`, the `notices` run in Task 4 Step 3, `inbox` journey steps 3 and 6 |
| With notifications off, none is raised and the inbox still fills | 1, 3, 5 | the driver run in Task 5 Step 2, `notices.test.ts`, `inbox` journey step 8 |
| Scope, inbox at the top of the sidebar with a count, every workspace across projects, most recent first, one sentence each | 2 | `inbox.test.ts`, the Task 2 screenshots, `inbox` journey step 3 |
| Scope, selecting a row opens that workspace on the thing that needs attention | 2 | Task 2 Step 3, `inbox` journey step 4 |
| Scope, a workspace leaves the inbox by itself when the reason is gone | 2 | `inbox` journey steps 5 and 9 |
| Scope, a click on the notification opens that workspace | 3, 4 | `notices.test.ts` `opens the workspace the notification named on a click`, and the page handler sharing `openFromInbox`, which `inbox` journey step 4 proves |
| Scope, the app icon carries the inbox count where the system supports it | 3, 4 | `notices.test.ts`, the recorded `badge` lines in Task 4 Step 3 and the `inbox` journey |
| Scope, one setting turns notifications off | 1 | Task 1 Step 4, `inbox` journey steps 7 and 10 |
