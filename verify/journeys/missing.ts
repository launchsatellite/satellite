import assert from "node:assert/strict";
import { chmod, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { promptTimeoutMs, toastReads, visible, waitUntil } from "./conditions.ts";

const commandModifier = process.platform === "darwin" ? "Meta" : "Control+Shift";
const missing = "Satellite can't find Claude Code. Install it, then start it again.";
const noSession = "No Claude Code session here yet.";
const banner = "Claude Code is here now";
const tabs = '[data-testid^="session-tab-"]';

async function emptyReads(session: AppSession, expected: string, when: string): Promise<void> {
  const empty = session.page.getByTestId("sessions-empty");
  let read = "";
  await waitUntil(
    async () => {
      read = (await empty.count()) === 0 ? "" : await empty.innerText();
      return read === expected;
    },
    promptTimeoutMs,
    () => `${when} the empty pane read "${read}" instead of "${expected}"`,
  );
}

async function tabCount(session: AppSession, expected: number, when: string): Promise<void> {
  await waitUntil(
    async () => (await session.page.locator(tabs).count()) === expected,
    promptTimeoutMs,
    `${when} the pane did not hold ${String(expected)} tabs`,
  );
}

async function bannerShown(session: AppSession, when: string): Promise<void> {
  await waitUntil(
    async () =>
      (await session.page.getByTestId("terminal").textContent())?.includes(banner) === true,
    promptTimeoutMs,
    `${when} the terminal never showed Claude Code`,
  );
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  await session.answerFolderDialog(session.repo);
  await page.keyboard.press(`${commandModifier}+O`);
  await page.getByTestId("workspace-repo-main").click({ timeout: promptTimeoutMs });
  await page.getByTestId("start-claude").click({ timeout: promptTimeoutMs });
  await emptyReads(session, missing, "with Claude Code missing,");
  await visible(session, "claude-missing-fix", "with Claude Code missing");
  await tabCount(session, 0, "with Claude Code missing,");
  if (process.platform === "win32") return;

  const claude = join(session.home, "..", "missing-claude");
  await writeFile(claude, `#!/bin/sh\nprintf '${banner}\\n'\nwhile read -r line; do :; done\n`);
  await chmod(claude, 0o755);
  await page.keyboard.press(`${commandModifier}+T`);
  await bannerShown(session, "once Claude Code was installed and started by its shortcut,");
  await page.locator('[data-testid^="close-session-"]').first().click();
  await emptyReads(session, noSession, "after a start worked,");

  await page.getByTestId("start-claude").click();
  await bannerShown(session, "with Claude Code installed,");
  await unlink(claude);
  await page.getByTestId("new-session").click();
  await toastReads(session, missing, "with another tab open and Claude Code gone,");
  await tabCount(session, 1, "after a start found no Claude Code beside another tab,");
  const { leftover } = await session.close();
  assert.equal(leftover, undefined, `the temp folder ${String(leftover)} was left behind`);
}

export const missingJourney: Journey = { name: "missing", scenario: "claude-missing", run };
