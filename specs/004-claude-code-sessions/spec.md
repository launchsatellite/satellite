# 004 Claude Code sessions

Status **Done** · Depends on **003**

## Why

The agent pane is the reason Satellite exists. It runs the user's real Claude Code in each workspace, keeps every session alive while the user looks elsewhere, and knows whether each one is working, needs the user or is done.

## Scope

- The right column runs the user's installed `claude` in the selected workspace's folder, in a terminal Satellite owns. Sign-in, settings, hooks, skills and MCP servers are the user's own, untouched.
- Several sessions per workspace as tabs, with a button and a command to start one and to close one.
- Sessions keep running when another workspace is selected, and switching back shows them exactly as they were.
- Each session is launched with a session id Satellite chooses and with status hooks for that process only, in a short-lived settings file in the Satellite home passed with `--settings`. The hooks post to a listener on the loopback address with a secret made for that launch. Nothing is written to the user's Claude Code settings or the repo.
- Status per session, idle until its first request, then working, needs you or done, and stopped once Claude Code ends. A workspace shows the most urgent status of its sessions as one pixel in the sidebar.
- After a restart Satellite picks up where it was. The workspace selected at launch resumes the conversation it last prompted in by itself, following the id Claude Code's hooks carry, and every other workspace does so the first time it is shown, never all at once.
- A workspace resumes by itself at most once per run, when it has a conversation no running terminal holds and no session tab. Never while the first-run guide or the tool check is open, never once Claude Code was found missing or too old, and never in a workspace whose folder is missing. It leaves keyboard focus where it was and raises no needs you and no notification.
- Closing that tab or a resume that fails leaves the offer to resume or start a new session, and nothing starts again by itself. Older conversations stay reachable through Claude Code's own `/resume` picker.
- Quitting or closing the window asks first only while a session is working or needs you, counting those. Idle and done sessions end quietly, since they resume next time.
- Send to Claude Code. A command that types a prepared request into the selected session's prompt as one line of plain text and never submits it. Line breaks become spaces, control and hidden characters are stripped, and the request holds at most 800 characters, the most Claude Code shows before folding a paste into a placeholder. It works once Claude Code has reported the user's first request in that session, and never while the session needs the user.
- Terminal behaviour matches what Claude Code expects. Shift+Enter, image paste, dropped files as paths, links that always ask before they open in the system browser, colours that follow the theme, and scrollback with a limit.
- The moments around Claude Code are drawn by Satellite. Not installed, session ended, stopped unexpectedly.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Hooks over loopback HTTP with a secret per launch, in a settings file in the Satellite home | A helper script per hook, the hooks inline on the argument list | No shell differences between platforms, nothing installed, and the secret stays out of process listings and the environment. |
| An idle status before the first request, drawn grey | Starting at working or done | A session nobody has prompted is honestly idle. |
| Every link from the terminal asks first, naming the site and the full address | Opening a link whose text matches its address at once | Output can hide part of an address, and what is seen must be what opens. |
| Send waits for the first reported request and strips line breaks | Sending at once, multi-line text | Nothing earlier proves the trust question was answered, and a line break could submit. |
| Typing into the prompt without submitting | Submitting for the user | The user always reads what is sent in their name. |
| Resuming by itself the first time a workspace is shown | Resuming every workspace at launch, or only on a click | A resume costs no model request until the first message, so picking up where it was is cheap, while starting every workspace at once would run each repository's session hooks and fill the terminal limit for conversations nobody opened. |
| A once per run rule kept in the interface, on top of the background process's start checks | A separate automatic start request | An automatic start is the same request as the button, which the background process already bounds to a recorded conversation no terminal holds, so a second request would only widen the bridge. |
| Asking at quit only while a session is working or needs you | Asking for every running session | With idle sessions resuming by themselves, a question on every quit would be noise, while unfinished work still deserves one. |

## Not in scope

The inbox and notifications belong to spec 005.

## Acceptance

- [x] The real `claude` runs in a workspace, answers a prompt and shows working then done in the sidebar. Proof, a run in the real app on macOS.
- [x] A permission request turns the pixel to needs you and approving it turns it back. Proof, scenario `needs-permission`.
- [x] Hook events map to the right status in every order they can arrive. Proof, unit tests on the status machine.
- [x] A hook request without the secret is refused. Proof, a unit test.
- [x] Two sessions in two workspaces run at once and each keeps its own screen. Proof, a journey.
- [x] After a restart the workspace offers to resume and the resumed session shows its history. Proof, a run in the real app.
- [x] After a relaunch the selected workspace resumes with no click, the stand-in gets `--resume` with the recorded id, and the pixel stays idle with no notification. Proof, journey `sessions`.
- [x] A second workspace starts nothing until it is selected, then resumes once, a fast switch away and back included, with focus left on its row. Proof, journey `sessions`.
- [x] Closing the resumed tab brings nothing back, and a resume that fails shows its sentence and never retries. Proof, journey `sessions`.
- [x] Quitting with only idle sessions asks nothing, and with a working session asks and counts it. Proof, journey `quit` on macOS and Linux, since it quits through `SIGTERM`.
- [x] Send to Claude Code places the text in the prompt and does not submit it. Proof, the driver.
- [x] With `claude` missing the pane says so and names the fix. Proof, scenario `claude-missing`.
- [x] The user's Claude Code settings files are byte for byte unchanged after a session. Proof, a journey that compares them.
