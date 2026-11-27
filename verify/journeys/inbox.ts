import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { noticeGapMs } from "../../src/main/inbox/notices.ts";
import type { AppSession, RecordedNotice } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { terminalText } from "../terminal-screen.ts";
import {
  claudePids,
  goneTimeoutMs,
  processGone,
  promptTimeoutMs,
  standInInput,
  startClaude,
  stateIs,
  terminalFocused,
  visible,
  waitUntil,
} from "./conditions.ts";

type Shown = { kind: "notice"; title: string; body: string } | { kind: "close" };

const settleMs = noticeGapMs + 1000;
const recorderTimeoutMs = 15_000;
const alphaNotice: Shown = {
  kind: "notice",
  title: "alpha needs you",
  body: "Claude Code is waiting for you in repo.",
};
const closed: Shown = { kind: "close" };
const cleared: RecordedNotice = { kind: "badge", count: 0 };

function shownOf(lines: readonly RecordedNotice[]): Shown[] {
  return lines.flatMap((line) => (line.kind === "notice" || line.kind === "close" ? [line] : []));
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

async function stillShown(session: AppSession, expected: Shown[], when: string): Promise<void> {
  await delay(settleMs);
  const shown = shownOf(await session.notices());
  assert.deepEqual(shown, expected, `${when} the recorder held ${JSON.stringify(shown)}`);
}

async function select(session: AppSession, name: string): Promise<void> {
  await session.page.getByTestId(`workspace-repo-${name}`).click();
}

async function terminalShows(session: AppSession, text: string, when: string): Promise<void> {
  let read = "";
  await waitUntil(
    async () => {
      read = await terminalText(session.page);
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

async function firstNeed(session: AppSession): Promise<void> {
  await textIs(session, "inbox-empty", "Nothing needs you right now.", "at launch");
  await textIs(session, "inbox-count", "0", "at launch");
  await select(session, "alpha");
  await startClaude(session, 1);
  await prompt(session, "alpha");
  await session.page.keyboard.press("Enter");
  await terminalShows(session, "Allow Bash for both", "after alpha's second Enter");
  await stateIs(session, "workspace-repo-alpha-status", "needs-you", "after alpha asked");
  await select(session, "beta");
  await visible(session, "inbox-repo-alpha", "with beta selected");
  await textIs(session, "inbox-count", "1", "with alpha asking");
  await recorded(session, [alphaNotice], "after alpha asked,");
  await stillShown(session, [alphaNotice], "after a permission notice and a helper asked,");
}

async function openFromAgents(session: AppSession): Promise<void> {
  await session.page.getByTestId("open-agents").click();
  await textIs(session, "agent-repo-alpha-1", "alpha\nNeeds you · repo", "in Agents");
  await session.page.keyboard.press("Enter");
  await attributeIs(
    session,
    "workspace-repo-alpha",
    "aria-current",
    "after opening alpha from Agents",
  );
  await terminalFocused(session);
  await select(session, "beta");
}

async function openAndAnswer(session: AppSession): Promise<void> {
  await session.page.getByTestId("inbox-repo-alpha").click();
  await attributeIs(session, "workspace-repo-alpha", "aria-current", "after opening alpha");
  await terminalShows(session, "Allow Bash for both", "on the tab the inbox opened");
  await terminalFocused(session);
  await session.page.keyboard.press("y");
  await terminalShows(session, "Allowed.", "after allowing in alpha");
  await visible(session, "inbox-empty", "after alpha was answered");
  await recorded(session, [alphaNotice, closed], "after alpha was answered,");
}

async function keptAfterRestart(session: AppSession): Promise<void> {
  await session.page.keyboard.press("Enter");
  await terminalShows(session, "Allow Bash again", "after alpha's next Enter");
  await textIs(session, "inbox-count", "1", "with alpha asking again");
  await recorded(session, [alphaNotice, closed, alphaNotice], "after alpha asked again,");
  const pids = await claudePids(session);
  const before = (await session.notices()).length;
  await session.relaunch();
  await recorderAnswers(
    session,
    before,
    [cleared, closed, cleared],
    "after quitting with alpha asking and launching again",
  );
  await waitUntil(
    () => pids.every(processGone),
    goneTimeoutMs,
    () =>
      `the stand-ins ${JSON.stringify(pids.filter((pid) => !processGone(pid)))} outlived the restart`,
  );
  await waitUntil(
    async () => (await claudePids(session)).length === pids.length + 1,
    promptTimeoutMs,
    "alpha did not resume by itself after the restart",
  );
  await terminalShows(session, "Resumed session", "in alpha after the restart");
  await session.page.getByTestId("terminal").locator("textarea").focus();
  await prompt(session, "alpha");
  await session.page.keyboard.press("Enter");
  await terminalShows(session, "Allow Bash for both", "in alpha after the restart");
  await visible(session, "inbox-repo-alpha", "with alpha asking after the restart");
  await textIs(session, "inbox-count", "1", "with alpha asking after the restart");
}

export const inboxJourney: Journey = {
  name: "inbox",
  scenario: "inbox",
  async run(session) {
    await recorderAnswers(session, 0, [cleared], "at launch");
    await firstNeed(session);
    await openFromAgents(session);
    await openAndAnswer(session);
    await keptAfterRestart(session);
  },
};
