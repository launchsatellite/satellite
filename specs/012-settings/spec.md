# 012 Settings

Status **In progress** · Depends on **002, 005, 010, 011**

## Why

The theme and notifications change only through commands nobody discovers, and nothing shows what is chosen right now. People look for settings at the top right of the window and under the standard shortcut, and find nothing. Once settings exists, every choice Satellite already offers, and the state behind it, sits in one place a click or a key away.

## Scope

- A Settings dialog built from the kit's dialog, one column of sections with lowercase headlines, scrolling inside its body when the window is short. Every change applies at once and is saved the way it is saved today, in `interface.json`, with no Save button. Done closes it.
- **appearance.** The theme as one choice, System, Light, Dark or a curated theme (spec 013), showing the current one.
- **notifications.** On or Off as one segmented choice showing the current one, with one sentence saying they only come when a workspace needs you and that the system's own notification settings for Satellite still decide whether they show.
- **tools.** The first-run check of git, the GitHub CLI and Claude Code, each with its found version or its problem and the existing fix text, the ready count and Check again, the same rows and the same `tools.check` channel the check card uses.
- **guide.** Show the guide, which closes Settings and starts the guide as the command does, unavailable with a sentence until a project is added.
- **keyboard shortcuts.** A read-only list of every command that has a shortcut, read from the command registry, with each key drawn for this system.
- **about.** Satellite and its version, the MIT licence, where the third-party notices ship, and Open the repository and Read the security policy, each opening through the link dialog that confirms and checks the address.
- Entry points. A settings icon button at the right end of the title bar with its tooltip and accessible name, the command Open settings in the command menu, Cmd+Comma on macOS and Ctrl+Comma on Windows and Linux, and on macOS the app menu's Settings… item between About and Hide, which shows ⌘, and asks the page to open it.
- The theme and notification commands stay, and the dialog and the commands read and write the same state, so each shows what the other chose.
- Focus moves into the dialog on open and returns to where it was on close. Escape and a click outside close it. While it is open every command is unavailable, the title bar stops being a drag area and the guide card steps aside, as with the other dialogs.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| A dialog over the window | A settings window, a full page in the centre column | Six short sections fit one scrolling column, the window stays one window, and the kit's dialog already owns focus, Escape and the scrim. |
| Ctrl+Comma on Windows and Linux, Cmd+Comma on macOS | Ctrl+Shift+Comma like every other command | Ctrl+Comma is the standard there, the Linux desktop guidelines name it for preferences, and the terminal has no code for it, so it never reaches Claude Code and taking it costs nothing. |
| The version built into the page from `package.json` | A new bridge channel that answers the version | The packaged app takes its version from the same file, and a constant gives a hostile page nothing new. |
| The Settings… item in the macOS app menu shows ⌘, but leaves the key to the page, and a click sends the `window.settings` event | A menu accelerator that catches the key | The page's shortcut matcher stays the one place keys run commands, so the key behaves the same on every system and in every quiet run. |
| On or Off for notifications, plus a sentence about the system | The system's own permission state | Electron reads no notification permission on macOS, so showing it would need a new capability that still could not be honest. |
| The tool check rows shared by the card and the dialog | A second check view | One component and one channel, so the two never disagree. |

## Not in scope

The column widths and the hidden sidebar, which the window and the title bar already own. The system's notification permission. A way to open the third-party notices file, which the app does not carry inside its archive. Settings for Claude Code, which are the user's own.

## Acceptance

A Satellite feature is accepted on macOS, Windows and Linux.

- [x] The title bar button, the command and the shortcut open Settings, Escape closes it and focus returns to where it was. Proof, journey `settings` for the shortcut and Escape.
- [x] Each section shows its current value, the theme and notifications change at once, survive a relaunch and stay in step with their commands. Proof, journey `settings`, which reads the theme and notifications shown, Dracula taking the window at once, both saved and both kept after a relaunch.
- [x] The tools section shows each tool's version, and Check again checks again. Proof, journey `settings`, which reads git's and Claude Code's versions and the gh account, and sees Check again run gh again.
- [x] The shortcut list holds exactly the commands with a shortcut, with the keys for this system.
- [x] About opens the repository and the security policy only through the link dialog. Proof, journey `settings` for the security policy.
- [x] Settings holds inside the window at 960 by 600 in light and dark, and its button stays inside the title bar area.
- [x] Ctrl+Comma without Shift and the comma's physical key on another layout match on Windows and Linux. Proof, `src/renderer/commands/shortcuts.test.ts`.
- [ ] The macOS app menu's Settings… item opens Settings, and the button sits clear of the window controls on Windows and Linux. Proof, a person on each system, since a quiet window shows no menu or frame.
