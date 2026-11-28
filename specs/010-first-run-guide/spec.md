# 010 First-run guide

Status **Done** · Depends on **002, 003, 004, 005, 006**

## Why

A new user sees three columns and no agent, and has to guess that a workspace is a worktree, that the terminal is their own Claude Code and that orange means them. The guide shows this once, on the real controls, while they do it.

## Scope

- The guide starts once the first project is added. The welcome screen stays as it is.
- One small card sits beside the control it explains, with a grey ring around that control. Nothing is dimmed, nothing is blocked and the card takes no focus by itself. Show the guide moves focus into the card, the card draws the standard focus ring while it holds keyboard focus, and the card and ring step aside while a dialog or the command menu is open.
- Four steps, each a readout, a lowercase title, one sentence and one action.
  - 01 make a workspace. "A workspace is a git worktree and a branch made in one step, so agents work side by side and never in each other's files."
  - 02 start Claude Code. "This is your own Claude Code in a real terminal, with your settings and skills, and its prompt is the only place you type."
  - 03 read what it did. "Files, Changes and Pull request show the work in this workspace, read only, because your agent does the writing."
  - 04 orange means you. "A square pixel shows the state of each session, and signal orange means one cannot go on without you, so it waits in the inbox." With a legend of idle, working, needs you and done.
- A step leaves when the user does what it describes, or on Next. Step 02 leaves as soon as a session starts. The last step ends on Done. Next is a secondary button, so the real control stays the main action, and Done is primary.
- The close control ends the guide at any step. Escape ends it only while focus is inside the card, so Escape in the terminal still reaches Claude Code.
- After an early close a toast says "The guide is closed. Show the guide in the command menu opens it again." After Done nothing remains.
- Once finished or closed the guide never shows by itself again. The command Show the guide starts it from the first step that still applies.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| A card beside the real control that follows what the user does | A sequence of full-screen slides before the app | People learn the control by using it, and nothing stands between them and their first agent. |
| No scrim and no focus taken | A spotlight that blocks the rest of the window | The app stays usable at every step, and the terminal keeps its keys. |
| Four steps | A step for every pane | The four things nobody guesses. The rest reads by itself. |
| No Back button | Back and Next | Each step is one sentence, and the command starts the guide again. |

## Not in scope

Tips for later features, a help centre, videos, and any tracking of what the user did.

## Acceptance

- [x] After the first project is added the first card appears beside the control that makes a workspace, and never before. Proof, scenario `first-run`.
- [x] Each step leaves when the user does the thing and on Next, and the card sits beside its control without covering it at 960 by 600 and a normal size, light and dark. Proof, the same scenario.
- [x] The card takes no focus by itself, and Escape closes it only while focus is inside it. Proof, the same scenario with a running session.
- [x] An early close shows the toast, Done shows none, and neither shows the guide again after a restart. Proof, the same scenario.
- [x] Show the guide in the command menu starts it again. Proof, the same scenario.

## Next

- The four guide cards point at the controls in their new places, New workspace in the sidebar, Claude Code in the centre, Changes in the rail and the Needs you group. Part of [015 Layout](../015-layout/spec.md).
