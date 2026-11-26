# 001 Foundation

Status **Done** · Depends on **none**

## Why

Nothing can be built or proven until the app starts, the checks run and an agent can drive the real window. This spec chooses the stack, lays out the repo and proves the two riskiest parts first, the real Claude Code in the terminal component and a diff in the editor component.

## Scope

- An Electron app in TypeScript and React that opens one window with the three columns from `SATELLITE.md`, holding a tool readout and a Claude Code pane that prove the bridge and the terminal end to end.
- A background process with full access and an interface with none, joined by one typed bridge whose every message is validated with a schema.
- Electron hardened for local content only. Sandbox and context isolation on, no Node in the interface, a strict content security policy, navigation and new windows refused, permission requests refused, a menu built from roles with no links, and one instance per Satellite home.
- The terminal component running the user's own `claude`, with Shift+Enter, paste, resize, output flow control, and every process it started ended on reload and quit.
- The editor component showing a read-only side by side diff.
- One module that finds and runs `git`, `gh` and `claude` with argument arrays, and the only place that knows about shells, paths and platform differences.
- Design tokens from `DESIGN.md` as variables, light and dark, with the four typefaces bundled so the app never loads anything remote.
- `./scripts/check` runs format, lint, typecheck and unit tests. Lint refuses comments, default exports and files that are not kebab-case.
- CI runs `./scripts/check` on one Linux runner for every pull request and every push to `main`.
- A platforms workflow that packages for macOS, Windows and Linux, reads the fuses and runs the journeys against each packaged app. CI runs it on every pull request and every push to `main` that changes more than docs, with the unpacked app only, the smoke journeys for a pull request and every journey for `main`.
- A release workflow, started by a version tag or by hand, that runs the platforms workflow with every installer and writes checksums. Only a pushed tag drafts a release, and only when all three pass.
- The verify harness. A scenario is a folder holding a recipe for a throwaway repo, canned `gh` answers and a script for a stand-in `claude`. One driver command launches the app in a scenario with a temporary home folder and lets an agent click, type, read the window as structured data and take screenshots. Three journeys, `launch`, `boundary` and `quit`, prove the first run, the security boundary and process cleanup.
- Skill `satellite-stack` for how the code is organised and run, and skill `satellite-verify` for the driver, the scenarios and the feature map.
- `ARCHITECTURE.md` with the parts, the security boundary, the bridge, the platform module, the terminal, the diff, packaging and fuses, the folder layout and the decisions.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Stand-in executables for `gh` and `claude`, real `git` | Mocks inside the app | The app keeps no test code, and every scenario exercises the real process and parsing paths. |
| One harness for agent verification and the release journeys | A separate end to end test suite | One thing to maintain, and scenarios written for a feature become its cross-platform proof. |
| The platform matrix on every pull request that changes more than docs, packaging only the unpacked app and running the smoke journeys, with every journey on `main` | Every journey on every pull request, or the full matrix only at release | A pull request waits minutes and still proves that each system's packaged app starts, keeps its boundary and quits clean. The longer flows run right after the merge, where a failure is looked at without holding anyone. Docs-only changes skip it, since they cannot change the app. |
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
- [x] The release workflow packages all three platforms and passes every journey on each. Proof, [the run](https://github.com/launchsatellite/satellite/actions/runs/44702636638).
- [x] The driver launches a scenario, returns the window as structured data and saves a screenshot. Proof, its output.
