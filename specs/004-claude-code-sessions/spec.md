# 004 Claude Code sessions

Status **In progress** · Depends on **003**

## Why

The agent pane is the reason Satellite exists. It runs the user's real Claude Code in each workspace, keeps every session alive while the user looks elsewhere, and knows whether each one is working, needs the user or is done.

## Scope

- The right column runs the user's installed `claude` in the selected workspace's folder, in a terminal Satellite owns. Sign-in, settings, hooks, skills and MCP servers are the user's own, untouched.
- Several sessions per workspace as tabs, with a button and a command to start one and to close one.
- Sessions keep running when another workspace is selected, and switching back shows them exactly as they were.
- Each session is launched with a session id Satellite chooses and with status hooks passed for that process only. The hooks post to a listener on the loopback address, protected by a secret made at start. Nothing is written to the user's settings or the repo.
- Status per session, working, needs you, done or stopped. A workspace shows the most urgent status of its sessions as one pixel in the sidebar.
- After a restart each workspace offers to resume its last session.
- Send to Claude Code. A command that types a prepared request into the selected session's prompt as plain text and never submits it. Control characters are stripped, and the request holds at most 800 characters, the most Claude Code shows before folding a paste into a placeholder.
- Terminal behaviour matches what Claude Code expects. Shift+Enter, image paste, dropped files as paths, links that open in the system browser after a check, colours that follow the theme, and scrollback with a limit.
- The moments around Claude Code are drawn by Satellite. Not installed, session ended, stopped unexpectedly.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Hooks over loopback HTTP with a per run secret | A helper script per hook | No shell differences between platforms and no file to install. |
| Typing into the prompt without submitting | Submitting for the user | The user always reads what is sent in their name. |

## Not in scope

The inbox and notifications belong to spec 005.

## Acceptance

- [ ] The real `claude` runs in a workspace, answers a prompt and shows working then done in the sidebar. Proof, a run in the real app on macOS.
- [ ] A permission request turns the pixel to needs you and approving it turns it back. Proof, scenario `needs-permission`.
- [ ] Hook events map to the right status in every order they can arrive. Proof, unit tests on the status machine.
- [ ] A hook request without the secret is refused. Proof, a unit test.
- [ ] Two sessions in two workspaces run at once and each keeps its own screen. Proof, a journey.
- [ ] After a restart the workspace offers to resume and the resumed session shows its history. Proof, a run in the real app.
- [ ] Send to Claude Code places the text in the prompt and does not submit it. Proof, the driver.
- [ ] With `claude` missing the pane says so and names the fix. Proof, scenario `claude-missing`.
- [ ] The user's Claude Code settings files are byte for byte unchanged after a session. Proof, a journey that compares them.
