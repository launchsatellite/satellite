import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { generatedText, pasteIntoFocus, type AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { readTerminal, type TerminalScreen } from "../terminal-screen.ts";
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
const logo = [
  "\u2590\u259b\u2588\u2588\u2588\u259c\u258c",
  "\u259d\u259c\u2588\u2588\u2588\u2588\u2588\u259b\u2598",
];
const box = "\u2502 ok \u2502";
const maxTerminals = 16;
const tooManyContexts = "Too many active WebGL contexts";
const codeTypes: Record<string, { fontFamily: string; fontSize: number; lineHeight: number }> = {
  darwin: { fontFamily: 'Menlo, Monaco, "Courier New", monospace', fontSize: 12, lineHeight: 1 },
  win32: { fontFamily: 'Consolas, "Courier New", monospace', fontSize: 14, lineHeight: 1 },
  linux: { fontFamily: '"Droid Sans Mono", monospace', fontSize: 14, lineHeight: 1.1 },
};

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
  const screen = await readTerminal(page);
  return screen === null ? null : { cols: screen.cols, rows: screen.rows };
}

async function gpuAvailable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const context = document.createElement("canvas").getContext("webgl2");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return context !== null;
  });
}

async function liveRenderers(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-renderer]")].map(
      (host) => host.getAttribute("data-renderer") ?? "",
    ),
  );
}

function typeProblem(screen: TerminalScreen | null, renderer: string): string | undefined {
  const expected = codeTypes[process.platform];
  if (expected === undefined) return `no code type is known for ${process.platform}`;
  if (screen === null) return "the terminal shows no screen";
  if (screen.renderer !== renderer) return `the terminal is drawn by ${screen.renderer}`;
  if (screen.fontFamily !== expected.fontFamily) return `the font is ${screen.fontFamily}`;
  if (screen.fontSize !== expected.fontSize) return `the size is ${String(screen.fontSize)}`;
  if (screen.lineHeight !== expected.lineHeight) {
    return `the line height is ${String(screen.lineHeight)}`;
  }
  const natural = screen.naturalLineHeight * expected.lineHeight;
  if (Math.abs(screen.cellHeight - natural) > 1) {
    return `a cell is ${String(screen.cellHeight)} tall where the font's own line box is ${String(natural)}`;
  }
  if (screen.background !== screen.backgroundToken) {
    return `the background is ${screen.background} where the token is ${screen.backgroundToken}`;
  }
  if (!logo.every((row) => screen.lines.some((line) => line.includes(row)))) {
    return "the logo's blocks are not on screen";
  }
  if (!screen.lines.some((line) => line.includes(box))) return "the box is not on screen";
  return undefined;
}

async function checkType(session: AppSession): Promise<void> {
  const { page } = session;
  const renderer = (await gpuAvailable(page)) ? "webgl" : "dom";
  const inner = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const size of [inner, { width: 960, height: 600 }]) {
    await page.setViewportSize(size);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      let problem: string | undefined;
      await waitUntil(
        async () => {
          problem = typeProblem(await readTerminal(page), renderer);
          return problem === undefined;
        },
        promptTimeoutMs,
        () =>
          `at ${String(size.width)} by ${String(size.height)} in ${colorScheme} ${problem ?? ""}`,
      );
      await session.screenshot(`terminal-${String(size.width)}-${colorScheme}`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(inner);
}

async function checkGpuShared(session: AppSession): Promise<void> {
  const { page } = session;
  const gpu = await gpuAvailable(page);
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes(tooManyContexts)) warnings.push(message.text());
  });
  for (let tab = 2; tab <= maxTerminals; tab += 1) {
    await page.getByTestId("new-session").click();
    await page.getByTestId(`session-tab-${String(tab)}`).waitFor();
  }
  for (const round of [1, 2]) {
    for (let tab = 1; tab <= maxTerminals; tab += 1) {
      await page.getByTestId(`session-tab-${String(tab)}`).click();
      let live: string[] = [];
      await waitUntil(
        async () => {
          live = await liveRenderers(page);
          const shown = (await readTerminal(page))?.renderer;
          const webgl = live.filter((renderer) => renderer === "webgl").length;
          return (
            live.length === maxTerminals &&
            shown === (gpu ? "webgl" : "dom") &&
            webgl === (gpu ? 1 : 0)
          );
        },
        promptTimeoutMs,
        () =>
          `on round ${String(round)} tab ${String(tab)} the renderers read ${JSON.stringify(live)}`,
      );
    }
  }
  assert.deepEqual(warnings, [], "a WebGL context was pushed out by too many live ones");
}

async function checkColumnsFill(page: Page): Promise<void> {
  const height = await page.evaluate(() => innerHeight);
  for (const column of columns) {
    const box = await page.getByTestId(column).boundingBox();
    assert.ok(box !== null, `${column} has no box`);
    assert.ok(
      Math.abs(box.y + box.height - height) <= 1,
      `${column} ends at ${String(Math.round(box.y + box.height))} in a window ${String(height)} tall`,
    );
  }
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
  await checkColumnsFill(page);
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

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  await checkWindow(page);
  await session.answerFolderDialog(session.repo);
  await page.getByTestId("add-first-project").click();
  await page.getByTestId("changes").waitFor({ timeout: promptTimeoutMs });
  await checkColumnsFill(page);
  const firstPid = await startClaude(session, 1);
  await checkType(session);
  await checkInput(session);
  await checkResize(session);
  await session.screenshot("launch");
  await checkGpuShared(session);

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
