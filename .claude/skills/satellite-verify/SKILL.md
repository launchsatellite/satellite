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
| `--app <executable>` | packaged | a packaged app from `release/`, nothing is built |

Every target runs with the scenario's throwaway repo as its working folder, so a terminal the app opens starts inside it.

## Steps

Steps run in order. The first failure stops the run, and its entry carries `error` plus `tree`, the window at that moment.

| Step | Does | Value |
| --- | --- | --- |
| `tree` | reads the window | `aria`, the accessibility snapshot of the body, and `testIds`, each `{ testId, visible, text }` with text cut at 2000 characters |
| `text=<testid>` | reads one element's text | the text, cut at 2000 characters |
| `click=<testid>` | clicks an element | |
| `type=<text>` | types into the focused element | |
| `press=<key>` | presses a key, such as `Enter`, `Shift+Enter` or `Control+C` | |
| `paste=<text>` | dispatches a paste event with the text on the focused element | |
| `paste-size=<n>` | pastes `n` generated characters, `abc…xyz0…9` repeated, up to 1000000 | |
| `resize=<width>x<height>` | sets the viewport size | |
| `theme=light` or `theme=dark` | emulates the system color scheme | |
| `wait=<ms>` | waits, up to 60000 | |
| `wait-for=<testid>` | waits up to 60 seconds for an element to be visible | |
| `shot=<name>` | saves a screenshot, the name in kebab-case | its path |
| `log` | reads what the stand-ins recorded | the events |

Other steps time out after 15 seconds. Paste goes through a synthetic event because the app denies the clipboard permission.

The output is `{ scenario, home, repo, steps: [{ step, ok, value?, error?, tree? }], consoleErrors, screenshots }`, and the exit code is 1 when any step failed. When arguments, the build or the launch fail, `steps` holds one entry named `arguments`, `build` or `launch` with the reason and the app's last output.

## Scenarios

A scenario is `verify/scenarios/<kebab-name>/scenario.json`, checked by `scenarioSchema` in `verify/scenario.ts`.

- `description` says what world it sets up.
- `repo` builds the throwaway repo in order. `{ "write": { "path", "content" } }` writes a file inside it and `{ "git": [args] }` runs the real `git` there, with no system config and a global config naming `Satellite Verify`.
- `gh` lists canned answers, `{ args, stdout?, stderr?, exitCode? }`. The stand-in answers the first entry whose `args` equal its own exactly.
- `claude` holds the `version` line and a `script` of `{ "print": text }` and `{ "wait": ms }` steps, played when the stand-in starts.

## Stand-ins

`verify/stand-ins/gh.ts` and `verify/stand-ins/claude.ts` run with the Node that runs the driver, passed to the app through `SATELLITE_GH` and `SATELLITE_CLAUDE`. They find their scenario through `SATELLITE_VERIFY_SCENARIO`.

- **gh** prints its answer and exits with its code. Without an answer it prints `stand-in gh has no answer for <args>` and exits 1.
- **claude** prints `version` for `--version`. Otherwise it plays the script, then reads stdin raw, echoes every chunk (ESC then CR echoes as a new line) and exits on Ctrl+C or Ctrl+D.

Both append JSON lines to `SATELLITE_VERIFY_LOG`, read back by the `log` step. Events are `start` with `tool`, `pid` and `args`, `input` with `data`, and `resize` with `cols` and `rows`.

## Home, output and cleanup

Each run makes `satellite-verify-*` in the system temp folder with `home/` as `SATELLITE_HOME`, `repo/` and `stand-ins.jsonl`. The user's own `~/.satellite` is never touched. The run closes the window, kills the process tree after 10 seconds if it is still alive, and deletes the temp folder unless `--keep` is set. Screenshots land in `verify-output/<scenario>-<timestamp>/`, which Git ignores.

## Real Claude Code

`--real-claude` leaves `SATELLITE_CLAUDE` out, so the app runs the user's own Claude Code, which updates its own state in the user's home. Ask the user every time before using it, and only in a throwaway scenario repo.

## In code

`verify/driver.ts` exports `launchApp({ scenario, target, realClaude?, keep? })`, which returns an `AppSession` with the Playwright `page`, `home`, `repo`, `consoleErrors`, `standInEvents()`, `screenshot(name)` and `close()`, plus `buildApp()` and `outputDir`. Journeys use it directly.

## Feature map

| Feature | Scenario | Journey |
| --- | --- | --- |
| 001 Foundation, the window and the tool readout | `default` | none |
