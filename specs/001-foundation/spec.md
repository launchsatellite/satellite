# 001 Foundation

Status **Done** · Depends on **none**

## Why

Nothing can be built or proven until the app starts, the checks run and an agent can drive the real window. This spec chooses the stack, lays out the repo and proves the two riskiest parts first, the real Claude Code in the terminal component and a diff in the editor component.

## Scope

- An Electron app in TypeScript and React that opens one window with the three columns from `SATELLITE.md`, holding a tool readout, a Claude Code pane and a sample diff that prove the bridge, the terminal and the diff end to end.
- A background process with full access and an interface with none, joined by one typed bridge whose every message is validated with a schema.
- Electron hardened for local content only. Sandbox and context isolation on, no Node in the interface, a strict content security policy, navigation and new windows refused, permission requests refused, a menu built from roles with no links, and one instance per Satellite home.
- The terminal component running the user's own `claude`, with Shift+Enter, paste, resize, output flow control, and every process it started ended on reload and quit.
- The editor component showing a read-only side by side diff.
- One module that finds and runs `git`, `gh` and `claude` with argument arrays, and the only place that knows about shells, paths and platform differences.
- Design tokens from `DESIGN.md` as variables, light and dark, with the four typefaces bundled so the app never loads anything remote.
- `./scripts/check` runs format, lint, typecheck and unit tests. Lint refuses comments, default exports and files that are not kebab-case.
- CI runs `./scripts/check` on one Linux runner for every pull request and every push to `main`.
- A release workflow, started by a version tag, by hand or by a push to a `platforms/` branch, that packages for macOS, Windows and Linux, reads the fuses, runs the journeys against each packaged app and writes checksums. Only a pushed tag drafts a release, and only when all three pass.
- The verify harness. A scenario is a folder holding a recipe for a throwaway repo, canned `gh` answers and a script for a stand-in `claude`. One driver command launches the app in a scenario with a temporary home folder and lets an agent click, type, read the window as structured data and take screenshots. Three journeys, `launch`, `boundary` and `quit`, prove the first run, the security boundary and process cleanup.
- Skill `satellite-stack` for how the code is organised and run, and skill `satellite-verify` for the driver, the scenarios and the feature map.
- `ARCHITECTURE.md` with the parts, the security boundary, the bridge, the platform module, the terminal, the diff, packaging and fuses, the folder layout and the decisions.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Stand-in executables for `gh` and `claude`, real `git` | Mocks inside the app | The app keeps no test code, and every scenario exercises the real process and parsing paths. |
| One harness for agent verification and the release journeys | A separate end to end test suite | One thing to maintain, and scenarios written for a feature become its cross-platform proof. |
| Full platform matrix only at release, by hand or from a `platforms/` branch | The matrix on every pull request | Pull requests stay fast and cheap, and a manual run or a `platforms/` branch catches drift before release day. |
| Builds with checksums and no paid signature, macOS ad-hoc signed | Signing with certificates | No remote content is loaded and no credentials are held, so nothing depends on it. An arm64 Mac refuses a modified binary with no signature at all, so macOS gets an ad-hoc one. |

## Not in scope

Projects, workspaces, sessions and every view. Each has its own spec.

## Acceptance

- [x] `npm run dev` opens the window with three columns in light and dark. Proof, a screenshot of each from the driver.
- [x] The real `claude` starts in the terminal component, shows its prompt, accepts typing, Shift+Enter, paste and resize. Proof, a run in the real app on macOS with screenshots.
- [x] A read-only diff of two texts renders side by side. Proof, a screenshot from the driver.
- [x] A bridge message with a wrong shape is refused before any handler runs. Proof, a unit test.
- [x] The interface cannot navigate, open a window or reach Node. Proof, a journey that tries each.
- [x] `./scripts/check` is green locally and in CI.
- [x] The release workflow, started by hand or from a `platforms/` branch, packages all three platforms and passes every journey on each. Proof, [the run](https://github.com/launchsatellite/satellite/actions/runs/44702636638).
- [x] The driver launches a scenario, returns the window as structured data and saves a screenshot. Proof, its output.
