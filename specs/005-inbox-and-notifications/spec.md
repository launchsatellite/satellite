# 005 Inbox and notifications

Status **Done** · Depends on **004**

## Why

With agents in many workspaces, the cost is not knowing which one is blocked. The inbox puts every workspace that needs the user in one list, and a notification reaches them when the window is not in front.

## Scope

- Inbox at the top of the sidebar, under the command rows and above the projects, with a count. It lists every workspace with a session that needs the user across all projects, newest first by when the workspace started needing them, each with one sentence saying why. Two projects whose names read the same once cleaned show their parent folder. The user's home folder reads your home folder, as a project or as a parent, so no account name shows.
- Selecting an inbox row, or the command Go to the newest workspace that needs you, opens that workspace on the session that has waited longest and puts focus in its terminal without typing anything. The terminal drops a key held from before it took focus until the next fresh press.
- Go to what needs you, on Cmd+J or Ctrl+Shift+J on Windows and Linux, works from anywhere and opens the next workspace in the inbox order after the selected one the way its row does, wrapping to the top after the last.
- A workspace leaves the inbox by itself when no session there needs the user. Nothing about the inbox is stored.
- A system notification when a workspace starts needing the user while the window is hidden, minimised or not focused. One per workspace entering the inbox, at most one every 5 seconds, and the workspaces that enter in between gathered into one that counts every workspace waiting. A notification names one workspace only when no other waits, so it always states everything waiting. Its words are Satellite's own with the cleaned workspace and project names, never anything a session said or ran. Clicking it brings the window forward and opens the workspace a single notification named while it still needs the user, otherwise the newest that does.
- The app icon carries the inbox count on macOS and on Linux launchers that support it. Windows shows no count.
- One setting turns notifications off, `notifications` in `interface.json`, flipped by Turn notifications off and Turn notifications on in the command menu. The inbox and the count keep working while it is off.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Notifications only for needs you | Notifications when work finishes | Signal stays rare, so it always means the user is the blocker. |
| The inbox in the sidebar | A view in the centre column | The centre column belongs to the repository, and the inbox stays in sight whatever is selected. |
| The inbox derived from session statuses in both processes | A stored inbox | Every reason ends with its session and every session ends with its page load, so nothing is worth keeping. |
| One notification per workspace entering the inbox, at most one every 5 seconds, a burst gathered into one | One per session or per request | A burst across many workspaces never floods the system. A need may be announced up to 5 seconds late. |
| Satellite's own words and cleaned names in a notification | What the session asked | Notifications show on lock screens and stay in the system's history, and some systems read markup in the body. |
| The switch stops notifications only | Turning off the count too | The count is the inbox's size. A silent app icon is the system's per-app setting. |
| A setting in `interface.json` with two commands, shown in Settings | A store of its own | The theme is chosen the same way, and Settings (spec 012) draws the same state. |

## Not in scope

Reasons that come from pull requests arrive with spec 008 and use this inbox.

## Acceptance

- [x] A session asking for permission in a workspace that is not selected appears in the inbox with its reason. Proof, the `inbox` journey, which lists alpha asking while beta is selected, and `src/renderer/inbox/inbox.test.ts` on the reason's sentence.
- [x] Answering the session removes the row. Proof, the same journey.
- [x] With the window unfocused, needing the user raises one notification, and not a second one for the same reason. Proof, the `inbox` journey with the recording notifier, and the controller's unit tests.
- [x] Cmd+J, or Ctrl+Shift+J on Windows and Linux, opens alpha from beta on the session that needs you with focus in its terminal. Proof, the `inbox` journey, and `src/renderer/inbox/inbox.test.ts` on the order and the wrap.
- [x] With notifications off, none is raised and the inbox still fills. Proof, the driver with the recording notifier, and `src/main/inbox/notices.test.ts`.

## Next

- The inbox becomes the Needs you group at the top of the sidebar, with the same rows, order and rules. Part of [015 Layout](../015-layout/spec.md).
- A needs you that arrives while a page covers the sidebar shows as a toast.
