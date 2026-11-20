---
name: satellite-verify
description: "Use when proving a change in the real Satellite window, writing a scenario or a stand-in step, or adding a journey."
---

# Satellite verify

One command launches the real app in a scenario, runs steps against the window and prints one JSON object. It is how every change is proven.

```sh
npm run --silent verify -- <scenario> [--dev | --app <executable>] [--real-claude] [--keep] [step ...]
```

`--silent` keeps npm's banner out, so stdout is only the JSON. Build logs go to stderr. With no steps it runs `wait-for=app-window tree shot=window`.

## Targets

| Flag | Target | What runs |
| --- | --- | --- |
| none | built | `electron-vite build`, then Electron with the repo root as the app |
| `--dev` | dev | `electron-vite dev` with hot reload, the interface served from `http://localhost` |
| `--app <executable>` | packaged | a packaged app from `release/`, nothing is built. Name the executable itself, `mac-arm64/Satellite.app/Contents/MacOS/Satellite` on macOS, `win-unpacked/Satellite.exe` on Windows, `linux-unpacked/satellite` on Linux |

Every target runs with the scenario's throwaway repo as its working folder. Claude Code starts in the selected workspace's folder, so a scenario selects a workspace, by clicking its row, before `start-claude`.

Built and dev runs in one checkout must not overlap, because each rewrites `out/`. A second run fails fast while `verify-output/run.lock` names a live run, so parallel work takes its own worktree.

## Steps

Steps run in order. The first failure stops the run, and its entry carries `error` plus `tree`, the window at that moment.

| Step | Does | Value |
| --- | --- | --- |
| `tree` | reads the window | `aria`, the accessibility snapshot of the body, and `testIds`, each `{ testId, visible, text }` with text cut at 2000 characters |
| `text=<testid>` | reads one element's text | the text, cut at 2000 characters |
| `click=<testid>` | clicks an element | |
| `type=<text>` | types into the focused element, failing when nothing has focus | the focused test id |
| `press=<key>` | presses a key, such as `Enter`, `Shift+Enter` or `Control+C` | |
| `select=<testid>:<label>` | picks the option with that label in a `select`, split at the first `:` | |
| `paste=<text>` | dispatches a paste event with the text on the focused element, failing when nothing has focus | the focused test id |
| `paste-size=<n>` | pastes `n` generated characters, `abc…xyz0…9` repeated, up to 1000000 | the focused test id |
| `resize=<width>x<height>` | sets the viewport size | |
| `theme=light` or `theme=dark` | emulates the system color scheme, which also hides the theme chosen in Satellite. Without it the window shows the theme the scenario seeds, or the real system's when it seeds none | |
| `wait=<ms>` | waits, up to 60000 | |
| `wait-for=<testid>` | waits up to 60 seconds for an element to be visible | |
| `wait-text=<testid>:<text>` | waits up to 60 seconds until the element's inner text holds the text, split at the first `:`, and fails naming what it last read | |
| `wait-state=<testid>:<state>` | waits up to 60 seconds until the element's `data-state` equals the state, split at the first `:`, and fails naming the state it last read. Session tabs carry the session status (`idle`, `working`, `needs-you`, `done`, `stopped`), and each workspace row's `-status` pixel carries the pixel state, where a stopped session reads `idle` | |
| `send=<text>` | sends the text to Claude Code as the app's own Send to Claude Code does, through the same window event, so the pane cleans it and types it into the shown session without submitting | |
| `shot=<name>` | saves a screenshot, the name in kebab-case | its path |
| `log` | reads what the stand-ins recorded | the events |
| `notices` | reads what the app would have shown the system, each notification, close and app icon count. Every launch first records a count of 0, so a run can tell the recorder answers before anything could notify. The recorder appends a moment after the change, so a CLI proof may wait a second first | `{ kind: "notice", title, body }`, `{ kind: "close" }` and `{ kind: "badge", count }` in order |
| `choose-folder=<target>` | sets what the next folder dialog answers. `repo` is the working repo, `cancel` cancels, anything else is `folders/<target>` in the temp folder, such as `alpha`, `alpha/src` or a folder that does not exist | |
| `drop=<target>` | drops a folder on the middle of the repository column through the protocol's drag events, as Finder would. Targets are those of `choose-folder` except `cancel` | |
| `restart` | closes the app and launches it again on the same home, repo and log, so saved state can be read back | |

A command shortcut is `press=Meta+K` on macOS and `press=Control+Shift+K` on Windows and Linux, so a journey picks the modifier from the platform, as `projects` does. The driver emulates `prefers-reduced-motion: reduce` from launch, so transitions are off and a screenshot never catches one halfway. Wait for a settled state with `wait-for` rather than a fixed `wait`, as `check-count` appears only once the first run check has answered.

`consoleErrors` holds console errors, uncaught errors and unhandled rejections from the first render on, because the driver attaches before the page runs or, when the page already ran, the protocol replays what it buffered.

`wait` gets its own length plus 15 seconds, and `wait-for`, `wait-text`, `wait-state` and `restart` get 75 seconds. Every other step fails after 15 seconds. Paste goes through a synthetic event because the app denies the clipboard permission.

The output is `{ scenario, home, repo, steps: [{ step, ok, value?, error?, output?, tree? }], consoleErrors, screenshots, leftover? }`. When arguments, the build or the launch fail, `steps` holds one entry named `arguments`, `build` or `launch`, and a failed launch adds the app's last output and the window tree when one exists. `home` and `repo` are `null` until the temp folder exists. A failed close adds a `close` entry, and `leftover` names a temp folder that could not be deleted. The exit code is 1 when any step failed or something was left over. It does not count `consoleErrors`, so read them.

## Scenarios

A scenario is `verify/scenarios/<kebab-name>/scenario.json`, checked by `scenarioSchema` in `verify/scenario.ts`.

- `description` says what world it sets up.
- `repo` builds the throwaway repo in order. `{ "write": { "path", "content", "executable"? } }` writes a file inside it, with mode `0o755` when `executable` is true, such as a hook in `.git/hooks`, and `{ "git": [args] }` runs the real `git` there, with no system config and a global config naming `Satellite Verify`.
- `home` optionally lists `{ path, content }` files written inside the Satellite home before launch, with the same confinement as the repo's writes, such as a cut off `interface.json`. A scenario seeds `interface.json` with `"theme": "light"` unless its description says otherwise, so its screenshots never depend on the machine's own setting.
- `folders` optionally lists `{ name, steps }`, each built like `repo` in `folders/<name>` beside it, with a kebab-case name. They are built before `repo`, so a repo step can clone one with `../folders/<name>`, and they are the folders a `choose-folder` step can pick.
- `workspaces` optionally lists `{ name, steps }` with a kebab-case name. After `repo` is built, each gets `git branch --no-track <name> HEAD` and `git worktree add <home>/worktrees/repo/<name> <name>` in the repo, then its steps inside the new folder. The driver then writes `projects.json` as version 2 with the repo as the one project and a record per workspace, so a scenario that also seeds `projects.json` under `home` is refused.
- `userHome` optionally lists `{ path, content }` files written inside the run's temporary user home, with the same confinement, such as the user's own `.claude/settings.json` and `.claude.json`.
- `gh` lists canned answers, `{ args, stdout?, stderr?, exitCode? }`. The stand-in answers the first entry whose `args` equal its own exactly.
- `claude` holds the `version` line and a `script` played when the stand-in starts. `{ "print": text }` prints, `{ "wait": ms }` waits, `{ "flood": chars }` prints that many characters as numbered lines as fast as the terminal takes them, then `flood done <lines> lines`, `{ "child": "ignores-hangup" }` starts a child process that ignores `SIGHUP`, `{ "hook": <event>, "fields"?: { ... } }` posts that hook event as Claude Code would, `{ "await": text }` waits until the input not yet consumed holds the text and consumes it through the match, `{ "trust": true }` asks whether to trust the folder and waits for Enter, like Claude Code's trust dialog, and `{ "exit": <code> }` exits with that code, as a crash does when the code is not 0. `"resumeFails": true` beside `script` makes every `--resume` print `No conversation found with session ID: <id>` and exit 1, as Claude Code does for a session it cannot find. In a script with a trust step, hooks before it post nothing. `{ "missing": true }` instead points `SATELLITE_CLAUDE` at a path that does not exist, so the app finds no Claude Code.

## Stand-ins

`verify/stand-ins/gh.ts` and `verify/stand-ins/claude.ts` run with the Node that runs the driver, passed to the app through `SATELLITE_GH` and `SATELLITE_CLAUDE`. They find their scenario through `SATELLITE_VERIFY_SCENARIO`.

- **gh** prints its answer and exits with its code. Without an answer it prints `stand-in gh has no answer for <args>` and exits 1.
- **claude** prints `version` for `--version`. Otherwise it puts stdin in raw mode, so nothing typed is line edited, echoes every chunk (ESC then CR echoes as a new line) and exits on Ctrl+C or Ctrl+D, all while it plays the script. With `--resume <id>` it first prints `Resumed session <id>`, or fails as `resumeFails` says. It reads the file after `--settings` once at start, as Claude Code does, and a `hook` step posts `{ session_id, transcript_path, cwd, hook_event_name, ...fields }` to that event's URL with its headers, `session_id` being the value after `--session-id` or `--resume`. Without a settings file, without that event in it, before trust or when the request fails it posts nothing and logs status `0`.

Both append JSON lines to `SATELLITE_VERIFY_LOG`, read back by the `log` step. Events are `start` with `tool`, `pid` and `args`, `input` with `data`, `resize` with `cols` and `rows`, `child` with the `pid` of a started child, and `hook` with the `event` and the `status` the listener answered. Startup calls such as `gh --version` appear once on the built and packaged targets. The dev target runs React in development mode, whose strict mode runs every effect twice, so count events on a built run.

## Home, output and cleanup

Each run makes `satellite-verify-*` in the system temp folder, its real path, with `home/` as `SATELLITE_HOME`, `repo/`, `user-home/` as `HOME`, and `USERPROFILE` on Windows, on every run but `--real-claude`, `folders/`, `gitconfig`, an empty `git-ignore` the gitconfig names as `core.excludesFile`, `stand-ins.jsonl`, `folder-dialog.txt` and `notices.jsonl`, which `SATELLITE_VERIFY_NOTICES` names, so no run ever raises a real notification or app icon count and the window always counts as not in front. `SATELLITE_VERIFY_FOLDER_DIALOG` points the app at `folder-dialog.txt`, so the folder dialog never opens and its trimmed content is the chosen folder, a missing or empty file meaning canceled. The user's own `~/.satellite` is never touched, and with the user home redirected neither is anything Satellite or the stand-ins would find through `homedir()`, the user's own Claude Code settings included. What the system finds through the account itself rather than those variables, such as Electron's own folders on macOS, still points at the real account. The app gets the driver's environment without `GIT_*`, `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_CONFIG_DIR`, `NODE_OPTIONS` and `ELECTRON_RUN_AS_NODE`, then gets `GIT_CONFIG_GLOBAL` pointing at the recipe's `gitconfig` and `GIT_CONFIG_NOSYSTEM=1`, so its git never reads the user's own git config, ignore file or hooks. The recipe's `git` runs without the inherited `GIT_*` too. The run closes the window, kills the process tree once it exits or after 10 seconds, and deletes the temp folder unless `--keep` is set. SIGINT, SIGTERM and SIGHUP, plus SIGBREAK on Windows, stop the build or the app and delete the temp folder the same way. Any other exit of the driver, an uncaught error included, kills every app it started, and the app starts quitting within a second of the driver's process going away, so even a `SIGKILL` leaves no app behind.

Never leave an app running. A script over the driver closes its session in a `finally`, and after a batch of runs no process from this repo's `node_modules/electron` may remain.

On macOS a run is quiet by default, which needs the driver's own process alive, so a leftover variable never hides a real app. The app takes no Dock icon, never comes to the front and keeps its window unshown while it still renders, and the driver emulates focus, so every step proves the same things without taking the user's screen. Set `SATELLITE_VERIFY_FOREGROUND=1` to watch a run in a normal window. The release workflow sets it, and Windows and Linux always show the window. A quiet window is not clamped by the display, so it keeps the 1440 by 900 the app opens at. Screenshots land in `verify-output/<scenario>-<timestamp>/`, which Git ignores.

## Real Claude Code

`--real-claude` leaves `SATELLITE_CLAUDE` out and keeps the user's home and `CLAUDE_CONFIG_DIR`, so the app runs the user's own Claude Code with its own sign-in, which updates its own state in the user's home. Ask the user every time before using it, and only in a throwaway scenario repo. Its trust question for the new folder starts on No, exit, so press the down arrow, once Claude Code shows the question and takes keys, and read that Yes is selected before Enter. Claude Code holds back every hook until trust is answered and runs no HTTP hook at session start, so the pixel and Send to Claude Code wake at the first prompt.

## In code

`verify/driver.ts` exports `launchApp({ scenario, target, realClaude?, keep? })`, which returns an `AppSession` with the Playwright `page`, `home`, `repo`, `userHome`, the run's temporary user home, `consoleErrors`, `standInEvents()`, `screenshot(name)`, `folder(name)`, the path of `folders/<name>`, `gitEnv`, the clean git environment the recipe runs with, `answerFolderDialog(path | undefined)`, `dropFolder(path)`, which drops a path like the `drop` step, `dropFiles(testId, paths)`, which drops files on the centre of that test id, `openedLinks()`, the addresses `links.open` would have opened, read from the file the driver names in `SATELLITE_VERIFY_LINKS`, so no run ever opens a browser, `notices()`, what the `notices` step answers, `relaunch(whileClosed?)` and `close()`, which answers `{ exitedOnItsOwn, leftover? }`, where `exitedOnItsOwn` says the app quit within 10 seconds of its window closing, before any kill. `relaunch(whileClosed?)` closes the app, runs `whileClosed` while no app runs, so a journey can change the disk without a list seeing it halfway, and launches it again in the same temp folder, after which `page` answers the new page, so a wrapper forwards `page` with a getter rather than copying it. A second `close()` answers the first one's result. A failed launch throws `LaunchFailure` carrying `output`, `consoleErrors`, `tree`, `home` and `repo`. It also exports `buildApp()`, `readTree(page)`, `withTimeout`, `errorReason`, `outputDir`, `isProcessAlive(pid)`, which counts a process it may not signal as alive, `pasteIntoFocus(page, text)` and `generatedText(size)`, the text `paste-size` sends. Journeys use it directly.

## Journeys

Journeys are fixed scripts over the driver that prove the first run, the security boundary, projects, workspaces, sessions, the inbox, untouched settings and quitting. They run against the built app here and against each packaged app in the release workflow.

```sh
npm run --silent journeys -- [--app <executable>]
```

To prove a packaged app on macOS, run `npm run build`, then `npx electron-builder --mac --arm64 --publish never`, then the journeys with `--app release/mac-arm64/Satellite.app/Contents/MacOS/Satellite`. Windows and Linux are proven by pushing the branch as `platforms/<slug>`, which runs the release workflow without publishing.

It builds once for the built target, runs every journey in order, each in a fresh launch of its scenario, and prints `pass <name>` or `fail <name> <reason>`, the reason cut to its first line, each followed by its screenshot paths. A failing journey saves `<name>-failure` when the window is still open. The exit code is 1 when any journey failed or left its temp folder behind.

| Journey | Scenario | Proves |
| --- | --- | --- |
| `launch` | `default` | three columns, the first run check reading the git version and the gh account, the working repo added through the folder dialog, Claude Code starting, typing, Shift+Enter and a 100000 character paste arriving whole and in order, a resize that changes the rows reaching the stand-in, the diff's two sides, a reload ending the first stand-in, a quit ending the app and the second stand-in, and no console errors |
| `boundary` | `default` | no Node in the window, `window.satellite` holding only `invoke`, `onEvent` and `pathForFile`, `pathForFile` answering an empty string for a made-up file and for text, `projects.drop` refusing a relative path and adding nothing, the content security policy refusing an inline script, a `data:` fetch, a remote fetch, image and frame, microphone, camera and notifications reading denied, no path escaping the `app://` root, the bridge refusing a bad payload and an unknown channel, workspace requests refused with nothing written, meaning a name that climbs out or starts with a dash, archiving `main`, a project or workspace that is not listed, a made-up creation to cancel, and a made-up or stale fingerprint that leaves the workspace and a file written after the inspection in place, no new window or navigation reaching a remote address, and Claude Code still running and echoing after those refused navigations, `sessions.resumable` refusing an extra field and a climbing workspace and offering nothing for main, a made-up project or a made-up workspace, `terminal.start` refused for another program, an extra `args` or `cwd`, a project or workspace not on record and a resume with nothing recorded, then the same request without the change starting Claude Code, `links.open` refusing `javascript:`, forged hook posts without the secret, with a wrong one and with an `Origin` refused with `401`, `401` and `403` while the pixel stays, and Send to Claude Code refused before the session reported its start |
| `projects` | `two-projects` | a plain folder refused with its sentence, alpha added with the add shortcut and beta by a drop, a second add of alpha refused, the left column narrowed from the keyboard to a width read from its divider, so the step holds at any window size, the switcher selecting alpha, a branch switched outside Satellite shown on focus, the projects, the selection and the width restored after a restart, the command menu listing the ten commands available with a workspace selected, alpha removed from it with its folder byte for byte unchanged, beta without its `.git` shown as no longer a repository and found again once `.git` is back, beta moved away shown as missing and removed, and no console errors |
| `workspaces` | `fresh-repo` | a workspace made from the dialog with a valid suggested name, selected and announced, holding the files `.worktreeinclude` lists and none of the others, on the fetched main, a second made with the shortcut from `release`, a file written in one absent from the other and the repo, the second deleted outside Satellite leaving on restart with its sentence while the first keeps its count, a worktree with no record adopted on that restart, the first archived through the dialog after it listed the uncommitted file and the commit that is not pushed, its folder and worktree gone, its branch kept with the commit, and a folder outside linked into it untouched, then a creation whose checkout hook links an outside folder and fails undone with that folder untouched and no folder, worktree or branch left, and no console errors |
| `sessions` | `needs-permission` | every typed prompt reaching the stand-in whole, the pixel going working, needs you, working and done, a send refused while Claude Code asks and one with no session, two workspaces running at once with each terminal kept as the same element and output printed while hidden shown on return, a pass at 900 by 700, a second tab whose send stays in it and whose close ends its process and settings file, a hostile send arriving cleaned and bracketed with no Enter, which a waiting prompt would have submitted, image paste and dropped files, links asking before they open, every hook answered `204`, resume after a restart, the ended and crashed sentences, off Windows a workspace whose folder moved away ending its session with one sentence, since Windows cannot move a folder a process runs in, and no process left |
| `inbox` | `inbox` | the recorder answering with a clear count before anything starts, an empty inbox, a session asking in alpha while beta is selected listed with its sentence and one notification and a count of 1, none more after a permission notice, a helper agent and a second tab in the same workspace, the row opening alpha on the asking tab with focus in its terminal and nothing typed, the row and the count leaving and the notification closing once answered, a new notification when alpha asks again, beta and main asking inside the gap folded into one that names the count, the three rows newest first, every app icon count in order, notifications switched off while the inbox and the count still fill, the shown notification closed and the count cleared at quit, no stand-in left after the restart, and the switch kept, so beta asking again before anything is saved still raises no notification |
| `missing` | `claude-missing` | with Claude Code missing, a start that draws no tab and shows the sentence and the install step. Off Windows, a script written where Claude Code should be, started by its shortcut, clearing that sentence, then a start beside another tab after the script is removed giving the sentence as a toast and keeping one tab |
| `settings` | `settings-files` | with the app in a temporary user home, the user's Claude Code settings there and both `.claude` folders equal to the seeded bytes at launch, sessions in main and alpha through a prompt, each settings file inside the Satellite home with mode `0600` holding only HTTP hooks to its own launch's path, then every one of those files still equal to the seeded bytes, `git status` clean and no settings file left |
| `quit` | `flood` | with the main workspace selected, quitting mid flood ends the stand-in and its child that ignores hangup |

A journey is `{ name, scenario, run(session) }` in `verify/journeys/<name>.ts`, listed in `verify/journeys.ts`. It asserts with `node:assert/strict` and a message that says what went wrong, and waits on conditions with `waitUntil` from `verify/journeys/conditions.ts`, never on fixed sleeps, because CI runners and Windows are slower. A check that something stays refused is the one place a short settle is right. The boundary journey routes `https://example.com` to a local empty reply, so a guard that lets a request through is caught at once with no network, and a refusal is read from a `securitypolicyviolation` event or a permission state rather than from a failed load. Process checks use `processGone`, which works on all three platforms. Keep the suite short, since it runs three times per release.

Before trusting a new check, turn its guard off for one run and see the journey fail with a legible reason. Note that two guards back each other up in places. Navigation is refused by `will-navigate` and `will-frame-navigate` alike, and the URL parser already folds `%2e%2e` segments, so only an encoded slash such as `..%2f` reaches the protocol's path confinement. `..%5c` means something only on Windows, and Chromium refuses a `file:` navigation from `app://` by itself, so neither proves a guard on its own. `sandbox` and `nodeIntegration` cannot be seen from the page, and the protocol's host and method checks and the sender check cannot be reached from it, so unit tests beside them pin those. A resize sizes the viewport from the current one, 200 pixels shorter, never to a fixed size, because a CI runner's small display already clamps the window and a fixed size can equal it. The paste is a synthetic event, so it proves the terminal and the bridge carry it, not the platform's paste shortcut.

## Feature map

| Feature | Scenario | Journey |
| --- | --- | --- |
| 001 Foundation, the three columns | `default` | `launch` |
| 001 Foundation, the terminal, the diff and reload cleanup | `default` | `launch` |
| 001 Foundation, the security boundary | `default` | `boundary` |
| 001 Foundation, process cleanup in the middle of a flood. Pausing and resuming output is pinned by `src/main/terminal/output-flow.test.ts`, not by a journey | `flood` | `quit` |
| 002 Shell and projects, the first run check with every tool ready | `default` | `launch` |
| 002 Shell and projects, the first run check with Claude Code missing or gh signed out | `claude-missing`, `not-signed-in` | |
| 002 Shell and projects, `window.satellite` holding three functions and `projects.drop` refusing a forged relative path | `default` | `boundary` |
| 002 Shell and projects, a state file cut off mid-write is set aside and the app starts fresh | `corrupt-state` | |
| 002 Shell and projects, adding repositories through the dialog and by a drop, refusing other folders and duplicates, the quick switcher, restoring the selection and column width, removing a project with its folder byte for byte unchanged, and a project whose `.git` or whole folder moved away | `two-projects` | `projects` |
| 003 Workspaces, each workspace in the sidebar with its branch, the commits it has on no remote and its changed files, only the selected one current, removing a project that still has a workspace refused, and the archive dialog listing what would be lost | `unpushed-work` | |
| 003 Workspaces, making a workspace from the latest default branch or a chosen one, with the files `.worktreeinclude` lists, and a name refused before any step | `fresh-repo` | |
| 003 Workspaces, a creation whose checkout hook fails showing the failed step and leaving no branch, worktree or folder | `failing-hook` | |
| 003 Workspaces, two workspaces holding different files, one deleted outside Satellite leaving on restart, a worktree with no record adopted, and archive listing what would be lost, then removing the worktree, keeping the branch and leaving a linked outside folder untouched, and undoing a creation whose hook linked an outside folder without touching it | `fresh-repo` | `workspaces` |
| 003 Workspaces, refusing workspace requests that name a bad name, `main`, an unlisted project or workspace, a made-up creation or a stale fingerprint | `default` | `boundary` |
| 004 Claude Code sessions, a session started in a workspace with Satellite's session id and settings file, posting every hook a prompt, a permission request and its approval make, each answered by the listener | `needs-permission` | |
| 004 Claude Code sessions, a plain address, one with a concealed tail and a hyperlink escape sequence in the output, underlined on hover | `needs-permission` | |
| 004 Claude Code sessions, a session that crashes, one that ends and a resume Claude Code cannot find, each with its sentence, and the record forgotten after that failed resume | `session-endings` | |
| 004 Claude Code sessions, the workspace pixel going working, needs you, working and done, a second workspace's session leaving the first one's screen as it was, and the resume offer after a restart | `needs-permission` | |
| 004 Claude Code sessions, two workspaces and two tabs at once, status, send, image paste, dropped files, links, resume and endings | `needs-permission` | `sessions` |
| 004 Claude Code sessions, Claude Code missing at a start, with no tab and beside another, and the sentence gone once a start works | `claude-missing` | `missing` |
| 004 Claude Code sessions, the user's Claude Code settings and the repo untouched by a session | `settings-files` | `settings` |
| 004 Claude Code sessions, the new channels and the hook listener refusing a hostile page and forged hooks | `default` | `boundary` |
| 005 Inbox and notifications, a session asking in a workspace that is not selected listed with its sentence, opened from its row and gone once answered | `needs-permission` | |
| 005 Inbox and notifications, the inbox filling and emptying, one notification per need, a burst folded into one, the off switch kept after a restart, and the count on the app icon, all through the recorder | `inbox` | `inbox` |
