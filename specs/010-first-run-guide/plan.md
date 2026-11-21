# First-run guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once the first project is added, one small card sits beside the real control it explains, with a grey ring around that control and a three-pixel tail. Four steps, make a workspace, start Claude Code, read what it did, orange means you. A step leaves when the user does the thing or presses Next, the last one ends on Done. Nothing is dimmed, nothing is blocked and the card never takes focus by itself. The close control, or Escape while focus is in the card, ends it with one toast. Once finished or closed it never shows by itself again, and the command Show the guide starts it from the first step that still applies.

**Architecture:** Everything lives in the interface, in a new folder `src/renderer/guide/`. A pure step function decides which step shows from two facts the window already holds, whether any workspace exists and whether any session tab is open. A pure placement function turns the box of the real control, the size of the card and the size of the window into the ring, the card position and the tail. One layer, mounted first in the window, finds the control by a `data-guide` attribute, measures it every animation frame while the guide is open and draws the ring and the card with `position: fixed`, so nothing in the app's layout moves. Whether the guide was seen is one boolean, `guideSeen`, in `interface.json`, raised to version 4 and saved through the existing `interface.save`. No new bridge channel, no new event, no new state file, no new dependency, nothing recorded about what the user did and nothing sent anywhere.

**Tech Stack:** Electron 45.3.4, React 19.3.1, TypeScript 6.0.3, zod 4.6.7, Tailwind 4.3.5, Vitest 5.1.0, playwright-core 1.65.1, vite 8.3.8, Node 24 (`.nvmrc`), all read from `package.json`. No new dependency of any kind.

**Spec:** `specs/010-first-run-guide/spec.md`. The mock is `BRAND.html`, chapter Product, the frames captioned First run · Guide, and it is the visual authority. `DESIGN.md` is the rule book. The frame captioned two roads not taken is not built.

## What this writes and where

- `interface.json` in the Satellite home gains `guideSeen` and becomes version 4 (Task 1). No other state file changes.
- Nothing in any repository, nothing outside the Satellite home, no cache, no log of steps, no network.

## Rulings checked

Each was checked while planning, against the code, the rendered mock or current documentation.

- **The mock, measured.** The fourteen guide frames were rendered headless at 1280 by 640 and read with `getBoundingClientRect`. Step 01, the control 24 by 24 at 210, 164 and the card at 266, 148. Step 02, the control at 1023, 323 and the card's right edge at 991. Step 03, the tabs 195 by 26 at 259, 52 and the card at 329, 110. Step 04, the inbox band 231 by 28 at 9, 75 under a 34 pixel header row at 9, 67, and the card at 272, 61. In every frame the ring is the control's box grown by 4, the card is 32 from the control's edge, 28 from the ring, and the tail's middle is 28 from the card's corner on the middle of the control. The card is 300 wide, 198 tall with a three line sentence and 268 with the legend. Dark and light measure the same.
- **No fallback side is needed.** `src/main/window/main-window.ts` sets `minWidth: 960` and `minHeight: 600`, and `interfaceLimits` keeps the sidebar at 200 to 360, the session column at 360 to 640 and the centre at 400 or more. No column collapses. With those bounds each card fits on its own side at every size the window can take (the table in Exact values gives the numbers), so the rule has one side per step and only clamps along the control.
- **Announcing without focus.** WCAG 2.2 success criterion 4.1.3, Status Messages, asks that a message which is not a change of context can be presented by assistive technology without receiving focus, and names technique ARIA22, `role="status"`. MDN's `status` role page says the role carries an implicit `aria-live="polite"` and `aria-atomic="true"` and that focus must not move to it when its content updates. The repo already speaks this way, `InboxList` and `EmptyWorkspace` hold `role="status"` elements. So one `role="status"` region that is mounted before any text arrives carries each step.
- **The card's role.** The WAI-ARIA Authoring Practices describe the dialog pattern for modal dialogs only, with `aria-modal` set only when the rest is blocked and obscured, which the guide never does. Four places in the code read `[role='dialog']` as the modal kit dialog (`dialog.tsx`, `processes-dialog.tsx`, `archive-dialog.tsx`, `send-to-claude-code.ts`). So the card is a `role="group"` named by its title and described by its sentence, with named controls, and Escape closes it only from inside, which is the dialog pattern's one key.
- **Positioning.** CSS anchor positioning ties a box to an anchor with no script and follows scroll, and Electron 45 has it. It cannot clamp the card 8 pixels inside the window and tell the tail where the clamp put it, the inbox ring is a band derived from a header and not an element's own box, and a journey must read the numbers anyway. So the layer measures with `getBoundingClientRect`, which is what `column-divider.tsx` and the diff already do, and the rule is one pure function with tests. A frame loop while the guide is open replaces a resize observer, a capture scroll listener and a mutation observer together, since the Start Claude Code button appears from a child's own state that no window render reports.
- **The state file.** `interfaceState` is a strict schema and the file's `version` is a literal, so a new field is a new version, 4, exactly as tabs made version 3. An older build sets a version 4 file aside and starts with the default layout, which is what the last two raises cost. A separate file would need a new bridge channel, which is a security decision for one boolean.
- **Existing scenarios stay quiet for free.** All 22 scenarios in `verify/scenarios/` seed an `interface.json` at version 1. A file older than version 4 reads as guide seen (Open calls), so no existing scenario or journey ever shows the guide, with no switch in the product.
- **Who else pins the version.** `src/main/state/interface-file.test.ts` expects version 3 and the default state after a failed read, and `verify/journeys/inbox.ts` parses the saved file with `z.literal(3)`. `verify/journeys/projects.ts` counts the command menu with `menuCommands = 15`. Tasks 1 and 3 move them.
- **Focus and Escape today.** No global Escape listener exists. The kit dialog listens only while it is open, the palette on its own input and the terminal inside xterm. A key handler on the card alone therefore sees Escape only while focus is in the card. The kit dialog marks every sibling in the window `inert` while it is open, and the palette covers the window at `z-50`.

## Open calls decided here

| Decision | Why | Cost if wrong |
| --- | --- | --- |
| `guideSeen`, one boolean in `interface.json`, version 4 | The file exists, is validated at the boundary and written atomically, and no new channel is needed | An older build sets a version 4 file aside and starts with the default layout |
| A version 1, 2 or 3 file reads as `guideSeen: true` | Whoever has a saved layout has used Satellite, and an update must not treat them as new. It also keeps every existing scenario quiet | Someone who updates never meets the guide unless they run Show the guide |
| A layout file that is set aside or cannot be opened reads as `guideSeen: true`, and so does a failed `interface.load` in the page | Closed means never again by itself, even when the file breaks | A user whose first file broke before they saw the guide needs the command |
| A missing file reads as `guideSeen: false` | That is a fresh home | Deleting the file brings the guide back once |
| The guide is open while `guideSeen` is false and at least one project is listed, with no other stored state | The smallest state. A restart in the middle shows it again from the first step that still applies, because it was neither finished nor closed | Someone who quit to get away from it sees it once more |
| Removing the last project hides the guide without ending it, and adding a project starts it again | The welcome screen never holds the guide | None |
| The two facts are counted over every project, a workspace that is not `main` anywhere and a session tab open anywhere | One rule with several projects | With two projects the guide skips make a workspace if the other project has one |
| Step 02 leaves when a session tab opens | The spec says as soon as a session starts, and the tab is the session | With Claude Code missing the tab closes again and the guide is already on step 03 |
| Steps 03 and 04 leave only by their button | The mock's captions say leaves on Next and Done ends the guide, and reading has no click | A user who picks Files still sees step 03 until Next |
| Show the guide starts at the first step that still applies | The spec says so. The mock's caption says step 01, drawn before the rule was written | With a workspace and a session it opens on step 03 |
| Show the guide is available whenever a project is listed and no dialog is open, also while the guide is open, where it only moves focus into the card | It is the keyboard's way into the card from anywhere, the terminal included | One more command in the menu |
| A step whose control is not on screen shows no card, no ring and says nothing until the control is back | Decided with the maintainer | Show the guide with no workspace selected shows nothing until one is picked |
| One side per step and a clamp along the control, no flip | The window's minimum size makes every side fit | A future smaller minimum hides a card instead of moving it |
| A frame loop measures while the guide is open | Simplest thing that follows scroll, resize, dividers, wrapping and a control that mounts late | One query and one box read per frame for the minutes the guide is open |
| `role="group"` and a separate `role="status"` region | See Rulings checked | A screen reader does not call the card a dialog |
| The layer is the first child of the window, so the card is the first tab stop | The terminal keeps Tab for Claude Code, so a card placed last could not be reached by Tab | Tab from the top of the window lands on the guide first while it is open |
| A mouse press on the card does not move focus, as in the palette | A click on Next must not take the keys from the terminal | A mouse user cannot focus the card by clicking it |
| The card stays in place under a kit dialog or the command menu, inert and under the scrim | Hiding it would move it twice | The card shows dimmed behind the New workspace dialog |
| Close at step 04 is a close, with the toast | Only Done ends it without one | None |
| The close control is the kit's small ghost icon button, 24 by 24 | The toast uses the same one. The mock's kit draws it 28 by 24 | Four pixels narrower than the mock |
| The words use the straight apostrophe of the spec | Every sentence in the app does | The mock draws a curly one |
| Step 02 points at the row of actions, so the ring holds Resume session and Start a new session when both show | Either starts a session | A wider ring after a restart |
| The real controls are marked with `data-guide`, not found by test id | Product code should not depend on test ids that differ per project | Four attributes |

## Exact values

### Words

Every word on screen. No colons, titles lowercase with no full stop.

| Step | Readout | Spoken readout | Title | Sentence | Button |
| --- | --- | --- | --- | --- | --- |
| 1 | `01 / 04` | `Step 1 of 4` | `make a workspace` | `A workspace is a git worktree and a branch made in one step, so agents work side by side and never in each other's files.` | `Next` |
| 2 | `02 / 04` | `Step 2 of 4` | `start Claude Code` | `This is your own Claude Code in a real terminal, with your settings and skills, and its prompt is the only place you type.` | `Next` |
| 3 | `03 / 04` | `Step 3 of 4` | `read what it did` | `Changes, Files and Pull request show the work in this workspace, read only, because your agent does the writing.` | `Next` |
| 4 | `04 / 04` | `Step 4 of 4` | `orange means you` | `A square pixel shows the state of each session, and signal orange means one cannot go on without you, so it waits in the inbox.` | `Done` |

- Legend on step 4, in this order, `idle`, `working`, `needs you`, `done`.
- Close control, accessible name `Close the guide`.
- Toast after a close, `The guide is closed. Show the guide in the command menu opens it again.`
- Command title `Show the guide`.
- Status region, `<spoken readout>. <title>. <sentence>`, as in `Step 1 of 4. make a workspace. A workspace is a git worktree and a branch made in one step, so agents work side by side and never in each other's files.`

### Steps and their anchors

The layer finds the control with `document.querySelector('[data-guide="<name>"]')`. Exactly one element carries each name at a time.

| Step | `data-guide` | The element | Side | Leaves |
| --- | --- | --- | --- | --- |
| 1 | `workspace` | The `span` around the New workspace button of one project in `sidebar.tsx`. The project of the selected workspace when its folder is present, else the first listed project whose folder is present. The span gains `flex` so its box is the button's, 24 by 24 | `right` | when any project lists a workspace that is not `main`, or on Next |
| 2 | `session` | The `div` that holds the start buttons in `EmptyWorkspace` in `sessions-pane.tsx`, 28 tall and as wide as its buttons | `left` | when any session tab is open, or on Next |
| 3 | `views` | The tab list of `centre-tabs.tsx`, which becomes an inner `div` exactly as large as its three tabs, 26 tall | `below` | on Next |
| 4 | `inbox` | The header row of `InboxList` in `inbox-list.tsx`. The ring takes a band of it, 28 tall, that ends 2 below the row's bottom edge and spans its width | `right` | on Done |

Where the card lands. `L` is the sidebar width, 200 to 360, `R` the session column, 360 to 640, `W` the window width, 960 or more.

| Step | Card's left edge | Card's top edge | Narrowest, 960 by 600, `L` 200, `R` 360 | Widest case |
| --- | --- | --- | --- | --- |
| 1 | about `L + 15` | the plus's middle minus 28, clamped | 215 to 515 | `L` 360, 375 to 675 |
| 2 | the row's left edge minus 332 | the row's middle minus 28 | about 381 to 681 with one button, 313 to 613 with two | never under 8, the row is centred in a column at least 360 wide |
| 3 | the tabs' middle minus 28, about `L + 80` | the tabs' bottom plus 32, about 110 | 280 to 580, bottom about 308 | `L` 360, 440 to 740 |
| 4 | `L + 23` | the band's middle minus 28 | 223 to 523 | `L` 360, 383 to 683 |

A control that is not in the page, has no size or is not fully inside the window gives no card and no ring. That covers the welcome screen, no workspace selected, the tool check card over the centre column (step 3 only), a missing project folder, a session pane still asking whether a session can resume, and a sidebar scrolled so the plus left the window.

### The state machine

In `src/renderer/guide/guide-steps.ts`.

```ts
export type GuideStep = 1 | 2 | 3 | 4;
export type GuideSide = "right" | "left" | "below";
export interface GuideFacts {
  workspaces: number;
  sessions: number;
}
export interface GuideStepDetail {
  anchor: "workspace" | "session" | "views" | "inbox";
  side: GuideSide;
  title: string;
  text: string;
  band?: { height: number; below: number };
}
export const guideSteps: Record<GuideStep, GuideStepDetail>;
export const guideLegend: readonly { state: PixelState; word: string }[];
export const guideClosedSentence: string;
export function stepReadout(step: GuideStep): string;
export function stepSpoken(step: GuideStep): string;
export function settledStep(step: GuideStep, facts: GuideFacts): GuideStep;
export function stepAfter(step: GuideStep, facts: GuideFacts): GuideStep;
```

- `facts.workspaces` is the count of workspaces whose key is not `main` over every listed project. `facts.sessions` is `sessions.all.length`.
- `settledStep(1, facts)` is `settledStep(2, facts)` when `facts.workspaces > 0`. `settledStep(2, facts)` is 3 when `facts.sessions > 0`. Every other input answers itself. Steps never go back.
- `stepAfter(step, facts)` is `settledStep` of the following step, with 4 following itself, through a `Record<GuideStep, GuideStep>` and no cast.
- `guideSteps[4].band` is `{ height: 28, below: 2 }`. `guideLegend` is `idle`, `working`, `needs-you` with the word `needs you`, and `done`.

`useGuide` in `src/renderer/guide/use-guide.ts` holds the rest.

```ts
export interface Guide {
  step: GuideStep | null;
  focusAsk: number;
  next: () => void;
  done: () => void;
  close: () => void;
  show: () => void;
}
export function useGuide(input: {
  seen: boolean;
  listed: boolean;
  facts: GuideFacts;
  onSeen: () => void;
  notify: Notify;
}): Guide;
```

- State is `again` (the command asked for it, `false` at start), `at` (`GuideStep | null`) and `focusAsk` (a counter, 0 at start).
- `open` is `listed && (!seen || again)`. `step` is `open ? settledStep(at ?? 1, facts) : null`. When `at !== step` the hook calls `setAt(step)` during render, the pattern `palette.tsx` uses for `shownMode`.
- `next` sets `at` to `stepAfter(step, facts)` while `step` is 1, 2 or 3. `done` sets `again` to `false` and calls `onSeen` when `seen` is `false`. `close` does what `done` does, then `notify(guideClosedSentence, "info")`. `show` sets `again` to `true` and adds one to `focusAsk`, and is a `useCallback` with no dependency.

What follows from those lines, and must hold.

| Case | What happens |
| --- | --- |
| Welcome screen, no project | `listed` is `false`, no card |
| The first project is added | `listed` turns `true`, the guide opens at `settledStep(1, facts)` |
| The user is already past a step | It is skipped. A project that arrives with workspaces opens on step 2, one with a session running on step 3 |
| Several projects | The facts count them all. Step 1 points at the selected project's plus |
| The last project is removed in the middle | No card. Nothing is saved. A project added later opens the guide again from `settledStep(1, facts)` |
| A kit dialog or the command menu opens over it | The card stays, under the scrim. Steps still follow the facts, so the card is on step 2 when the New workspace dialog closes |
| Restart in the middle | `guideSeen` is still `false`, so it opens again from `settledStep(1, facts)`. No session tab survives a restart, so a user with a workspace lands on step 2 |
| Close or Escape in the card | `guideSeen` becomes `true` and is saved, the toast shows, the card goes |
| Done | `guideSeen` becomes `true` and is saved, no toast |
| Show the guide after that | `again` is `true`, the guide opens at `settledStep(1, facts)` and focus moves into the card. Close and Done end it as before |
| Show the guide while it is open | Only focus moves into the card |
| The session closes or the workspace is archived on step 3 or 4 | The step stays |

### The position rule in numbers

In `src/renderer/guide/guide-placement.ts`. Every length is CSS pixels in the window's coordinates.

```ts
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Placement {
  ring: Box;
  card: { left: number; top: number };
  tail: number;
}
export const guideGeometry = { ring: 4, gap: 32, aim: 28, margin: 8, tailInset: 16 };
export function bandOf(row: Box, band: { height: number; below: number } | undefined): Box;
export function placeGuide(
  anchor: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  side: GuideSide,
): Placement | null;
```

1. `bandOf` answers the row itself without a band. With one it answers the row's `left` and `width`, `height` the band's height and `top` the row's bottom plus `below` minus that height.
2. `placeGuide` answers `null` when the anchor's width or height is 0 or less, or when any edge of it lies outside the viewport.
3. The ring is the anchor grown by 4 on every side.
4. Main axis. `right`, the card's left is the anchor's right plus 32. `left`, the card's left is the anchor's left minus 32 minus the card's width. `below`, the card's top is the anchor's bottom plus 32. When the card would then end less than 8 from the window's edge on that axis, `null`.
5. Cross axis, vertical for `right` and `left`, horizontal for `below`. `middle` is the anchor's middle. `start` is `middle - 28` clamped to between 8 and the window's size minus the card's size minus 8, and `null` when that upper bound is under 8. `tail` is `middle - start`, and `null` when it is under 16 or over the card's size minus 16.
6. Every number in the answer is `Math.round`ed. The card never overlaps the anchor, since the main axis rule keeps 32 between them.

### The card, token by token

All colours are app tokens, so light and dark need no branch.

- **Layer.** `<div data-testid="guide" className="fixed top-0 left-0 z-40">`, the first child of the `app-window` element. It holds the status region, the ring and the card. `z-40` is over the column dividers (`z-20`) and the drop overlay (`z-30`) and under dialogs and the palette (`z-50`) and the toast (`z-[60]`).
- **Status region.** `<p role="status" data-testid="guide-status" className="sr-only">`, always rendered. Its text is the Words line for the step while a card is placed and empty otherwise.
- **Ring.** `<div aria-hidden="true" data-testid="guide-ring" className="pointer-events-none fixed rounded-[8px] border border-fg2">` with `left`, `top`, `width` and `height` from `placement.ring` as inline style. Rendered only while a card is placed.
- **Card.** `<div role="group" tabIndex={-1} data-testid="guide-card" data-step={step} data-side={side} aria-labelledby={titleId} aria-describedby={textId}>` with `className="fixed flex w-[300px] flex-col gap-2 rounded-[10px] border border-line bg-raised pt-3 pr-3 pb-4 pl-4 text-[13px] leading-5 font-normal text-fg shadow-raised outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"`, plus `invisible` while no placement exists, and `left` and `top` from `placement.card` as inline style. Rendered whenever `step` is not `null`, so its size can be read before it is placed.
- **Tail.** Inside the card, `<span aria-hidden="true" data-testid="guide-tail" className="pointer-events-none absolute flex gap-1">` with three `<span className="size-1 bg-fg2" />`. Side `right`, class `flex-row` and style `{ left: -25, top: tail - 3 }`. Side `left`, `flex-row` and `{ right: -25, top: tail - 3 }`. Side `below`, `flex-col` and `{ top: -25, left: tail - 3 }`. That puts three 4 pixel squares at 4, 12 and 20 from the card's edge with 4 between the last and the ring, their middle on `tail`.
- **Header.** `<div className="flex h-6 items-center justify-between">` with the readout, `<span aria-hidden="true" data-testid="guide-readout" className="font-pixel text-[12px] text-dim uppercase">`, then `<span className="sr-only">` with the spoken readout, then the close control, `<Button variant="ghost" size="small" icon="close" label="Close the guide" testId="guide-close">`.
- **Title.** `<h2 id={titleId} data-testid="guide-title" className="mr-1 font-display text-[20px] leading-6 font-bold tracking-[-0.04em]">`.
- **Sentence.** `<p id={textId} data-testid="guide-text" className="mr-1 text-fg2">`.
- **Legend**, step 4 only. `<ul data-testid="guide-legend" className="mr-1 grid grid-cols-2 gap-x-3 gap-y-1 rounded-[8px] border border-line px-3 py-2 text-[12px] text-fg2">`, each entry `<li className="flex items-center gap-2">` with `<StatusPixel state={state} size={6} />` and the word. Signal orange appears here once, on needs you.
- **Footer.** `<div className="mt-2 mr-1 flex justify-end">` with one `<Button>` in one place in the tree, so the element stays mounted from step to step. On steps 1 to 3 it is `variant="secondary"`, `testId="guide-next"` and reads `Next`. On step 4 it is the primary, `testId="guide-done"`, and reads `Done`.
- Nothing animates. With these classes the card measures 300 by 198 with a three line sentence and 300 by 268 on step 4, as the mock does.

### Focus and keys

- The card and the ring appear, move and change step without any call to `focus`. Focus moves into the card in one case only, after `focusAsk` grows, when the layer calls `card.focus({ preventScroll: true })` as soon as a placement exists.
- `onMouseDown` on the card calls `event.preventDefault()`, so a click on Next, Done or the close control leaves focus where it was.
- `onFocus` on the card remembers `event.relatedTarget` in a ref, `cameFrom`, when it is an `HTMLElement` outside the card.
- `onKeyDown` on the card, for `Escape` that is not composing, calls `preventDefault` and `stopPropagation` and closes. No other listener for Escape is added anywhere.
- Returning focus. Before Close, Escape or Done ends the guide, and when a measure finds no placement, the layer checks whether `document.activeElement` is inside the card. Only then it focuses `cameFrom` when that is still connected, else the first `button:not([tabindex='-1'])` inside the step's control, else the control's nearest ancestor with a `tabindex`.
- Next with focus on it keeps focus on it, because the card element stays mounted across steps and is measured again in a layout effect before the next paint.
- Tab order. The card comes first in the window, close control then Next or Done, and Tab leaves it into the sidebar. While it is `invisible` nothing in it can take focus.

### Storage

In `src/shared/bridge-contract.ts`, `interfaceState` gains `guideSeen: z.boolean()` after `notifications`, and `defaultInterfaceState.guideSeen` is `false`. `interface.load` and `interface.save` keep their names and shapes otherwise.

In `src/main/state/interface-file.ts`.

```ts
const version4 = interfaceState.extend({ version: z.literal(4) });
const version3 = interfaceState
  .omit({ guideSeen: true })
  .extend({ version: z.literal(3) })
  .transform((file): z.output<typeof version4> => ({ ...file, version: 4, guideSeen: true }));
```

- `version2` and `version1` omit `guideSeen` too and add `guideSeen: true` beside what they already add, answering `version4`'s output. `fileSchema` is the union of all four.
- `readInterfaceFile` passes `{ ...defaultInterfaceState, version: 4 }` as the fallback and answers `guideSeen: outcome.kind === "read" || outcome.kind === "missing" ? value.guideSeen : true`.
- `save` writes `{ version: 4, ...state }`.
- `src/renderer/entry.tsx` starts from `{ ...defaultInterfaceState, guideSeen: true }` when `interface.load` failed.
- What a page running hostile script could do with the field. Flip one boolean, which shows or hides a card. Nothing is read, run or sent.

### Command

`"guide.show"` joins `CommandId`. The entry in `AppWindow`'s list, after `tools.check`.

```ts
{
  id: "guide.show",
  title: "Show the guide",
  available: guideListed,
  run: showGuide,
}
```

`guideListed` is `projects !== undefined && projects.length > 0` and `showGuide` is `guide.show`. `guarded` already withholds it while a kit dialog is open. No shortcut. Its palette row gets the test id `command-guide-show`.

### Test ids

`guide`, `guide-status`, `guide-ring`, `guide-card` with `data-step` and `data-side`, `guide-tail`, `guide-readout`, `guide-title`, `guide-text`, `guide-legend`, `guide-close`, `guide-next`, `guide-done`, `command-guide-show`. Every existing test id stays. `centre-tabs` moves to the inner tab list with its role.

### Verification

- **Quiet by default.** A scenario whose seeded `interface.json` is older than version 4, or says `"guideSeen": true`, never shows the guide. Every existing scenario seeds version 1, so `launch`, `boundary`, `projects`, `workspaces`, `changes`, `files`, `conflicts`, `sessions`, `processes`, `inbox`, `pull-request`, `missing`, `settings` and `quit` must pass with no edit other than the two this plan names, the version literal in `inbox.ts` (Task 1) and the command count in `projects.ts` (Task 3). The product has no switch for this.
- **Scenario `first-run`.** `verify/scenarios/first-run/scenario.json`, a fresh home, so it seeds no `home` file at all.

```json
{
  "description": "A fresh Satellite home with no saved layout, so the first-run guide starts once the repo is added. The repo is a clone of a local upstream with one commit, with a stand-in gh and a stand-in Claude Code at its prompt. It seeds no interface.json, so the window follows the system theme until a theme step sets one.",
  "folders": [
    {
      "name": "upstream",
      "steps": [
        { "write": { "path": "README.md", "content": "# Verify repo\n" } },
        { "git": ["init", "-b", "main"] },
        { "git": ["add", "."] },
        { "git": ["commit", "-m", "first commit"] }
      ]
    }
  ],
  "repo": [{ "git": ["clone", "../folders/upstream", "."] }],
  "gh": [
    { "args": ["--version"], "stdout": "gh version 2.99.0 (stand-in)\n" },
    {
      "args": ["auth", "status", "--active"],
      "stdout": "github.com\n  ✓ Logged in to github.com account octo-verify (keyring)\n  - Active account: true\n"
    }
  ],
  "claude": {
    "version": "2.0.0 (Claude Code stand-in)",
    "script": [{ "print": "Claude Code stand-in\r\n" }, { "print": "> " }]
  }
}
```

- The project is named `repo`, so the ids are `project-repo`, `new-workspace-repo` and `workspace-repo-main`.
- **Two new CLI steps** in `verify/cli.ts`, both read only. `box=<testid>` answers `{ x, y, width, height }` of the element's bounding box, rounded, and fails when the element is not there. `focused` answers the test id nearest the focused element, an empty string when it has none, and `null` when nothing has focus, without failing.
- **Journey `guide`** in `verify/journeys/guide.ts`, scenario `first-run`, listed in `verify/journeys.ts` right after `projects`. Task 4 gives its script.

## Review Focus

1. **The card never takes focus and never eats a key.** No `focus` call except after Show the guide. Escape closes only from inside the card and reaches Claude Code from the terminal. A mouse click on the card leaves focus where it was.
2. **Closed for good, and an update is not a first run.** `guideSeen` is saved on Close and Done, versions 1 to 3 and unreadable files read as seen, only a missing file reads as new, and no existing scenario shows the guide.
3. **The position rule, in numbers.** Ring 4, card 32, tail on the control's middle 28 from the corner, 8 inside the window, never over the control, no layout shift, at 960 by 600 and at the size the window opens.
4. **The mock, word for word and token for token.** Every string, size and class in Exact values, light and dark from tokens only, signal orange once.
5. **Nothing extra.** No tracking, no new channel, no dependency, no Back button, no option, no code for the frame that is not built.

---

### Task 1: Whether the guide was seen, in `interface.json` version 4

The one stored field and its migration. Nothing reads it yet.

**Files:**
- Modify: `src/shared/bridge-contract.ts`, `src/main/state/interface-file.ts`, `src/main/state/interface-file.test.ts`, `src/main/bridge/registry.test.ts`, `src/renderer/entry.tsx`, `verify/journeys/inbox.ts`, `ARCHITECTURE.md`, `specs/010-first-run-guide/spec.md`, `specs/README.md`

**Interfaces:**
- Consumes: `interfaceState`, `defaultInterfaceState`, `readJsonFile` and its `JsonReadOutcome`, `createJsonWriter`.
- Produces: `InterfaceState["guideSeen"]: boolean`, `interface.json` at version 4, exactly as Exact values, Storage, says.

- [ ] **Step 1: Status.** In `specs/010-first-run-guide/spec.md` the status line reads `Status **In progress**`, and the row for 010 in the index of `specs/README.md` reads `In progress`.
- [ ] **Step 2: Tests first**, each seen failing before the code changes, in `interface-file.test.ts`.
  - Rename `writes the layout as version 3` to `writes the layout as version 4 with whether the guide was seen`. It saves `{ ...saved, notifications: false }` and expects `{ version: 4, notifications: false, files: [], guideSeen: false }`, then saves with `guideSeen: true` and a fresh `createInterfaceFile(home).load()` answers `guideSeen: true`.
  - Rename `reads a version 1 and a version 2 file as version 3 with no tabs and keeps the rest` to `reads a version 1, 2 and 3 file as one whose guide was seen and keeps the rest`. Add a version 3 case, `{"version":3,<layout>,"notifications":false,"files":[]}`. Every case expects `guideSeen: true`.
  - New, `starts with the guide not seen when there is no layout file`. An empty home loads `defaultInterfaceState` with `guideSeen: false` and a `null` notice.
  - New, `counts a layout file it set aside as one whose guide was seen`. A file holding `{` loads `{ ...defaultInterfaceState, guideSeen: true }` with the set aside notice.
  - Rename `sets aside a version 3 file that an older version would not understand and a version 4 file` to `sets aside a version 4 file with a field it does not know and a version 5 file`. It writes `{ version: 5, ...saved }` and `{ version: 4, ...saved, extra: true }`, each in its own home.
  - In the four tests that expect `defaultInterfaceState` after a file that could not be opened or was set aside, the expectation becomes `{ ...defaultInterfaceState, guideSeen: true }`.
  - In `registry.test.ts`, `refuses interface state out of bounds` gains `{ ...defaultInterfaceState, guideSeen: "yes" }`.
- [ ] **Step 3: Implement** Exact values, Storage. In `verify/journeys/inbox.ts`, `savedInterface` reads `z.literal(4)`.
- [ ] **Step 4: ARCHITECTURE.md.** The `interface.load` and `interface.save` rows name whether the guide was seen, a boolean, and what a hostile page could do with it. The `interface.json` row shows `"version": 4` with `"guideSeen"`. Strict schemas says the file reads versions 1 to 4 and writes 4, that an older file reads as guide seen, that a file set aside or not opened does too, and that only a missing file starts with it unseen.
- [ ] **Step 5: Prove it.** `npx vitest run src/main/state src/main/bridge` passes. `./scripts/check` is green. `npm run --silent journeys` prints `pass` for every journey, which proves `inbox` reads version 4 and that nothing else moved.
- [ ] **Step 6: Commit.** `docs(specs): start the first-run guide`, then `feat(state): remember whether the guide was seen`.

---

### Task 2: The steps, the position rule and the four anchors

The two pure functions with their tests, and the attributes the layer will look for. Nothing is drawn yet.

**Files:**
- Create: `src/renderer/guide/guide-steps.ts`, `src/renderer/guide/guide-steps.test.ts`, `src/renderer/guide/guide-placement.ts`, `src/renderer/guide/guide-placement.test.ts`
- Modify: `src/renderer/projects/sidebar.tsx`, `src/renderer/sessions/sessions-pane.tsx`, `src/renderer/window/centre-tabs.tsx`, `src/renderer/inbox/inbox-list.tsx`

**Interfaces:**
- Consumes: `PixelState` from `src/renderer/ui/status-pixel.tsx`.
- Produces: everything under Exact values, The state machine (the `guide-steps.ts` block only, not `useGuide`) and The position rule in numbers, with the words of the Words table, and the four `data-guide` attributes of Steps and their anchors.

- [ ] **Step 1: Tests first**, each seen failing.
  - `guide-steps.test.ts`
    - `starts on make a workspace with no workspace and no session`, `settledStep(1, { workspaces: 0, sessions: 0 })` is 1.
    - `skips to start Claude Code once a workspace exists and to read what it did once a session is open`, `settledStep(1, { workspaces: 1, sessions: 0 })` is 2, `settledStep(1, { workspaces: 1, sessions: 1 })` is 3, `settledStep(2, { workspaces: 0, sessions: 1 })` is 3.
    - `never goes back when the session closes or the workspace is archived`, `settledStep(3, { workspaces: 0, sessions: 0 })` is 3 and `settledStep(4, …)` is 4.
    - `Next from make a workspace skips start Claude Code while a session is open`, `stepAfter(1, { workspaces: 0, sessions: 1 })` is 3, `stepAfter(1, { workspaces: 0, sessions: 0 })` is 2, `stepAfter(3, …)` is 4 and `stepAfter(4, …)` is 4.
    - `reads each step as a two digit readout and a spoken one`, `stepReadout(1)` is `01 / 04` and `stepSpoken(4)` is `Step 4 of 4`.
  - `guide-placement.test.ts`, with a 300 by 198 card unless said.
    - `puts the ring 4 outside the control and the card 32 to its right with the tail 28 from the corner`. Anchor `{ left: 210, top: 163.8, width: 24, height: 24 }`, viewport 1280 by 640, `right`. Ring `{ left: 206, top: 160, width: 32, height: 32 }`, card `{ left: 266, top: 148 }`, tail 28.
    - `puts the card to the left of Start Claude Code and under the tabs as the mock draws them`. Anchor `{ left: 1023, top: 323.4, width: 132.9, height: 28 }`, `left`, card `{ left: 691, top: 309 }`. Anchor `{ left: 259, top: 51.5, width: 195.1, height: 26 }`, `below`, card `{ left: 329, top: 110 }`, tail 28.
    - `takes a 28 pixel band that ends 2 under the inbox header`. `bandOf({ left: 9, top: 67, width: 231, height: 34 }, { height: 28, below: 2 })` is `{ left: 9, top: 75, width: 231, height: 28 }`, and placing it with a 300 by 268 card on `right` gives card `{ left: 272, top: 61 }`.
    - `keeps the card 8 inside the window and the tail on the control when the control sits low`. Anchor `{ left: 160, top: 560, width: 24, height: 24 }`, viewport 960 by 600, `right`. Card `{ left: 216, top: 394 }`, tail 178.
    - `shows no card when the tail could not reach the control`. The same with `top: 572` is `null`.
    - `shows no card for a control with no size or one the window cuts off`. Width 0 is `null`, and `top: -4` is `null`.
    - `shows no card when its side has no room`. Anchor `{ left: 200, top: 300, width: 100, height: 28 }`, `left`, is `null`.
    - `never lets the card cover the control`. For each side and the anchors above that place, the card's box and the anchor's box do not intersect.
- [ ] **Step 2: Implement** `guide-steps.ts` and `guide-placement.ts` per Exact values. Files hold types, then constants, then private helpers, then exports.
- [ ] **Step 3: Anchors.**
  - `sidebar.tsx`. `Sidebar` works out the guided project, the project of `selected` when its `missing` is `null`, else the first project whose `missing` is `null`, and passes `guided` to `ProjectRows`. The span around the New workspace button becomes `className="ml-auto flex flex-none"` and carries `data-guide="workspace"` only when `guided`.
  - `sessions-pane.tsx`. The `div` with `ref={actions}` in `EmptyWorkspace` carries `data-guide="session"`.
  - `centre-tabs.tsx`. The outer element becomes a plain `<div className="flex h-10 min-w-0 items-center">`. Inside it the tab list, `<div role="tablist" aria-label="Workspace views" data-testid="centre-tabs" data-guide="views" onKeyDown={move} className="flex items-center gap-0.5">`, holds the three tabs unchanged.
  - `inbox-list.tsx`. The header `div`, the one with the bell and the count, carries `data-guide="inbox"`.
- [ ] **Step 4: Prove it.** `npx vitest run src/renderer/guide` passes. `./scripts/check` is green. `npm run --silent verify -- mixed-changes click=workspace-repo-alpha wait-for=changes-list shot=centre-bar` is run before and after the change, and the two screenshots show the same bar. `npm run --silent journeys` prints `pass` for every journey.
- [ ] **Step 5: Commit.** `feat(guide): decide the step and place the card`, then `feat(guide): mark the four controls the guide points at`.

---

### Task 3: The card, the layer, the command and the `first-run` scenario

The guide in the window, from the first project to Done.

**Files:**
- Create: `src/renderer/guide/use-guide.ts`, `src/renderer/guide/guide-card.tsx`, `src/renderer/guide/guide-layer.tsx`, `verify/scenarios/first-run/scenario.json`
- Modify: `src/renderer/window/app-window.tsx`, `src/renderer/commands/command-registry.ts`, `verify/cli.ts`, `verify/journeys/projects.ts`, `.claude/skills/satellite-verify/SKILL.md`

**Interfaces:**
- Consumes: `guideSteps`, `guideLegend`, `guideClosedSentence`, `stepReadout`, `stepSpoken`, `settledStep`, `stepAfter`, `GuideStep`, `GuideFacts` from `guide-steps.ts`, `placeGuide`, `bandOf`, `Placement` from `guide-placement.ts`, `Button`, `StatusPixel`, `Notify`, `InterfaceState["guideSeen"]`, the four `data-guide` attributes.
- Produces:
  ```ts
  // use-guide.ts, as in Exact values, The state machine
  export function useGuide(input): Guide;
  // guide-card.tsx, the inside of the card, header, title, sentence, legend and footer
  export function GuideCard(props: {
    step: GuideStep;
    titleId: string;
    textId: string;
    onNext: () => void;
    onDone: () => void;
    onClose: () => void;
  }): ReactNode;
  // guide-layer.tsx, the layer, the status region, the ring, the card's box and tail, measuring and focus
  export function GuideLayer(props: {
    step: GuideStep | null;
    focusAsk: number;
    onNext: () => void;
    onDone: () => void;
    onClose: () => void;
  }): ReactNode;
  ```

- [ ] **Step 1: `useGuide`** exactly as Exact values, The state machine.
- [ ] **Step 2: `GuideCard`** renders, as a fragment, the header, title, sentence, legend and footer of Exact values, The card, token by token, with the words of the Words table.
- [ ] **Step 3: `GuideLayer`.**
  - It always renders the layer `div` and the status region. With a `step` it also renders the card's box holding the tail and `<GuideCard>`, and, while a placement exists, the ring.
  - `measure`. With a `step` and the card's element, it finds the control by its `data-guide` name, takes `bandOf(control.getBoundingClientRect(), guideSteps[step].band)`, and calls `placeGuide` with the card's `offsetWidth` and `offsetHeight`, `window.innerWidth` and `window.innerHeight`, and the step's side. No control answers `null`. When the answer is `null` and focus is inside the card, it returns focus first (Exact values, Focus and keys). It stores the answer in state only when it differs from the one held.
  - `measure` runs in a `useLayoutEffect` on `step`, and once per frame through `requestAnimationFrame` in an effect that runs only while `step` is not `null` and cancels its frame on cleanup. With `step` `null` the placement is cleared.
  - Focus on request. An effect on `focusAsk` sets a ref when `focusAsk` is over 0. After a placement exists and the ref is set, the layer calls `card.focus({ preventScroll: true })` and clears the ref.
  - Close, Escape and Done return focus when it is inside the card, then call `onClose` or `onDone`. `onMouseDown`, `onFocus` and `onKeyDown` on the card are as Exact values, Focus and keys.
- [ ] **Step 4: Window.** In `app-window.tsx`.
  - `guideFacts`, a `useMemo` over `projects` and `allSessions`, per The state machine. `guideListed` per Command. `markGuideSeen`, a `useCallback` that calls `update((current) => ({ ...current, guideSeen: true }), true)`.
  - `const guide = useGuide({ seen: state.guideSeen, listed: guideListed, facts: guideFacts, onSeen: markGuideSeen, notify })`.
  - The `guide.show` command per Exact values, Command, with `guideListed` and `guide.show` in the registry's dependency list. `"guide.show"` joins `CommandId`.
  - `<GuideLayer step={guide.step} focusAsk={guide.focusAsk} onNext={guide.next} onDone={guide.done} onClose={guide.close} />` is the first child of the `app-window` element, before the sidebar section.
- [ ] **Step 5: Verify.** Add `verify/scenarios/first-run/scenario.json` and the CLI steps `box` and `focused` from Exact values, Verification. In `verify/journeys/projects.ts`, `menuCommands` becomes 16. In skill `satellite-verify`, the Steps table gains `box=<testid>` and `focused`, the Scenarios section says a scenario stays quiet unless it seeds no `interface.json` or one at version 4 with `"guideSeen": false`, and that `first-run` seeds none, and the `projects` journey row says sixteen commands.
- [ ] **Step 6: Prove it in the window.** Each run prints JSON, and its screenshots are read. `Meta+K` is `Control+Shift+K` off macOS.
  - Never on the welcome, then step 1 beside the plus with no focus taken. `npm run --silent verify -- first-run theme=light wait-for=check-count tree choose-folder=repo click=add-first-project wait-for=guide-card text=guide-card text=guide-status focused box=new-workspace-repo box=guide-ring box=guide-card shot=guide-1-light theme=dark shot=guide-1-dark resize=960x600 box=guide-card shot=guide-1-narrow`. The first `tree` lists no `guide-card`. `focused` is not a guide id. The ring is the button's box grown by 4, and the card's `x` is the button's right edge plus 32.
  - Next through all four, both themes, narrow. `… click=guide-next "wait-text=guide-title:start Claude Code" box=start-claude box=guide-card shot=guide-2 click=guide-next "wait-text=guide-title:read what it did" box=centre-tabs box=guide-card shot=guide-3 click=guide-next "wait-text=guide-title:orange means you" text=guide-legend box=guide-ring box=guide-card shot=guide-4 resize=960x600 theme=dark shot=guide-4-narrow-dark`. Compare each screenshot with the mock frame of the same step.
  - Early close, the toast, and quiet after a restart. `… click=guide-close "wait-text=toast:The guide is closed" text=toast restart wait-for=project-repo tree`. The toast reads the sentence and the last `tree` lists no `guide-card`.
  - A restart in the middle. `… wait-for=guide-card restart wait-for=guide-card text=guide-readout` reads `01 / 04` again.
  - The command, doing the thing, and Escape. `… click=guide-close restart wait-for=project-repo press=Meta+K type=guide press=Enter wait-for=guide-card focused click=new-workspace-repo wait-for=create-workspace click=create-workspace "wait-text=guide-title:start Claude Code" click=start-claude "wait-text=guide-title:read what it did" focused press=Escape wait-for=guide-card log press=Meta+K type=guide press=Enter focused press=Escape "wait-text=toast:The guide is closed" focused`. The first `focused` is `guide-card`, the one after Start is `terminal`, `log` holds an `input` event with the escape character and the card is still there, and after the second Escape the toast shows and focus is back in `terminal`.
  - Done leaves nothing. A run that ends `… click=guide-done tree restart wait-for=project-repo tree` shows no `guide-card` and no `toast` in either tree.
- [ ] **Step 7: Check.** `./scripts/check` green, `npm run --silent journeys` all `pass`, and no process from this repo's `node_modules/electron` left.
- [ ] **Step 8: Commit.** `feat(guide): show the first-run guide beside the real controls`, then `test(verify): add the first-run scenario and two read steps`.

---

### Task 4: The `guide` journey

Every Acceptance point as one fixed script, with no fixed wait.

**Files:**
- Create: `verify/journeys/guide.ts`
- Modify: `verify/journeys.ts`, `.claude/skills/satellite-verify/SKILL.md`

**Interfaces:**
- Consumes: `AppSession` from `verify/driver.ts`, `waitUntil`, `visible`, `gone`, `toastReads`, `startClaude`, `terminalFocused`, `standInInput`, `promptTimeoutMs` from `verify/journeys/conditions.ts`, the test ids of Exact values, and `guideSteps` from `src/renderer/guide/guide-steps.ts` only for the anchor names, sides and the band. The words are written out in the journey, from the spec.
- Produces: `export const guideJourney: Journey` with `name: "guide"` and `scenario: "first-run"`, listed in `verify/journeys.ts` right after `projectsJourney`.

Helpers inside the journey file.

- `settled(page)`, two animation frames through `page.evaluate`, so a card that would appear has had its frame. It is not a timed wait.
- `stepShows(session, step, when)`, waits until `guide-card` is visible with that `data-step`, then asserts the readout, the title, the sentence and the button's words, that `guide-status` reads the Words line, and that `document.activeElement` is not inside `guide-card` unless the caller says focus was asked for.
- `sitsBeside(session, step, when)`, waits with `waitUntil` until all of this holds, reading the control's box (through `bandOf` for step 4), `guide-ring`, `guide-card`, `guide-tail` and the window's inner size in one `page.evaluate`, each within 1 pixel. The ring is the control grown by 4. The card is 32 from the control on the step's side. The middle of the tail is on the middle of the control along the other axis. The card lies inside the window. The card and the control do not intersect. Its failure names the numbers it last read.
- `looks(session, step)`, for `light` then `dark` through `page.emulateMedia`, asserts the card's computed background is `rgb(255, 255, 255)` then `rgb(22, 22, 24)` and the ring's border colour `rgb(69, 69, 75)` then `rgb(180, 180, 184)`, and saves `guide-<step>-<scheme>`. It ends on `light`.
- `everySize(session, step)`, runs `sitsBeside` at the size the window opened, then after `page.setViewportSize({ width: 960, height: 600 })`, runs `looks` there, then sets the first size back.
- `savedAsSeen(session)`, waits until `interface.json` in `session.home` parses with `z.object({ version: z.literal(4), guideSeen: z.literal(true) })`.
- `showGuide(session)`, presses the command shortcut for the platform as `projects.ts` does, fills `palette-input` with `guide`, waits for `command-guide-show`, presses Enter.

- [ ] **Step 1: Script, first pass, Next and an early close.**
  1. `page.emulateMedia({ colorScheme: "light" })`. Wait for `check-count`. Record the boxes of `column-projects`, `column-repository` and `column-sessions`. `settled`, then assert no `guide-card` and no `guide-ring`, the guide never shows on the welcome.
  2. `session.answerFolderDialog(session.repo)`, click `add-first-project`. `stepShows(1)`, `everySize(1)`.
  3. Click `guide-next`. `stepShows(2)`, `everySize(2)`. Click `guide-next`. `stepShows(3)`, `everySize(3)`. Click `guide-next`. `stepShows(4)`, assert `guide-legend` reads `idle`, `working`, `needs you`, `done` in order and holds exactly one pixel with `data-state="needs-you"`, `everySize(4)`.
  4. Assert the three column boxes equal the recorded ones, the guide moved nothing.
  5. Click `guide-close`. `gone("guide-card")`, `toastReads` the closed sentence. `savedAsSeen`. `session.relaunch()`, emulate `light`, wait for `project-repo`, `settled`, assert no `guide-card`.
- [ ] **Step 2: Script, second pass, the command, doing the thing, focus and Escape.**
  1. `showGuide`. `stepShows(1)` with focus asked, and wait until the focused element is `guide-card`.
  2. Click `new-workspace-repo`, wait for `create-workspace`, read the name from `workspace-name`, assert the card still reads step 1, click `create-workspace`, wait until `workspace-repo-<name>` is selected. `stepShows(2)`, `sitsBeside(2)`.
  3. `startClaude(session, 1)`. `stepShows(3)`, and `terminalFocused`.
  4. Note the count of stand-in events, press Escape, wait until `standInInput` since then holds the escape character, and assert `guide-card` still shows step 3.
  5. `showGuide`, wait until the focused element is `guide-card`, note the event count, press Escape. `gone("guide-card")`, `toastReads` the closed sentence, `terminalFocused`. Type `x` and wait until `standInInput` since the note is exactly `x`, so the Escape that closed the card never reached Claude Code.
  6. `session.relaunch()`, emulate `light`, wait for `project-repo`, `settled`, assert no `guide-card`.
- [ ] **Step 3: Script, third pass, Done.**
  1. `showGuide`. `stepShows(2)` with focus asked, since a workspace exists and no session does.
  2. By keyboard only. Press Tab until the focused test id is `guide-next`, at most three presses, which proves the card's tab order. Press Enter, `stepShows(3)` with focus asked, and assert the focused test id is still `guide-next`. Press Enter, `stepShows(4)` with focus asked, and assert the focused test id is `guide-done`. Press Enter. `gone("guide-card")`, `settled`, assert no `toast` and that focus is not on the body.
  3. `session.relaunch()`, wait for `project-repo`, `settled`, assert no `guide-card`. Assert `session.consoleErrors` is empty.
- [ ] **Step 4: See it fail once.** Make `close` in `use-guide.ts` skip `onSeen` for one run and see `fail guide` name the card after the restart. Make `placeGuide` use a gap of 20 for one run and see `sitsBeside` name the numbers. Put both back.
- [ ] **Step 5: Skill `satellite-verify`.** A `guide` row in the journeys table that says what it proves, the first sentence of Journeys names the guide, and Feature map rows for 010, each with scenario `first-run` and journey `guide`.
- [ ] **Step 6: Check.** `./scripts/check` green, `npm run --silent journeys` all `pass` with the `guide` screenshots listed, and no Electron process left.
- [ ] **Step 7: Commit.** `test(verify): prove the first-run guide in a journey`.

---

### Task 5: Docs, skills and status Done

**Files:**
- Modify: `SATELLITE.md`, `DESIGN.md`, `ARCHITECTURE.md`, `.claude/skills/satellite-stack/SKILL.md`, `specs/010-first-run-guide/spec.md`, `specs/README.md`

- [ ] **Step 1: SATELLITE.md.** In Layout, after the first run sentence, the guide in sentences. It starts once the first project is added, one card beside the real control, the four steps by name, it follows what the user does or Next, it takes no focus and blocks nothing, the close control or Escape in the card ends it, it never returns by itself, and Show the guide in the command menu starts it from the first step that still applies. One row in Decisions if the table holds product decisions of this kind, a card beside the real control over slides before the app.
- [ ] **Step 2: DESIGN.md.** In App, one bullet for the guide with the values of Exact values, the 300 wide card on `raised` with a `line` border, a 10 corner and the one shadow, the grey ring in `fg2` 4 outside the control with an 8 corner, the tail of three 4 pixel squares in `fg2`, the card 28 from the ring with the tail 28 from its corner, the readout in Geist Pixel 12 in `dim`, the title in Funnel Display 20 at 700, the sentence in `fg2`, the legend, Next as the secondary button and Done as the primary, ring and tail grey in both themes and signal orange once. In Layout and spacing, the shadow rule names the guide card with the menus, the palette, dialogs and toasts. Name no other product.
- [ ] **Step 3: ARCHITECTURE.md.** Folder layout gains `src/renderer/guide/`, the step function, the position rule, the hook, the card and the layer. A short `## First-run guide` section after Running processes, the two facts, the derived open state, the `data-guide` anchors, measuring per frame while open, the fixed layer first in the window, the status region and the focus rule, and that nothing about the user's steps is stored or sent. Decisions gains rows for `guideSeen` in `interface.json` over a file of its own, an older file reading as seen, and measuring over CSS anchor positioning.
- [ ] **Step 4: Skill `satellite-stack`.** Where the interface's parts are listed, `src/renderer/guide/` and the rule that a control the guide points at carries `data-guide`. The commands paragraph needs no change.
- [ ] **Step 5: Status.** Spec and index to **Done**, and tick the spec's five Acceptance items. Leave `plan.md` to the controller.
- [ ] **Step 6: Check.** `./scripts/check` and `npm run --silent journeys` green, last lines in the report. Commit `docs: describe the first-run guide and mark spec 010 done`.

---

## Acceptance map

| Acceptance item or scope bullet | Task | Proof |
| --- | --- | --- |
| After the first project is added the first card appears beside the control that makes a workspace, and never before | 2, 3, 4 | `guide-steps.test.ts`, Task 3 Step 6 first run, `guide` journey first pass 1 and 2 |
| Each step leaves when the user does the thing and on Next | 2, 3, 4 | `guide-steps.test.ts`, `guide` journey first pass 3 for Next and second pass 2 and 3 for the thing |
| The card sits beside its control without covering it at 960 by 600 and a normal size, light and dark | 2, 3, 4 | `guide-placement.test.ts`, Task 3 screenshots against the mock, `everySize` and `looks` for all four steps |
| The card takes no focus, and Escape closes it only while focus is inside it, with a running session | 3, 4 | Task 3 Step 6 fifth run, `guide` journey second pass 3 to 5 |
| An early close shows the toast, Done shows none, and neither shows the guide again after a restart | 1, 3, 4 | `interface-file.test.ts`, `guide` journey first pass 5, second pass 6 and third pass |
| Show the guide in the command menu starts it again | 3, 4 | `guide` journey second pass 1 and third pass 1 |
| Scope, the welcome screen stays as it is | 3, 4 | `launch` journey unchanged, `guide` journey first pass 1 |
| Scope, nothing is dimmed or blocked and the layout does not move | 3, 4 | the fixed layer, `guide` journey first pass 4 |
| Scope, four steps with their readout, title, sentence, action and the legend | 2, 3, 4 | the Words table in `guide-steps.ts`, `stepShows` for each step |
| Scope, Next is secondary and Done is primary | 3 | Task 3 screenshots, the card's classes |
| Scope, the guide starts from the first step that still applies | 2, 4 | `guide-steps.test.ts`, `guide` journey third pass 1 |
| Not in scope, no tracking | 1, 3 | one boolean in `interface.json`, no new channel, Review Focus 5 |
| Existing scenarios and journeys never show the guide | 1 | every scenario seeds version 1, all journeys `pass` in Tasks 1 to 4 |
