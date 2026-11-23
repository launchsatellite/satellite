import assert from "node:assert/strict";
import type { Terminal } from "@xterm/xterm";
import type { CDPSession, ConsoleMessage, Page } from "playwright-core";
import { generatedText, pasteIntoFocus, type AppSession } from "../driver.ts";
import { z } from "zod";
import type { Journey } from "../journeys.ts";
import { readTerminal, type TerminalScreen } from "../terminal-screen.ts";
import {
  claudePids,
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
const switchWatch = z.object({ rows: z.string().optional(), swapDrawn: z.boolean().optional() });
const scales = [1.25, 1.5, 1.75, 2.5, 3];
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

function expectedCellWidth(screen: TerminalScreen, scale = screen.scale): number {
  return screen.renderer === "webgl" ? Math.floor(screen.advance * scale) / scale : screen.advance;
}

async function drawnTerminalSize(page: Page): Promise<TerminalSize | null> {
  const screen = await readTerminal(page);
  if (screen === null) return null;
  return {
    cols: Math.round(screen.width / expectedCellWidth(screen)),
    rows: Math.round(screen.height / (screen.naturalLineHeight * screen.lineHeight)),
  };
}

async function sizeWindow(
  devtools: CDPSession,
  size: { width: number; height: number },
  deviceScaleFactor = 0,
): Promise<void> {
  await devtools.send("Emulation.setDeviceMetricsOverride", {
    ...size,
    deviceScaleFactor,
    mobile: false,
  });
}

async function windowSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
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

function bareFamily(family: string): string {
  return family.replaceAll('"', "").trim();
}

function typeProblem(screen: TerminalScreen | null, renderer: string): string | undefined {
  const expected = codeTypes[process.platform];
  if (expected === undefined) return `no code type is known for ${process.platform}`;
  if (screen === null) return "the terminal shows no screen";
  if (screen.renderer !== renderer) return `the terminal is drawn by ${screen.renderer}`;
  if (screen.fontFamily !== expected.fontFamily) return `the font is ${screen.fontFamily}`;
  const first = bareFamily(expected.fontFamily.split(",")[0] ?? "");
  if (process.platform !== "linux" && bareFamily(screen.resolvedFamily) !== first) {
    return `the page draws in ${screen.resolvedFamily} where ${first} is expected`;
  }
  if (Math.abs(screen.cellWidth - expectedCellWidth(screen)) > 0.05) {
    return `a cell is ${String(screen.cellWidth)} wide where ${screen.resolvedFamily} advances ${String(screen.advance)}`;
  }
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

async function checkType(session: AppSession, devtools: CDPSession): Promise<void> {
  const { page } = session;
  const renderer = (await gpuAvailable(page)) ? "webgl" : "dom";
  const inner = await windowSize(page);
  const opened = await readTerminal(page);
  for (const size of [inner, { width: 960, height: 600 }]) {
    await sizeWindow(devtools, size);
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
      await session.screenshot(`terminal-${renderer}-${String(size.width)}-${colorScheme}`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await sizeWindow(devtools, inner);
  await waitUntil(
    async () => {
      const screen = await readTerminal(page);
      const sent = (await resizesSince(session, 0)).at(-1);
      return (
        screen?.cols === opened?.cols &&
        screen?.rows === opened?.rows &&
        sent?.cols === screen?.cols
      );
    },
    promptTimeoutMs,
    "the terminal never returned to its opened size",
  );
}

async function resizesSince(session: AppSession, before: number): Promise<TerminalSize[]> {
  return (await session.standInEvents())
    .slice(before)
    .flatMap((event) => (event.type === "resize" ? [{ cols: event.cols, rows: event.rows }] : []));
}

async function checkScale(session: AppSession, devtools: CDPSession): Promise<void> {
  const { page } = session;
  await devtools.send("Emulation.clearDeviceMetricsOverride");
  const size = await windowSize(page);
  const sent = (await resizesSince(session, 0)).at(-1);
  let settled: TerminalScreen | null = null;
  await waitUntil(
    async () => {
      settled = await readTerminal(page);
      return settled !== null && settled.cols === sent?.cols && settled.rows === sent.rows;
    },
    promptTimeoutMs,
    () => `the terminal never settled at the size the stand-in last got, ${JSON.stringify(sent)}`,
  );
  const initial = await readTerminal(page);
  assert.ok(initial !== null, "the terminal shows no screen before the scale changes");
  if (initial.renderer !== "webgl") return;
  const slack = initial.paneWidth - initial.width;
  const scale = scales.find(
    (candidate) =>
      Math.abs(expectedCellWidth(initial, candidate) - initial.cellWidth) / initial.cellWidth >
      0.02,
  );
  assert.ok(scale !== undefined, `no display scale changes a ${String(initial.advance)} cell`);
  for (const [factor, cols] of [
    [scale, undefined],
    [0, initial.cols],
  ] as const) {
    const before = (await session.standInEvents()).length;
    if (factor === 0) await devtools.send("Emulation.clearDeviceMetricsOverride");
    else await sizeWindow(devtools, size, factor);
    let screen: TerminalScreen | null = null;
    let resizes: TerminalSize[] = [];
    await waitUntil(
      async () => {
        screen = await readTerminal(page);
        resizes = await resizesSince(session, before);
        const now = screen;
        return (
          now !== null &&
          (cols === undefined ? now.cols !== initial.cols : now.cols === cols) &&
          now.width <= now.paneWidth &&
          now.paneWidth - now.width <= slack + now.cellWidth &&
          resizes.some((resize) => resize.cols === now.cols && resize.rows === now.rows)
        );
      },
      promptTimeoutMs,
      () =>
        `at display scale ${String(factor)} the terminal read ${JSON.stringify(screen === null ? null : { cols: screen.cols, width: screen.width, pane: screen.paneWidth })} from ${String(initial.cols)} columns and the stand-in got ${JSON.stringify(resizes)}`,
    );
  }
}

async function watchSwitch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const watch: { rows?: string; swapDrawn?: boolean } = {};
    document.body.dataset["switchWatch"] = "{}";
    const keep = () => {
      document.body.dataset["switchWatch"] = JSON.stringify(watch);
    };
    const now = () => Number(document.timeline.currentTime);
    let swappedAt: number | undefined;
    let firstFrame: number | undefined;
    let drawnAt: number | undefined;
    let rendering: { dispose: () => void } | undefined;
    const settle = () => {
      if (firstFrame === undefined || drawnAt === undefined) return;
      watch.swapDrawn = drawnAt <= firstFrame;
      keep();
      rendering?.dispose();
      observer.disconnect();
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (!(target instanceof HTMLElement)) continue;
        if (record.attributeName === "hidden" && !target.hidden && watch.rows === undefined) {
          const host = target.querySelector<HTMLElement & { terminal?: Terminal }>(
            "[data-renderer]",
          );
          if (host === null) continue;
          rendering = host.terminal?.onRender(() => {
            if (swappedAt === undefined || drawnAt !== undefined) return;
            drawnAt = now();
            settle();
          });
          const rows = host.querySelector(".xterm-rows")?.textContent ?? "";
          watch.rows = `${host.getAttribute("data-renderer") ?? ""}:${rows}`;
          keep();
        }
        if (
          record.attributeName === "data-renderer" &&
          watch.rows !== undefined &&
          swappedAt === undefined &&
          target.getAttribute("data-renderer") === "webgl"
        ) {
          swappedAt = now();
          requestAnimationFrame(() => {
            firstFrame = now();
            settle();
          });
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "data-renderer"],
    });
  });
}

async function switchWatched(page: Page): Promise<{ rows?: string; swapDrawn?: boolean }> {
  const kept = await page.evaluate(() => document.body.dataset["switchWatch"] ?? "{}");
  return switchWatch.parse(JSON.parse(kept));
}

async function checkGpuShared(session: AppSession): Promise<void> {
  const { page } = session;
  const gpu = await gpuAvailable(page);
  const warnings: string[] = [];
  const listen = (message: ConsoleMessage) => {
    if (message.text().includes(tooManyContexts)) warnings.push(message.text());
  };
  page.on("console", listen);
  try {
    for (let tab = 2; tab <= maxTerminals; tab += 1) {
      await page.getByTestId("new-session").click();
      await page.getByTestId(`session-tab-${String(tab)}`).waitFor();
    }
    await waitUntil(
      async () => (await claudePids(session)).length >= maxTerminals,
      promptTimeoutMs,
      "the sessions never all started",
    );
    for (const round of [1, 2]) {
      for (let tab = 1; tab <= maxTerminals; tab += 1) {
        const where = `on round ${String(round)} tab ${String(tab)}`;
        await watchSwitch(page);
        await page.getByTestId(`session-tab-${String(tab)}`).click();
        let live: string[] = [];
        let watched: { rows?: string; swapDrawn?: boolean } = {};
        await waitUntil(
          async () => {
            live = await liveRenderers(page);
            watched = await switchWatched(page);
            const shown = (await readTerminal(page))?.renderer;
            const webgl = live.filter((renderer) => renderer === "webgl").length;
            return (
              live.length === maxTerminals &&
              shown === (gpu ? "webgl" : "dom") &&
              webgl === (gpu ? 1 : 0) &&
              watched.rows !== undefined &&
              (!gpu || watched.swapDrawn !== undefined)
            );
          },
          promptTimeoutMs,
          () =>
            `${where} the renderers read ${JSON.stringify(live)} and the switch ${JSON.stringify(watched)}`,
        );
        assert.ok(
          watched.rows?.startsWith("dom:") === true && watched.rows.slice(4).trim() !== "",
          `${where} the terminal's first visible frame held ${JSON.stringify(watched.rows?.slice(0, 80))}`,
        );
        assert.ok(
          !gpu || watched.swapDrawn === true,
          `${where} WebGL took over and a frame was painted before it drew`,
        );
      }
    }
  } finally {
    page.off("console", listen);
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

async function checkResize(session: AppSession, devtools: CDPSession): Promise<void> {
  const initial = await drawnTerminalSize(session.page);
  assert.ok(initial !== null, "the terminal draws no rows to measure");
  const before = (await session.standInEvents()).length;
  const inner = await windowSize(session.page);
  await sizeWindow(devtools, {
    width: inner.width,
    height: Math.max(smallestHeight, inner.height - shrinkPx),
  });
  let drawn: TerminalSize | null = null;
  let resizes: TerminalSize[] = [];
  await waitUntil(
    async () => {
      drawn = await drawnTerminalSize(session.page);
      resizes = await resizesSince(session, before);
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
  const devtools = await page.context().newCDPSession(page);
  await checkType(session, devtools);
  await checkScale(session, devtools);
  await checkInput(session);
  await checkResize(session, devtools);
  await session.screenshot("launch");
  await checkGpuShared(session);
  await devtools.detach();

  assert.ok(!processGone(firstPid), "the first stand-in was gone before the reload");
  const beforeReload = await claudePids(session);
  await page.reload();
  await waitUntil(
    () => beforeReload.every(processGone),
    goneTimeoutMs,
    () =>
      `the stand-ins ${JSON.stringify(beforeReload.filter((pid) => !processGone(pid)))} still ran after the reload`,
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
