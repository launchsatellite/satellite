import assert from "node:assert/strict";
import { join } from "node:path";
import type { AppSession, RecordedNotice } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  hooksAnswered,
  promptTimeoutMs,
  standInInput,
  startClaude,
  stateIs,
  terminalFocused,
  visible,
  waitUntil,
} from "./conditions.ts";

const showMs = 15_000;
const noticeBody = "The pull request needs you in repo.";
const alphaNotice = { kind: "notice", title: "alpha needs you", body: noticeBody } as const;
const closed = { kind: "close" } as const;

function alphaFolder(session: AppSession): string {
  return join(session.home, "worktrees", "repo", "alpha");
}

function shownOf(lines: readonly RecordedNotice[]) {
  return lines.flatMap((line) => (line.kind === "notice" || line.kind === "close" ? [line] : []));
}

async function select(session: AppSession, name: string): Promise<void> {
  await session.page.getByTestId(`workspace-repo-${name}`).click();
}

async function attributeIs(
  session: AppSession,
  testId: string,
  name: string,
  expected: string,
  when: string,
): Promise<void> {
  const element = session.page.getByTestId(testId);
  let read: string | null = null;
  await waitUntil(
    async () => {
      read = (await element.count()) === 0 ? null : await element.getAttribute(name);
      return read === expected;
    },
    showMs,
    () => `${testId} ${name} read ${JSON.stringify(read)} instead of ${expected} ${when}`,
  );
}

async function textHolds(
  session: AppSession,
  testId: string,
  expected: string,
  when: string,
): Promise<void> {
  const element = session.page.getByTestId(testId);
  let read = "";
  await waitUntil(
    async () => {
      read = (await element.count()) === 0 ? "" : (await element.innerText()).trim();
      return read.includes(expected);
    },
    showMs,
    () => `${testId} read ${JSON.stringify(read.slice(0, 200))} without ${expected} ${when}`,
  );
}

async function ghEvents(session: AppSession) {
  return (await session.standInEvents()).flatMap((event) =>
    event.type === "start" && event.tool === "gh" ? [event] : [],
  );
}

async function endTurn(session: AppSession, typed: boolean): Promise<void> {
  const stops = await hooksAnswered(session, "Stop");
  await session.page.getByTestId("terminal").locator("textarea").focus();
  await terminalFocused(session);
  if (typed) await session.page.keyboard.type("one");
  await session.page.keyboard.press("Enter");
  await waitUntil(
    async () => (await hooksAnswered(session, "Stop")) > stops,
    promptTimeoutMs,
    "the stand-in ended no turn",
  );
}

async function inboxReads(session: AppSession, sentence: string, when: string): Promise<void> {
  await visible(session, "inbox-repo-alpha", when);
  await attributeIs(session, "inbox-repo-alpha", "data-reason", "pull-request", when);
  await textHolds(session, "inbox-repo-alpha-reason", sentence, when);
}

async function rowGone(session: AppSession, when: string): Promise<void> {
  await visible(session, "inbox-empty", when);
}

async function showTab(session: AppSession): Promise<void> {
  await session.page.getByTestId("centre-tab-pull-request").click();
}

async function openTab(session: AppSession): Promise<void> {
  await showTab(session);
  await visible(session, "pull-request-title", "after opening the Pull request tab");
}

async function startedClaude(session: AppSession): Promise<void> {
  await select(session, "alpha");
  await startClaude(session, 1);
}

async function openedFromInbox(session: AppSession): Promise<void> {
  await session.page.getByTestId("inbox-repo-alpha").click();
  await attributeIs(session, "pull-request", "data-state", "found", "after the row opened it");
}

async function noticesAre(session: AppSession, expected: unknown[], when: string): Promise<void> {
  let shown: unknown[] = [];
  await waitUntil(
    async () => {
      shown = shownOf(await session.notices());
      return shown.length >= expected.length;
    },
    showMs,
    () => `${when} the recorder held ${JSON.stringify(shown)}`,
  );
  assert.deepEqual(shown, expected, `${when} the recorder held ${JSON.stringify(shown)}`);
}

async function opened(session: AppSession): Promise<void> {
  await select(session, "alpha");
  await attributeIs(session, "centre-tab-pull-request", "data-number", "12", "without a click");
  await openTab(session);
  await waitUntil(
    async () => (await session.page.getByTestId("pull-request-body").locator("table").count()) > 0,
    showMs,
    "the description's table never drew",
  );
  const events = await ghEvents(session);
  const folders = new Set([session.repo, alphaFolder(session)]);
  for (const event of events) {
    const known = event.call !== null && event.call !== undefined;
    const tool = event.args[0] === "--version" || event.args[0] === "auth";
    assert.ok(
      known || tool,
      `gh ran with arguments Satellite never sends, ${event.args.join(" ")}`,
    );
    if (known) assert.ok(folders.has(event.cwd ?? ""), `gh ran in ${event.cwd ?? "no folder"}`);
  }
  assert.deepEqual(session.consoleErrors, [], "the window logged console errors");
}

async function appears(session: AppSession): Promise<void> {
  await select(session, "alpha");
  await showTab(session);
  await textHolds(
    session,
    "pull-request-sentence",
    "No pull request for this branch yet.",
    "without a pull request",
  );
  await startClaude(session, 1);
  await session.mark("opened");
  await endTurn(session, true);
  await attributeIs(session, "centre-tab-pull-request", "data-number", "12", "after the turn");
  const asked = (await ghEvents(session)).map((event) => event.args.join(" "));
  assert.ok(
    asked.some((line) => line.startsWith("pr view 12 ")),
    "the stranger's newer pull request was not set aside for the one a writer opened",
  );
  assert.ok(
    !asked.some((line) => line.startsWith("pr view 13 ")),
    "a stranger's pull request was read by number",
  );
}

async function checksFailed(session: AppSession): Promise<void> {
  await inboxReads(session, "Checks failed on the pull request.", "after launch");
  await noticesAre(session, [alphaNotice], "after the checks failed,");
  const notice = shownOf(await session.notices())[0];
  assert.ok(
    notice?.kind === "notice" &&
      !/12|Greet/.test(`${notice.title} ${notice.body}`.replace("alpha", "")),
    "the notice held something the pull request said",
  );
  await startedClaude(session);
  await openedFromInbox(session);
  await session.page.getByTestId("pull-request-section-checks").click();
  const toggle = session.page.locator(
    '[data-testid^="pull-request-check-"][data-testid$="-toggle"]',
  );
  await toggle.click();
  const id = (await toggle.getAttribute("data-testid"))?.replace(/-toggle$/, "") ?? "";
  await textHolds(session, `${id}-lines`, "Unexpected var", "in the failing check's log");
  await session.mark("fixed");
  await endTurn(session, true);
  await rowGone(session, "after the checks passed");
  await noticesAre(session, [alphaNotice, closed], "after the checks passed,");
}

async function changesRequested(session: AppSession): Promise<void> {
  const { page } = session;
  await inboxReads(session, "A review asks for changes.", "after launch");
  await startedClaude(session);
  await openedFromInbox(session);
  await page.getByTestId("pull-request-section-files").click();
  await visible(session, "thread-panel", "in the Files section");
  await waitUntil(
    async () => (await page.locator(".thread-mark").count()) === 1,
    showMs,
    "the diff did not hold exactly one thread mark",
  );
  await session.mark("answered");
  await endTurn(session, true);
  await rowGone(session, "after the review was answered");
  await page.getByTestId("pull-request-section-conversation").click();
  const resolved = page.locator('li[data-kind="thread"][data-resolved="true"]');
  await resolved.waitFor();
  const item = (await resolved.getAttribute("data-testid")) ?? "";
  await page.getByTestId(`${item}-open`).click();
  await textHolds(session, "link-dialog", "pull/12#discussion_r3003", "after Open on GitHub");
  await page.keyboard.press("Escape");
  const from = (await session.standInEvents()).length;
  await page
    .locator('li[data-kind="thread"][data-resolved="false"]')
    .first()
    .locator('[data-testid$="-send"]')
    .click();
  let typed = "";
  await waitUntil(
    async () => {
      typed = await standInInput(session, from);
      return typed.includes("pull/12#discussion_r3001");
    },
    showMs,
    () => `Send to Claude Code typed ${JSON.stringify(typed.slice(0, 200))} without its thread`,
  );
  assert.ok(
    !/discussion_r300[23]/.test(typed),
    "Send to Claude Code typed another thread's address",
  );
}

async function conflicts(session: AppSession): Promise<void> {
  await inboxReads(session, "The pull request has conflicts.", "after launch");
  await startedClaude(session);
  await endTurn(session, true);
  await openedFromInbox(session);
  const before = (await session.standInEvents()).length;
  await session.page.getByTestId("pull-request-conflict-send").click();
  await waitUntil(
    async () =>
      (await standInInput(session, before)).includes(
        "Update this branch from main and resolve the conflicts.",
      ),
    showMs,
    "the conflict request never reached Claude Code",
  );
  await session.mark("updated");
  await endTurn(session, false);
  await rowGone(session, "after the branch was updated");
}

async function hostile(session: AppSession): Promise<void> {
  const { page } = session;
  const title = await page.title();
  await select(session, "alpha");
  await openTab(session);
  await waitUntil(
    async () => (await page.getByTestId("markdown-link").count()) > 0,
    showMs,
    "the description drew no link",
  );
  const bare = async () => {
    const counts = await page
      .getByTestId("pull-request")
      .evaluate((root) =>
        ["img", "script", "iframe", "style", "form", "a[href]"].map(
          (selector) => `${selector} ${String(root.querySelectorAll(selector).length)}`,
        ),
      );
    assert.deepEqual(
      counts,
      ["img 0", "script 0", "iframe 0", "style 0", "form 0", "a[href] 0"],
      "the pull request page held elements a pull request must never create",
    );
    assert.equal(await page.title(), title, "a pull request changed the document title");
  };
  await bare();
  const written = await page.getByTestId("pull-request").innerText();
  assert.ok(written.includes("<script>document.title"), "raw HTML was not shown as literal text");
  const addresses = await page
    .getByTestId("markdown-link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("data-address") ?? ""));
  assert.ok(
    addresses.every((address) => address.startsWith("https://")),
    `a link held ${JSON.stringify(addresses)}`,
  );
  await page.locator('[data-address="https://evil.example.invalid/phish"]').click();
  await textHolds(session, "link-dialog", "evil.example.invalid/phish", "after the lookalike link");
  await page.keyboard.press("Escape");
  await textHolds(
    session,
    "pull-request-body-cut",
    "The rest is on GitHub.",
    "after the long body",
  );
  await page.getByTestId("pull-request-section-checks").click();
  await textHolds(session, "pull-request-check-0", "--repo evil/x", "in the checks");
  await bare();
  await page.getByTestId("pull-request-section-conversation").click();
  await visible(session, "pull-request-item-0", "in the conversation");
  await bare();
  const events = await ghEvents(session);
  assert.ok(
    events.every((event) => !event.args.join(" ").includes("--repo evil/x")),
    "a check name reached a gh argument",
  );
}

async function signedOut(session: AppSession): Promise<void> {
  await select(session, "alpha");
  await showTab(session);
  await textHolds(
    session,
    "pull-request-sentence",
    "The GitHub CLI is signed out. Run gh auth login in a terminal and come back.",
    "when gh is signed out",
  );
  await stateIs(session, "pull-request", "unavailable", "when gh is signed out");
}

const parts: Journey[] = [
  { name: "pull-request", scenario: "pr-appears", run: appears },
  { name: "pull-request", scenario: "checks-failed", run: checksFailed },
  { name: "pull-request", scenario: "changes-requested", run: changesRequested },
  { name: "pull-request", scenario: "pr-conflicts", run: conflicts },
  { name: "pull-request", scenario: "hostile-description", run: hostile },
  { name: "pull-request", scenario: "not-signed-in", run: signedOut },
];

export const pullRequestJourney: Journey = {
  name: "pull-request",
  scenario: "pr-open",
  run: opened,
  then: parts,
};
