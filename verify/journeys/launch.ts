import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { generatedText, pasteIntoFocus, type AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { terminalText } from "../terminal-screen.ts";
import {
  claudePids,
  goneTimeoutMs,
  processGone,
  promptTimeoutMs,
  startClaude,
  waitUntil,
} from "./conditions.ts";

const columns = ["column-projects", "column-repository", "column-sessions"];
const pasteSize = 100_000;
const newlineSequence = "\u001b\r";
const box = "│ ok │";

async function receivedInput(session: AppSession): Promise<string> {
  return (await session.standInEvents())
    .flatMap((event) => (event.type === "input" ? [event.data] : []))
    .join("");
}

function firstDifference(received: string, expected: string): number {
  let index = 0;
  while (index < received.length && received[index] === expected[index]) index += 1;
  return index;
}

async function checkWindow(page: Page): Promise<void> {
  for (const column of columns) {
    await page
      .getByTestId(column)
      .waitFor()
      .catch(() => {
        throw new Error(`${column} is not visible`);
      });
  }
  await page
    .getByTestId("check-git")
    .filter({ hasText: /\d+\.\d+/ })
    .waitFor({ timeout: promptTimeoutMs })
    .catch(async () => {
      const git = await page.getByTestId("check-git").innerText();
      throw new Error(`check-git names no version, it reads "${git}"`);
    });
  const gh = await page.getByTestId("check-gh").innerText();
  assert.ok(gh.includes("octo-verify"), `check-gh does not name the account, it reads "${gh}"`);
}

async function checkDrawn(session: AppSession): Promise<void> {
  let read = "";
  await waitUntil(
    async () => {
      read = await terminalText(session.page);
      return read.includes(box);
    },
    promptTimeoutMs,
    () => `the terminal never drew the stand-in's box, it read ${JSON.stringify(read.slice(-300))}`,
  );
}

async function checkInput(session: AppSession): Promise<void> {
  const pasted = generatedText(pasteSize);
  const expected = `hello${newlineSequence}${pasted}`;
  await session.page.keyboard.type("hello");
  await session.page.keyboard.press("Shift+Enter");
  assert.ok(
    (await pasteIntoFocus(session.page, pasted)) !== undefined,
    "nothing had focus to paste into",
  );
  let received = "";
  await waitUntil(
    async () => {
      received = await receivedInput(session);
      return received.length >= expected.length;
    },
    promptTimeoutMs,
    () =>
      `the stand-in received ${String(received.length)} of ${String(expected.length)} characters`,
  );
  assert.ok(
    received === expected,
    `the stand-in received ${String(received.length)} characters for ${String(expected.length)}, first differing at ${String(firstDifference(received, expected))}`,
  );
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  await checkWindow(page);
  await session.answerFolderDialog(session.repo);
  await page.getByTestId("add-first-project").click();
  await page.getByTestId("files").waitFor({ timeout: promptTimeoutMs });
  const firstPid = await startClaude(session, 1);
  await checkDrawn(session);
  await checkInput(session);

  assert.ok(!processGone(firstPid), "the first stand-in was gone before the reload");
  const beforeReload = await claudePids(session);
  let alive = beforeReload;
  await page.reload();
  await waitUntil(
    () => {
      alive = beforeReload.filter((pid) => !processGone(pid));
      return alive.length === 0;
    },
    goneTimeoutMs,
    () => `the stand-ins ${JSON.stringify(alive)} still ran after the reload`,
  );
  await page.getByTestId("app-window").waitFor();

  const secondPid = await startClaude(session, beforeReload.length + 1);
  assert.ok(!processGone(secondPid), "the stand-in started after the reload is not running");
  const { exitedOnItsOwn } = await session.close();
  assert.ok(exitedOnItsOwn, "the app was still running 10 seconds after its window closed");
  await waitUntil(
    () => processGone(secondPid),
    goneTimeoutMs,
    `the second stand-in (pid ${String(secondPid)}) still ran after quit`,
  );
  assert.equal(
    session.consoleErrors.length,
    0,
    `the window logged ${String(session.consoleErrors.length)} console errors, the first is ${JSON.stringify(session.consoleErrors[0])}`,
  );
}

export const launchJourney: Journey = { name: "launch", scenario: "default", run };
