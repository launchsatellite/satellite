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

Every target runs with the scenario's throwaway repo as its working folder, so a terminal the app opens starts inside it.

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
| `paste=<text>` | dispatches a paste event with the text on the focused element, failing when nothing has focus | the focused test id |
| `paste-size=<n>` | pastes `n` generated characters, `abc…xyz0…9` repeated, up to 1000000 | the focused test id |
| `resize=<width>x<height>` | sets the viewport size | |
| `theme=light` or `theme=dark` | emulates the system color scheme, which also hides the theme chosen in Satellite. Without it the window shows the theme the scenario seeds, or the real system's when it seeds none | |
| `wait=<ms>` | waits, up to 60000 | |
| `wait-for=<testid>` | waits up to 60 seconds for an element to be visible | |
| `shot=<name>` | saves a screenshot, the name in kebab-case | its path |
| `log` | reads what the stand-ins recorded | the events |
| `choose-folder=<target>` | sets what the next folder dialog answers. `repo` is the working repo, `cancel` cancels, anything else is `folders/<target>` in the temp folder, such as `alpha`, `alpha/src` or a folder that does not exist | |
| `drop=<target>` | drops a folder on the middle of the repository column through the protocol's drag events, as Finder would. Targets are those of `choose-folder` except `cancel` | |
| `restart` | closes the app and launches it again on the same home, repo and log, so saved state can be read back | |

The driver emulates `prefers-reduced-motion: reduce` from launch, so transitions are off and a screenshot never catches one halfway. Wait for a settled state with `wait-for` rather than a fixed `wait`, as `check-count` appears only once the first run check has answered.

`consoleErrors` holds console errors, uncaught errors and unhandled rejections from the first render on, because the driver attaches before the page runs or, when the page already ran, the protocol replays what it buffered.

`wait` gets its own length plus 15 seconds, and `wait-for` and `restart` get 75 seconds. Every other step fails after 15 seconds. Paste goes through a synthetic event because the app denies the clipboard permission.

The output is `{ scenario, home, repo, steps: [{ step, ok, value?, error?, output?, tree? }], consoleErrors, screenshots, leftover? }`. When arguments, the build or the launch fail, `steps` holds one entry named `arguments`, `build` or `launch`, and a failed launch adds the app's last output and the window tree when one exists. `home` and `repo` are `null` until the temp folder exists. A failed close adds a `close` entry, and `leftover` names a temp folder that could not be deleted. The exit code is 1 when any step failed or something was left over. It does not count `consoleErrors`, so read them.

## Scenarios

A scenario is `verify/scenarios/<kebab-name>/scenario.json`, checked by `scenarioSchema` in `verify/scenario.ts`.

- `description` says what world it sets up.
- `repo` builds the throwaway repo in order. `{ "write": { "path", "content" } }` writes a file inside it and `{ "git": [args] }` runs the real `git` there, with no system config and a global config naming `Satellite Verify`.
- `home` optionally lists `{ path, content }` files written inside the Satellite home before launch, with the same confinement as the repo's writes, such as a cut off `interface.json`. A scenario seeds `interface.json` with `"theme": "light"` unless its description says otherwise, so its screenshots never depend on the machine's own setting.
- `folders` optionally lists `{ name, steps }`, each built like `repo` in `folders/<name>` beside it, with a kebab-case name. They are the folders a `choose-folder` step can pick.
- `gh` lists canned answers, `{ args, stdout?, stderr?, exitCode? }`. The stand-in answers the first entry whose `args` equal its own exactly.
- `claude` holds the `version` line and a `script` played when the stand-in starts. `{ "print": text }` prints, `{ "wait": ms }` waits, `{ "flood": chars }` prints that many characters as numbered lines as fast as the terminal takes them, then `flood done <lines> lines`, and `{ "child": "ignores-hangup" }` starts a child process that ignores `SIGHUP`. `{ "missing": true }` instead points `SATELLITE_CLAUDE` at a path that does not exist, so the app finds no Claude Code.

## Stand-ins

`verify/stand-ins/gh.ts` and `verify/stand-ins/claude.ts` run with the Node that runs the driver, passed to the app through `SATELLITE_GH` and `SATELLITE_CLAUDE`. They find their scenario through `SATELLITE_VERIFY_SCENARIO`.

- **gh** prints its answer and exits with its code. Without an answer it prints `stand-in gh has no answer for <args>` and exits 1.
- **claude** prints `version` for `--version`. Otherwise it puts stdin in raw mode, so nothing typed after its banner is line edited, plays the script, then echoes every chunk (ESC then CR echoes as a new line) and exits on Ctrl+C or Ctrl+D.

Both append JSON lines to `SATELLITE_VERIFY_LOG`, read back by the `log` step. Events are `start` with `tool`, `pid` and `args`, `input` with `data`, `resize` with `cols` and `rows`, and `child` with the `pid` of a started child. Startup calls such as `gh --version` appear once on the built and packaged targets. The dev target runs React in development mode, whose strict mode runs every effect twice, so count events on a built run.

## Home, output and cleanup

Each run makes `satellite-verify-*` in the system temp folder, its real path, with `home/` as `SATELLITE_HOME`, `repo/`, `folders/`, `stand-ins.jsonl` and `folder-dialog.txt`. `SATELLITE_VERIFY_FOLDER_DIALOG` points the app at that file, so the folder dialog never opens and its trimmed content is the chosen folder, a missing or empty file meaning canceled. The user's own `~/.satellite` is never touched. The app gets the driver's environment without `GIT_*`, `CLAUDECODE`, `CLAUDE_CODE_*`, `NODE_OPTIONS` and `ELECTRON_RUN_AS_NODE`, and the recipe's `git` runs without the inherited `GIT_*` too. The run closes the window, kills the process tree once it exits or after 10 seconds, and deletes the temp folder unless `--keep` is set. SIGINT, SIGTERM and SIGHUP, plus SIGBREAK on Windows, stop the build or the app and delete the temp folder the same way. Any other exit of the driver, an uncaught error included, kills every app it started, and the app quits by itself within a second of the driver's process going away, so even a `SIGKILL` leaves no app behind.

Never leave an app running. A script over the driver closes its session in a `finally`, and after a batch of runs no process from this repo's `node_modules/electron` may remain.

On macOS a run is quiet by default. The app takes no Dock icon, never comes to the front and keeps its window unshown while it still renders, and the driver emulates focus, so every step proves the same things without taking the user's screen. Set `SATELLITE_VERIFY_FOREGROUND=1` to watch a run in a normal window. The release workflow sets it, and Windows and Linux always show the window. A quiet window is not clamped by the display, so it keeps the 1440 by 900 the app opens at. Screenshots land in `verify-output/<scenario>-<timestamp>/`, which Git ignores.

## Real Claude Code

`--real-claude` leaves `SATELLITE_CLAUDE` out, so the app runs the user's own Claude Code, which updates its own state in the user's home. Ask the user every time before using it, and only in a throwaway scenario repo.

## In code

`verify/driver.ts` exports `launchApp({ scenario, target, realClaude?, keep? })`, which returns an `AppSession` with the Playwright `page`, `home`, `repo`, `consoleErrors`, `standInEvents()`, `screenshot(name)`, `folder(name)`, the path of `folders/<name>`, `gitEnv`, the clean git environment the recipe runs with, `answerFolderDialog(path | undefined)`, `dropFolder(path)`, which drops a path like the `drop` step, `relaunch()` and `close()`, which answers `{ exitedOnItsOwn, leftover? }`, where `exitedOnItsOwn` says the app quit within 10 seconds of its window closing, before any kill. `relaunch()` closes the app and launches it again in the same temp folder, after which `page` answers the new page, so a wrapper forwards `page` with a getter rather than copying it. A second `close()` answers the first one's result. A failed launch throws `LaunchFailure` carrying `output`, `consoleErrors`, `tree`, `home` and `repo`. It also exports `buildApp()`, `readTree(page)`, `withTimeout`, `errorReason`, `outputDir`, `isProcessAlive(pid)`, which counts a process it may not signal as alive, `pasteIntoFocus(page, text)` and `generatedText(size)`, the text `paste-size` sends. Journeys use it directly.

## Journeys

Journeys are fixed scripts over the driver that prove the first run, the security boundary, projects and quitting. They run against the built app here and against each packaged app in the release workflow.

```sh
npm run --silent journeys -- [--app <executable>]
```

To prove a packaged app on macOS, run `npm run build`, then `npx electron-builder --mac --arm64 --publish never`, then the journeys with `--app release/mac-arm64/Satellite.app/Contents/MacOS/Satellite`. Windows and Linux are proven by pushing the branch as `platforms/<slug>`, which runs the release workflow without publishing.

It builds once for the built target, runs every journey in order, each in a fresh launch of its scenario, and prints `pass <name>` or `fail <name> <reason>`, the reason cut to its first line, each followed by its screenshot paths. A failing journey saves `<name>-failure` when the window is still open. The exit code is 1 when any journey failed or left its temp folder behind.

| Journey | Scenario | Proves |
| --- | --- | --- |
| `launch` | `default` | three columns, the first run check reading the git version and the gh account, the working repo added through the folder dialog, Claude Code starting, typing, Shift+Enter and a 100000 character paste arriving whole and in order, a resize that changes the rows reaching the stand-in, the diff's two sides, a reload ending the first stand-in, a quit ending the app and the second stand-in, and no console errors |
| `boundary` | `default` | no Node in the window, `window.satellite` holding only `invoke`, `onEvent` and `pathForFile`, `pathForFile` answering an empty string for a made-up file and for text, `projects.drop` refusing a relative path and adding nothing, the content security policy refusing an inline script, a `data:` fetch, a remote fetch, image and frame, microphone, camera and notifications reading denied, no path escaping the `app://` root, the bridge refusing a bad payload and an unknown channel, no new window or navigation reaching a remote address, and Claude Code still running and echoing after those refused navigations |
| `projects` | `two-projects` | a plain folder refused with its sentence, alpha added with `ControlOrMeta+O` and beta by a drop, a second add of alpha refused, the left column widened from the keyboard, the switcher selecting alpha, a branch switched outside Satellite shown on focus, the projects, the selection and the width restored after a restart, alpha removed from the command menu with its folder byte for byte unchanged, beta without its `.git` shown as no longer a repository and found again once `.git` is back, beta moved away shown as missing and removed, and no console errors |
| `quit` | `flood` | quitting mid flood ends the stand-in and its child that ignores hangup |

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
