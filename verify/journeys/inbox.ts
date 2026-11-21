import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { noticeGapMs } from "../../src/main/inbox/notices.ts";
import type { AppSession, RecordedNotice } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  claudePids,
  gone,
  goneTimeoutMs,
  processGone,
  promptTimeoutMs,
  standInInput,
  startClaude,
  stateIs,
  terminalFocused,
  toastReads,
  visible,
  waitUntil,
} from "./conditions.ts";

type Shown = { kind: "notice"; title: string; body: string } | { kind: "close" };

const menuShortcut = process.platform === "darwin" ? "Meta+K" : "Control+Shift+K";
const settleMs = noticeGapMs + 1000;
const recorderTimeoutMs = 15_000;
const alphaNotice: Shown = {
  kind: "notice",
  title: "alpha needs you",
  body: "Claude Code is waiting for you in repo.",
};
const foldedNotice: Shown = {
  kind: "notice",
  title: "3 workspaces need you",
  body: "Open Satellite to answer them from the inbox.",
};
const closed: Shown = { kind: "close" };
const betaNotice: Shown = {
  kind: "notice",
  title: "beta needs you",
  body: "Claude Code is waiting for you in repo.",
};
const cleared: RecordedNotice = { kind: "badge", count: 0 };
const turnedOff = "Notifications are off. The inbox still shows what needs you.";
const turnedOn = "Notifications are on for every workspace that needs you.";
const savedInterface = z.object({ version: z.literal(2), notifications: z.boolean() });

function shownOf(lines: readonly RecordedNotice[]): Shown[] {
  return lines.flatMap((line) => (line.kind === "badge" ? [] : [line]));
}

function countsOf(lines: readonly RecordedNotice[]): number[] {
  return lines.flatMap((line) => (line.kind === "badge" ? [line.count] : []));
}

async function recorderAnswers(
  session: AppSession,
  from: number,
  expected: RecordedNotice[],
  when: string,
): Promise<void> {
  let lines: RecordedNotice[] = [];
  await waitUntil(
    async () => {
      lines = (await session.notices()).slice(from);
      return lines.length >= expected.length;
    },
    recorderTimeoutMs,
    `the notification recorder never answered ${when}, so the journey stops before anything could reach the system`,
  );
  assert.deepEqual(lines, expected, `the recorder held ${JSON.stringify(lines)} ${when}`);
}

async function recorded(
  session: AppSession,
  expected: Shown[],
  when: string,
  timeoutMs = promptTimeoutMs,
): Promise<RecordedNotice[]> {
  let lines: RecordedNotice[] = [];
  await waitUntil(
    async () => {
      lines = await session.notices();
      return shownOf(lines).length >= expected.length;
    },
    timeoutMs,
    () => `${when} the recorder held ${JSON.stringify(shownOf(lines))}`,
  );
  assert.deepEqual(
    shownOf(lines),
    expected,
    `${when} the recorder held ${JSON.stringify(shownOf(lines))}`,
  );
  return lines;
}

async function countsAre(session: AppSession, expected: number[], when: string): Promise<void> {
  let counts: number[] = [];
  const failure = () =>
    `${when} the app icon counts were ${JSON.stringify(counts)}, not ${JSON.stringify(expected)}`;
  await waitUntil(
    async () => {
      counts = countsOf(await session.notices());
      return counts.length >= expected.length;
    },
    promptTimeoutMs,
    failure,
  );
  assert.deepEqual(counts, expected, failure());
}

async function stillShown(session: AppSession, expected: Shown[], when: string): Promise<void> {
  await delay(settleMs);
  const shown = shownOf(await session.notices());
  assert.deepEqual(shown, expected, `${when} the recorder held ${JSON.stringify(shown)}`);
}

async function rowsAre(session: AppSession, expected: string[]): Promise<void> {
  const rows = session.page.getByTestId("inbox").locator("button");
  let order: string[] = [];
  await waitUntil(
    async () => {
      order = await rows.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-testid") ?? ""),
      );
      return order.join() === expected.join();
    },
    promptTimeoutMs,
    () => `the inbox listed ${JSON.stringify(order)} instead of ${JSON.stringify(expected)}`,
  );
}

async function select(session: AppSession, name: string): Promise<void> {
  await session.page.getByTestId(`workspace-repo-${name}`).click();
}

async function focusTerminal(session: AppSession): Promise<void> {
  await session.page.getByTestId("terminal").locator("textarea").focus();
  await terminalFocused(session);
}

async function terminalShows(session: AppSession, text: string, when: string): Promise<void> {
  const terminal = session.page.getByTestId("terminal");
  let read = "";
  await waitUntil(
    async () => {
      read = (await terminal.count()) === 0 ? "" : await terminal.innerText();
      return read.includes(text);
    },
    promptTimeoutMs,
    () =>
      `the terminal never showed ${JSON.stringify(text)} ${when}, it read ${JSON.stringify(read.slice(-300))}`,
  );
}

async function textIs(session: AppSession, testId: string, expected: string, when: string) {
  const element = session.page.getByTestId(testId);
  let read = "";
  await waitUntil(
    async () => {
      read = (await element.count()) === 0 ? "" : (await element.innerText()).trim();
      return read === expected;
    },
    promptTimeoutMs,
    () => `${testId} read ${JSON.stringify(read)} instead of ${JSON.stringify(expected)} ${when}`,
  );
}

async function attributeIs(
  session: AppSession,
  testId: string,
  name: string,
  when: string,
): Promise<void> {
  const element = session.page.getByTestId(testId);
  await waitUntil(
    async () => (await element.getAttribute(name)) === "true",
    promptTimeoutMs,
    `${testId} had no ${name} ${when}`,
  );
}

async function prompt(session: AppSession, name: string): Promise<void> {
  const before = (await session.standInEvents()).length;
  await session.page.keyboard.type("one");
  await session.page.keyboard.press("Enter");
  await stateIs(session, `workspace-repo-${name}-status`, "working", `after ${name}'s prompt`);
  const received = await standInInput(session, before);
  assert.equal(received, "one\r", `${name}'s stand-in received ${JSON.stringify(received)}`);
}

async function openRow(session: AppSession, name: string): Promise<void> {
  await session.page.getByTestId(`inbox-repo-${name}`).click();
  await attributeIs(session, `workspace-repo-${name}`, "aria-current", `after opening ${name}`);
  await attributeIs(session, "session-tab-1", "aria-selected", `after opening ${name}`);
  await terminalFocused(session);
}

async function answer(session: AppSession, name: string, shown: string): Promise<void> {
  await openRow(session, name);
  await session.page.keyboard.press("y");
  await terminalShows(session, shown, `after allowing in ${name}`);
}

async function commandMenu(session: AppSession): Promise<void> {
  await session.page.keyboard.press(menuShortcut);
  await visible(session, "palette-input", "after the command menu shortcut");
  await session.page.getByTestId("palette-input").fill("notifications");
}

async function firstNeed(session: AppSession): Promise<number> {
  const { page } = session;
  await textIs(session, "inbox-empty", "Nothing needs you right now.", "at launch");
  await textIs(session, "inbox-count", "0", "at launch");
  await select(session, "alpha");
  await startClaude(session, 1);
  await prompt(session, "alpha");
  await page.keyboard.press("Enter");
  await terminalShows(session, "Allow Bash for both", "after alpha's second Enter");
  await stateIs(session, "workspace-repo-alpha-status", "needs-you", "after alpha asked");
  const asked = (await session.standInEvents()).length;
  await page.getByTestId("new-session").click();
  await visible(session, "session-tab-2", "after a second session in alpha");
  await waitUntil(
    async () => (await claudePids(session)).length === 2,
    promptTimeoutMs,
    "alpha's second tab started no stand-in",
  );
  await select(session, "beta");
  await visible(session, "inbox-repo-alpha", "with beta selected");
  await textIs(session, "inbox-repo-alpha-reason", "Session 1 needs you.", "with beta selected");
  await textIs(session, "inbox-count", "1", "with alpha asking");
  await recorded(session, [alphaNotice], "after alpha asked,");
  await countsAre(session, [0, 1], "after alpha asked,");
  await stillShown(
    session,
    [alphaNotice],
    "after a permission notice and a helper asked in alpha,",
  );
  return asked;
}

async function openAndAnswer(session: AppSession, asked: number): Promise<void> {
  await openRow(session, "alpha");
  await terminalShows(session, "Allow Bash for both", "on the tab the inbox opened");
  await session.page.keyboard.press("z");
  let typed = "";
  await waitUntil(
    async () => {
      typed = await standInInput(session, asked);
      return typed.includes("z");
    },
    promptTimeoutMs,
    () => `the marker key never reached alpha's stand-in, which read ${JSON.stringify(typed)}`,
  );
  assert.equal(
    typed,
    "z",
    `opening alpha from the inbox typed ${JSON.stringify(typed)} before the marker`,
  );
  await session.page.keyboard.press("y");
  await terminalShows(session, "Allowed.", "after allowing in alpha");
  await visible(session, "inbox-empty", "after alpha was answered");
  await recorded(session, [alphaNotice, closed], "after alpha was answered,");
  await countsAre(session, [0, 1, 0], "after alpha was answered,");
}

async function askAgainAndFold(session: AppSession): Promise<void> {
  const { page } = session;
  for (const [name, count] of [
    ["beta", 3],
    ["main", 4],
  ] as const) {
    await select(session, name);
    await startClaude(session, count);
    await prompt(session, name);
  }
  await select(session, "alpha");
  await terminalShows(session, "Allowed.", "back in alpha");
  await focusTerminal(session);
  const started = Date.now();
  await page.keyboard.press("Enter");
  for (const name of ["beta", "main"]) {
    await select(session, name);
    await focusTerminal(session);
    await page.keyboard.press("Enter");
  }
  const took = Date.now() - started;
  for (const name of ["alpha", "beta", "main"]) {
    await visible(session, `inbox-repo-${name}`, "after three workspaces asked");
  }
  await rowsAre(session, ["inbox-repo-main", "inbox-repo-beta", "inbox-repo-alpha"]);
  assert.ok(
    took < noticeGapMs,
    `pressing Enter in three workspaces took ${String(took)} ms, longer than the ${String(noticeGapMs)} ms gap, so the fold cannot be read`,
  );
  await textIs(session, "inbox-count", "3", "with three workspaces asking");
  await recorded(
    session,
    [alphaNotice, closed, alphaNotice, closed, foldedNotice],
    "after alpha asked again and beta and main asked in its gap,",
  );
  await countsAre(session, [0, 1, 0, 1, 2, 3], "with three workspaces asking,");
  await session.screenshot("inbox-three");
  await answer(session, "beta", "Allowed.");
  await answer(session, "main", "Allowed.");
  await recorded(
    session,
    [alphaNotice, closed, alphaNotice, closed, foldedNotice, closed],
    "after beta and main were answered,",
  );
  await countsAre(session, [0, 1, 0, 1, 2, 3, 2, 1], "with only alpha asking,");
}

async function switchedOff(session: AppSession): Promise<void> {
  const { page } = session;
  const before = [alphaNotice, closed, alphaNotice, closed, foldedNotice, closed];
  await commandMenu(session);
  await page.getByTestId("command-notifications-off").click();
  await toastReads(session, turnedOff, "after turning notifications off,");
  await select(session, "alpha");
  await terminalShows(session, "Allow Bash again", "with alpha already shown");
  await answer(session, "alpha", "Allowed again.");
  await countsAre(session, [0, 1, 0, 1, 2, 3, 2, 1, 0], "after alpha was answered again,");
  await page.keyboard.press("Enter");
  await terminalShows(session, "Allow Bash once more", "after alpha's next Enter");
  await visible(session, "inbox-repo-alpha", "with notifications off");
  await textIs(session, "inbox-count", "1", "with notifications off");
  await countsAre(session, [0, 1, 0, 1, 2, 3, 2, 1, 0, 1], "with notifications off,");
  await stillShown(session, before, "with notifications off and alpha asking,");
  await page.keyboard.press("y");
  await terminalShows(session, "Done.", "after the last approval");
  await stateIs(session, "workspace-repo-alpha-status", "done", "after the turn ended");
  await visible(session, "inbox-empty", "after alpha was done");
  await countsAre(session, [0, 1, 0, 1, 2, 3, 2, 1, 0, 1, 0], "after alpha was done,");
}

async function offWhileShown(session: AppSession): Promise<void> {
  const { page } = session;
  await commandMenu(session);
  await page.getByTestId("command-notifications-on").click();
  await toastReads(session, turnedOn, "after turning notifications on,");
  await select(session, "beta");
  await focusTerminal(session);
  await page.keyboard.press("Enter");
  await terminalShows(session, "Allow Bash again", "after beta's next Enter");
  await recorded(
    session,
    [alphaNotice, closed, alphaNotice, closed, foldedNotice, closed, betaNotice],
    "after notifications came back on and beta asked,",
  );
  await countsAre(session, [0, 1, 0, 1, 2, 3, 2, 1, 0, 1, 0, 1], "after beta asked again,");
  await commandMenu(session);
  await page.getByTestId("command-notifications-off").click();
  await toastReads(session, turnedOff, "after turning notifications off again,");
  await recorded(
    session,
    [alphaNotice, closed, alphaNotice, closed, foldedNotice, closed, betaNotice, closed],
    "after notifications were turned off with beta's notification shown,",
  );
}

async function keptAfterRestart(session: AppSession): Promise<void> {
  const pids = await claudePids(session);
  const before = (await session.notices()).length;
  await session.relaunch();
  await recorderAnswers(
    session,
    before,
    [cleared, cleared],
    "after quitting with beta asking and launching again",
  );
  const saved = savedInterface.parse(
    JSON.parse(await readFile(join(session.home, "interface.json"), "utf8")),
  );
  assert.equal(saved.notifications, false, "interface.json did not keep notifications off");
  await commandMenu(session);
  await visible(session, "command-notifications-on", "in the command menu after the restart");
  const off = await session.page.getByTestId("command-notifications-off").count();
  assert.equal(off, 0, "the command menu offered to turn notifications off after the restart");
  await waitUntil(
    () => pids.every(processGone),
    goneTimeoutMs,
    () =>
      `the stand-ins ${JSON.stringify(pids.filter((pid) => !processGone(pid)))} outlived the restart`,
  );
  await session.page.keyboard.press("Escape");
  await gone(session, "palette-input", "after closing the command menu");
  await attributeIs(session, "workspace-repo-beta", "aria-current", "after the restart");
  await startClaude(session, pids.length + 1);
  await prompt(session, "beta");
  await session.page.keyboard.press("Enter");
  await terminalShows(session, "Allow Bash for both", "in beta after the restart");
  await visible(session, "inbox-repo-beta", "with beta asking after the restart");
  await textIs(session, "inbox-count", "1", "with beta asking after the restart");
  await countsAre(
    session,
    [0, 1, 0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 0, 0, 1],
    "with beta asking after the restart,",
  );
  await delay(settleMs);
  const shown = shownOf((await session.notices()).slice(before));
  assert.deepEqual(
    shown,
    [],
    `with notifications kept off and beta asking after the restart, the recorder held ${JSON.stringify(shown)}`,
  );
}

export const inboxJourney: Journey = {
  name: "inbox",
  scenario: "inbox",
  async run(session) {
    await recorderAnswers(session, 0, [cleared], "at launch");
    const asked = await firstNeed(session);
    await openAndAnswer(session, asked);
    await askAgainAndFold(session);
    await switchedOff(session);
    await offWhileShown(session);
    await keptAfterRestart(session);
  },
};
