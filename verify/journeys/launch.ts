import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { generatedText, pasteIntoFocus, type AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  goneTimeoutMs,
  processGone,
  promptTimeoutMs,
  startClaude,
  waitUntil,
} from "./conditions.ts";

interface TerminalSize {
  cols: number;
  rows: number;
}

const columns = ["column-projects", "column-repository", "column-sessions"];
const pasteSize = 100_000;
const newlineSequence = "\u001b\r";
const shrinkPx = 200;
const smallestHeight = 300;

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

async function drawnTerminalSize(page: Page): Promise<TerminalSize | null> {
  return page.evaluate(() => {
    const terminal = document.querySelector('[data-testid="terminal"]');
    const rows = terminal?.querySelectorAll(".xterm-rows > div") ?? [];
    const measure = terminal?.querySelector(".xterm-char-measure-element");
    const firstRow = rows[0];
    if (measure === null || measure === undefined || firstRow === undefined) return null;
    const charWidth = measure.getBoundingClientRect().width / measure.textContent.length;
    return {
      cols: Math.round(firstRow.getBoundingClientRect().width / charWidth),
      rows: rows.length,
    };
  });
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

async function checkResize(session: AppSession): Promise<void> {
  const initial = await drawnTerminalSize(session.page);
  assert.ok(initial !== null, "the terminal draws no rows to measure");
  const before = (await session.standInEvents()).length;
  const inner = await session.page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await session.page.setViewportSize({
    width: inner.width,
    height: Math.max(smallestHeight, inner.height - shrinkPx),
  });
  let drawn: TerminalSize | null = null;
  let resizes: TerminalSize[] = [];
  await waitUntil(
    async () => {
      drawn = await drawnTerminalSize(session.page);
      resizes = (await session.standInEvents())
        .slice(before)
        .flatMap((event) =>
          event.type === "resize" ? [{ cols: event.cols, rows: event.rows }] : [],
        );
      const size = drawn;
      return (
        size !== null &&
        size.rows !== initial.rows &&
        resizes.some((resize) => resize.cols === size.cols && resize.rows === size.rows)
      );
    },
    promptTimeoutMs,
    () =>
      `the terminal went from ${JSON.stringify(initial)} to ${JSON.stringify(drawn)} and the stand-in got the resizes ${JSON.stringify(resizes)}`,
  );
}

async function checkDiff(page: Page): Promise<void> {
  const editor = page.getByTestId("diff").locator(".monaco-diff-editor");
  for (const side of ["original", "modified"]) {
    await editor
      .locator(`.editor.${side}`)
      .waitFor({ timeout: promptTimeoutMs })
      .catch(() => {
        throw new Error(`the diff showed no ${side} side`);
      });
  }
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  await checkWindow(page);
  await session.answerFolderDialog(session.repo);
  await page.getByTestId("add-first-project").click();
  await page.getByTestId("diff").waitFor({ timeout: promptTimeoutMs });
  const firstPid = await startClaude(session, 1);
  await checkInput(session);
  await checkResize(session);
  await checkDiff(page);
  await session.screenshot("launch");

  assert.ok(!processGone(firstPid), "the first stand-in was gone before the reload");
  await page.reload();
  await waitUntil(
    () => processGone(firstPid),
    goneTimeoutMs,
    `the first stand-in (pid ${String(firstPid)}) still ran after the reload`,
  );
  await page.getByTestId("app-window").waitFor();

  const secondPid = await startClaude(session, 2);
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
