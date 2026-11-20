# 005 Inbox and notifications

Status **Approved** · Depends on **004**

## Why

With agents in many workspaces, the cost is not knowing which one is blocked. The inbox puts every workspace that needs the user in one list, and a notification reaches them when the window is not in front.

## Scope

- Inbox at the top of the sidebar with a count. It lists every workspace that needs the user across all projects, most recent first, each with one sentence saying why.
- Selecting an inbox row opens that workspace on the thing that needs attention.
- A workspace leaves the inbox by itself when the reason is gone.
- A system notification when a workspace starts needing the user while the window is not focused. Clicking it opens that workspace.
- The app icon carries the inbox count where the system supports it.
- One setting turns notifications off.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Notifications only for needs you | Notifications when work finishes | Signal stays rare, so it always means the user is the blocker. |

## Not in scope

Reasons that come from pull requests arrive with spec 008 and use this inbox.

## Acceptance

- [ ] A session asking for permission in a workspace that is not selected appears in the inbox with its reason. Proof, scenario `needs-permission`.
- [ ] Answering the session removes the row. Proof, the same scenario.
- [ ] With the window unfocused, needing the user raises one notification, and not a second one for the same reason. Proof, a journey with a recording notifier.
- [ ] With notifications off, none is raised and the inbox still fills. Proof, the driver.
