import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  gone,
  promptTimeoutMs,
  startClaude,
  toastReads,
  visible,
  waitUntil,
} from "./conditions.ts";

type GuideStep = 1 | 2 | 3 | 4;

const commandModifier = process.platform === "darwin" ? "Meta" : "Control+Shift";
const closedSentence = "The guide is closed. Show the guide in the command menu opens it again.";
const savedFile = z.object({ version: z.literal(6), guideSeen: z.literal(true) });
const titles: Record<GuideStep, string> = {
  1: "make a workspace",
  2: "start Claude Code",
  3: "read what it did",
  4: "orange means you",
};

async function stepShows(session: AppSession, step: GuideStep, when: string): Promise<void> {
  const card = session.page.locator(`[data-testid="guide-card"][data-step="${String(step)}"]`);
  await card.waitFor({ state: "visible", timeout: promptTimeoutMs }).catch(() => {
    throw new Error(`the card for step ${String(step)} did not show ${when}`);
  });
  const title = ((await session.page.getByTestId("guide-title").textContent()) ?? "").trim();
  assert.equal(title, titles[step], `the title of step ${String(step)} ${when}`);
}

async function savedAsSeen(session: AppSession): Promise<void> {
  let read = "";
  await waitUntil(
    async () => {
      read = await readFile(join(session.home, "interface.json"), "utf8").catch(() => "");
      try {
        return savedFile.safeParse(JSON.parse(read)).success;
      } catch {
        return false;
      }
    },
    promptTimeoutMs,
    () => `interface.json did not hold version 6 with guideSeen true, it read ${read.slice(0, 80)}`,
  );
}

async function showGuide(session: AppSession): Promise<void> {
  await session.page.keyboard.press(`${commandModifier}+K`);
  await session.page.getByTestId("palette-input").fill("guide");
  await visible(session, "command-guide-show", "in the command menu for guide");
  await session.page.keyboard.press("Enter");
}

async function noGuideAfterRestart(session: AppSession, when: string): Promise<void> {
  await session.relaunch();
  await visible(session, "new-workspace-repo", `after the restart ${when}`);
  assert.equal(
    await session.page.getByTestId("guide-card").count(),
    0,
    `the guide came back after the restart ${when}`,
  );
}

async function run(session: AppSession): Promise<void> {
  await session.answerFolderDialog(session.repo);
  await session.page.getByTestId("add-first-project").click({ timeout: promptTimeoutMs });
  await stepShows(session, 1, "after the first project");

  await session.relaunch();
  await stepShows(session, 1, "after a restart in the middle");
  await session.page.getByTestId("new-workspace-repo").click();
  await visible(session, "create-workspace", "after New workspace was pressed");
  await session.page.getByTestId("create-workspace").click();
  await stepShows(session, 2, "after making a workspace");
  await startClaude(session, 1);
  await stepShows(session, 3, "after a session started");
  await session.page.getByTestId("guide-next").click();
  await stepShows(session, 4, "after Next from step 3");
  await session.page.getByTestId("guide-done").click();
  await gone(session, "guide-card", "after Done");
  await savedAsSeen(session);
  await noGuideAfterRestart(session, "after Done");

  await showGuide(session);
  await stepShows(session, 2, "after Show the guide");

  assert.deepEqual(session.consoleErrors, [], "the window logged errors");
}

async function closedEarly(session: AppSession): Promise<void> {
  await session.answerFolderDialog(session.repo);
  await session.page.getByTestId("add-first-project").click({ timeout: promptTimeoutMs });
  await stepShows(session, 1, "after the first project");
  await session.page.getByTestId("guide-close").click();
  await gone(session, "guide-card", "after the close control");
  await toastReads(session, closedSentence, "after closing the guide early");
  await savedAsSeen(session);
  await noGuideAfterRestart(session, "after closing the guide early");

  assert.deepEqual(session.consoleErrors, [], "the window logged errors");
}

export const guideJourney: Journey = {
  name: "guide",
  scenario: "first-run",
  run,
  then: [{ name: "guide", scenario: "first-run", run: closedEarly }],
};
