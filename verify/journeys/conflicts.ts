import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { withoutGitVariables } from "../repo-recipe.ts";
import { promptTimeoutMs, startClaude, stateIs, waitUntil } from "./conditions.ts";

const execute = promisify(execFile);
const waitMs = 15_000;
const request = "Update this branch from origin/main and resolve the conflicts.";
const bannerSentence = "origin/main moved, and 1 file conflicts with this branch.";
const oldGitSentence = "Satellite needs git 2.38 or newer to check for conflicts with origin/main.";

function worktree(session: AppSession): string {
  return join(session.home, "worktrees", "repo", "alpha");
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function git(session: AppSession, args: string[]): Promise<void> {
  await execute("git", args, {
    cwd: worktree(session),
    env: { ...withoutGitVariables(process.env), ...session.gitEnv },
    windowsHide: true,
  });
}

async function nudge(session: AppSession): Promise<void> {
  await session.page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function bannerText(session: AppSession): Promise<string> {
  return session.page
    .getByTestId("changes-banner")
    .evaluateAll((banners) => (banners[0] instanceof HTMLElement ? banners[0].innerText : ""));
}

async function bannerReads(session: AppSession, expected: string, when: string): Promise<void> {
  let shown = "";
  await waitUntil(
    async () => {
      await nudge(session);
      shown = await bannerText(session);
      return shown.includes(expected);
    },
    waitMs,
    () => `${when} the banner read ${JSON.stringify(shown)} instead of ${JSON.stringify(expected)}`,
  );
}

async function offersTheButtonWhenNarrow(session: AppSession): Promise<void> {
  const { page } = session;
  await page.setViewportSize({ width: 1024, height: 645 });
  await bannerReads(session, bannerSentence.split(" ")[0] ?? "", "in a narrow window");
  const box = await page.getByTestId("changes-banner-send").boundingBox();
  const right = (box?.x ?? 0) + (box?.width ?? 0);
  const rowRight = await page
    .getByTestId("changes-banner")
    .evaluate((banner) => banner.getBoundingClientRect().right);
  assert.ok(
    box !== null && right <= rowRight + 1,
    `the banner's button ended at ${String(right)}, past the banner's edge at ${String(rowRight)}`,
  );
}

async function leavesNothing(session: AppSession, when: string): Promise<void> {
  const marker = join(session.userHome, "merge-driver-ran");
  assert.ok(!(await exists(marker)), `the repository's merge driver ran ${when}`);
  let left: string[] = [];
  await waitUntil(
    async () => {
      left = await readdir(join(session.home, "quarantine")).catch(() => []);
      return left.length === 0;
    },
    waitMs,
    () => `the quarantine folder held ${JSON.stringify(left)} ${when}`,
  );
}

async function namesTheConflict(session: AppSession): Promise<void> {
  await session.page.getByTestId("workspace-repo-alpha").click();
  await bannerReads(session, bannerSentence, "on opening the workspace");
  let files = "";
  await waitUntil(
    async () => {
      files = await session.page
        .getByTestId("changes-banner-files")
        .evaluateAll((names) => names[0]?.textContent ?? "");
      return files === "shared.txt";
    },
    waitMs,
    () => `the banner named ${JSON.stringify(files)}`,
  );
  const live = await session.page.locator('[role="status"] [data-testid="changes-banner"]').count();
  assert.equal(live, 1, "the banner is not inside a polite live region");
  const colour = await session.page
    .getByTestId("changes-banner")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(colour, "rgba(0, 0, 0, 0)", "the banner has no calm background");
  await leavesNothing(session, "while checking for conflicts");
}

async function contentTop(session: AppSession): Promise<number> {
  return session.page
    .getByRole("tabpanel", { name: "Changes" })
    .evaluate((panel) => panel.getBoundingClientRect().top);
}

async function staysPut(session: AppSession): Promise<void> {
  const top = () => contentTop(session);
  const before = await top();
  await session.page.getByTestId("changes-view-uncommitted").click();
  await bannerReads(session, bannerSentence, "in Uncommitted");
  const after = await top();
  assert.equal(
    after,
    before,
    `the content moved when the view changed, from ${String(before)} to ${String(after)}, and read ${String(await top())} a moment later`,
  );
  await session.page.getByTestId("changes-view-branch").click();
}

async function sendsTheRequest(session: AppSession): Promise<void> {
  const { page } = session;
  await startClaude(session, 1);
  await page.keyboard.press("Enter");
  await stateIs(session, "session-tab-1", "done", "after the first prompt");
  const before = (await session.standInEvents()).length;
  await page.getByTestId("changes-banner-send").click();
  let typed = "";
  await waitUntil(
    async () => {
      typed = (await session.standInEvents())
        .slice(before)
        .flatMap((event) => (event.type === "input" ? [event.data] : []))
        .join("");
      return typed.includes(request);
    },
    promptTimeoutMs,
    () => `the prompt received ${JSON.stringify(typed)}`,
  );
  assert.equal(
    typed,
    `\u001b[200~${request}\u001b[201~`,
    `the prompt received ${JSON.stringify(typed)}`,
  );
  assert.ok(!typed.includes("\r"), "the request was submitted");
}

async function goesWhenResolved(session: AppSession): Promise<void> {
  const shownTop = await contentTop(session);
  const bannerHeight = await session.page
    .getByTestId("changes-banner")
    .evaluate((banner) => banner.getBoundingClientRect().height);
  await git(session, ["revert", "--no-edit", "HEAD"]);
  await waitUntil(
    async () => {
      await nudge(session);
      return (await bannerText(session)) === "";
    },
    waitMs,
    "the banner stayed after the conflict was resolved",
  );
  const freedTop = await contentTop(session);
  assert.equal(freedTop, shownTop - bannerHeight, "the empty strip kept its space");
  await leavesNothing(session, "after the conflict was resolved");
}

async function saysItNeedsANewerGit(session: AppSession): Promise<void> {
  await session.relaunch(async () => {
    await writeFile(join(session.home, "git-version"), "2.35.0\n");
  });
  await session.page.getByTestId("workspace-repo-alpha").click();
  await bannerReads(session, oldGitSentence, "on a git older than 2.38");
  assert.equal(
    await session.page.getByTestId("changes-banner-send").count(),
    0,
    "the old git sentence offered a request",
  );
  await leavesNothing(session, "on an old git");
}

export const conflictsJourney: Journey = {
  name: "conflicts",
  scenario: "conflict-with-base",
  async run(session) {
    await namesTheConflict(session);
    await offersTheButtonWhenNarrow(session);
    await staysPut(session);
    await sendsTheRequest(session);
    await goesWhenResolved(session);
    await saysItNeedsANewerGit(session);
    await session.screenshot("conflicts");
    assert.deepEqual(session.consoleErrors, [], "the window logged errors");
  },
};
