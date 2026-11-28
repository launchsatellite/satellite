# 004 Claude Code sessions

Status **In progress** · Depends on **003**

## Why

The agent pane is the reason Satellite exists. It runs the user's real Claude Code in each workspace, keeps every session alive while the user looks elsewhere, and knows whether each one is working, needs the user or is done.

## Scope

- The right column runs the user's installed `claude` in the selected workspace's folder, in a terminal Satellite owns. Sign-in, settings, hooks, skills and MCP servers are the user's own, untouched.
- Several sessions per workspace as tabs, with a button and a command to start one and to close one.
- Sessions keep running when another workspace is selected, and switching back shows them exactly as they were.
- Each session is launched with a session id Satellite chooses and with status hooks for that process only, in a short-lived settings file in the Satellite home passed with `--settings`. The hooks post to a listener on the loopback address with a secret made for that launch. Nothing is written to the user's Claude Code settings or the repo.
- Status per session, idle until its first request, then working, needs you or done, and stopped once Claude Code ends. A workspace shows the most urgent status of its sessions as one pixel in the sidebar.
- After a restart Satellite picks up where it was. Opening a workspace, by the sidebar, an inbox row or a notification, resumes the conversation it was last prompted in by itself, following the id Claude Code's hooks carry. The workspace selected at launch counts as opened, so it resumes at once, and every other workspace waits until it is opened. Each start runs the session start hooks of a repository the user trusted.
- A workspace resumes by itself at most once per load of the window, when it has a recorded conversation no terminal of Satellite's holds and has had no session tab in this load. Never while the first-run guide or the tool check is open, never once Claude Code was found missing or too old, and never in a workspace whose folder is missing. At the terminal limit it shows the limit sentence and keeps its try for the next time it is opened with room. It leaves keyboard focus where it was and raises no needs you and no notification.
- The guard sees only Satellite's own terminals. A `claude` the user runs elsewhere on the same conversation is invisible to it, as it is to Resume session.
- Closing a workspace's last tab, resumed or fresh, or a resume that fails leaves the offer to resume or start a new session, and nothing starts again by itself. Older conversations stay reachable through Claude Code's own `/resume` picker.
- Quitting or closing the window asks first while a session is working or needs you, while a session's hooks are off so its status can't be seen, or while Running processes lists a process Claude Code started, and whenever that list can't be read within 2 seconds. The question names what stops, with counts. Otherwise idle and done sessions end quietly, and each workspace comes back to the conversation it was last prompted in.
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
| A once per load rule kept in the interface, on top of the background process's start checks | A separate automatic start request | An automatic start is the same request as the button, which the background process already bounds to a recorded conversation none of its terminals holds, so a second request would only widen the bridge. |
| Asking at quit only while work would be lost, a session mid-task, a session whose status can't be seen or a process Claude Code started | Asking for every running session | With idle sessions resuming by themselves, a question on every quit would be noise, while unfinished work and background processes still deserve one. |
| Counting processes from what Running processes already lists, within 2 seconds, and asking when that runs out | A second way to find a session's processes, or waiting on a slow process table | One source of truth, and a quit never hangs while a doubt still asks. |

## Not in scope

The inbox and notifications belong to spec 005.

## Acceptance

- [x] The real `claude` runs in a workspace, answers a prompt and shows working then done in the sidebar. Proof, a run in the real app on macOS.
- [x] A permission request turns the pixel to needs you and approving it turns it back. Proof, scenario `needs-permission`.
- [x] Hook events map to the right status in every order they can arrive. Proof, unit tests on the status machine.
- [x] A hook request without the secret is refused. Proof, a unit test.
- [x] Two sessions in two workspaces run at once and each keeps its own screen. Proof, a journey.
- [x] A workspace that does not resume by itself offers to, and the resumed session shows its history. Proof, a run in the real app and journey `sessions`.
- [x] After a relaunch the selected workspace resumes with no click, the stand-in gets `--resume` with the recorded id, and the pixel stays idle with no notification. Proof, journey `sessions`.
- [x] A second workspace starts nothing until it is selected, then resumes once, with focus left on its row, after a switch away and back while its first answer was still on its way. Two resumes of one conversation asked at once start one process. Proof, journey `sessions` for the single resume once selected and the two asked at once.
- [x] Closing the resumed tab brings nothing back, closing a fresh session's last tab offers to resume and starts nothing, and a resume that fails shows its sentence and never retries. Proof, journey `sessions`.
- [x] Quitting with only idle sessions asks nothing, with a working session asks and counts it, and with a done session whose dev server runs asks and counts the process. Proof, journey `quit` on macOS and Linux, since it quits through `SIGTERM`, and unit tests on the rule.
- [ ] The same quit rule reaches the question through the window's close button on Windows. Proof, a run on Windows.
- [x] Send to Claude Code places the text in the prompt and does not submit it. Proof, the driver.
- [x] With `claude` missing the pane says so and names the fix. Proof, scenario `claude-missing`.
- [x] The user's Claude Code settings files are byte for byte unchanged after a session. Proof, a journey that compares them.

## Next

- Sessions move to the centre of the window, in one tab strip that also holds files and diffs opened from the rail. Part of [015 Layout](../015-layout/spec.md).
- A session started from the New workspace page receives the typed request as its first message, sent through its terminal once Claude Code is ready, never as a launch argument.
- In the repo view a workspace's selected session shows as a tile, and only tiles on screen draw a terminal.
