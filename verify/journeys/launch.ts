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
const scales = [1, 1.25, 1.5, 1.75, 2.5, 3];
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

function expectedCellHeight(screen: TerminalScreen, scale = screen.scale): number {
  return Math.floor(Math.ceil(screen.fontHeight * scale) * screen.lineHeight) / scale;
}

function drawnSize(screen: TerminalScreen): TerminalSize {
  return {
    cols: Math.round(screen.width / expectedCellWidth(screen)),
    rows: Math.round(screen.height / expectedCellHeight(screen)),
  };
}

async function lastSent(session: AppSession, pid: number): Promise<TerminalSize | undefined> {
  const sent = (await session.standInEvents()).flatMap((event) =>
    event.type === "resize" && event.pid === pid ? [{ cols: event.cols, rows: event.rows }] : [],
  );
  return sent.at(-1);
}

async function checkSizeHeld(session: AppSession, pid: number, where: string): Promise<void> {
  let screen: TerminalScreen | null = null;
  let sent: TerminalSize | undefined;
  await waitUntil(
    async () => {
      screen = await readTerminal(session.page);
      sent = await lastSent(session, pid);
      if (screen === null || sent === undefined) return false;
      const drawn = drawnSize(screen);
      return (
        drawn.cols === screen.cols &&
        drawn.rows === screen.rows &&
        sent.cols === screen.cols &&
        sent.rows === screen.rows
      );
    },
    promptTimeoutMs,
    () => {
      const now: TerminalScreen | null = screen;
      return `${where} the terminal held ${JSON.stringify(now === null ? null : { cols: now.cols, rows: now.rows })}, drew ${JSON.stringify(now === null ? null : drawnSize(now))} and last sent ${JSON.stringify(sent)} to its process`;
    },
  );
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
  if (Math.abs(screen.cellHeight - expectedCellHeight(screen)) > 0.05) {
    return `a cell is ${String(screen.cellHeight)} tall where a line of ${screen.resolvedFamily} is ${String(expectedCellHeight(screen))}`;
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

async function checkType(session: AppSession, devtools: CDPSession, pid: number): Promise<void> {
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
    await checkSizeHeld(session, pid, `at ${String(size.width)} by ${String(size.height)}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await sizeWindow(devtools, inner);
  await waitUntil(
    async () => {
      const screen = await readTerminal(page);
      return screen?.cols === opened?.cols && screen?.rows === opened?.rows;
    },
    promptTimeoutMs,
    "the terminal never returned to its opened size",
  );
  await checkSizeHeld(session, pid, "back at the opened size");
}

function fitsAt(screen: TerminalScreen, scale: number): TerminalSize {
  return {
    cols: Math.floor(screen.paneWidth / expectedCellWidth(screen, scale)),
    rows: Math.floor(screen.paneHeight / expectedCellHeight(screen, scale)),
  };
}

async function checkScale(session: AppSession, devtools: CDPSession, pid: number): Promise<void> {
  const { page } = session;
  await devtools.send("Emulation.clearDeviceMetricsOverride");
  await checkSizeHeld(session, pid, "before the display scale changes");
  const size = await windowSize(page);
  const initial = await readTerminal(page);
  assert.ok(initial !== null, "the terminal shows no screen before the scale changes");
  const slack = initial.paneWidth - initial.width;
  const now = fitsAt(initial, initial.scale);
  const scale = scales.find((candidate) => {
    const then = fitsAt(initial, candidate);
    return then.cols !== now.cols || then.rows !== now.rows;
  });
  assert.ok(scale !== undefined, "no display scale changes the terminal's size");
  for (const [factor, back] of [
    [scale, false],
    [0, true],
  ] as const) {
    if (factor === 0) await devtools.send("Emulation.clearDeviceMetricsOverride");
    else await sizeWindow(devtools, size, factor);
    let screen: TerminalScreen | null = null;
    await waitUntil(
      async () => {
        screen = await readTerminal(page);
        const current = screen;
        if (current === null) return false;
        const same = current.cols === initial.cols && current.rows === initial.rows;
        return (
          same === back &&
          current.width <= current.paneWidth &&
          current.paneWidth - current.width <= slack + current.cellWidth
        );
      },
      promptTimeoutMs,
      () =>
        `at display scale ${String(factor)} the terminal read ${JSON.stringify(screen === null ? null : { cols: screen.cols, rows: screen.rows, width: screen.width, pane: screen.paneWidth })} from ${JSON.stringify({ cols: initial.cols, rows: initial.rows })}`,
    );
    await checkSizeHeld(session, pid, `at display scale ${String(factor)}`);
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

async function checkQuickReturn(session: AppSession, gpu: boolean, pids: number[]): Promise<void> {
  const { page } = session;
  const back = maxTerminals;
  const away = maxTerminals - 1;
  const painted = await page.evaluate(
    async ([away, back]) => {
      const tab = (number: number) =>
        document.querySelector<HTMLElement>(`[data-testid="session-tab-${String(number)}"]`);
      const committed = () =>
        new Promise<void>((settle) => {
          queueMicrotask(settle);
        });
      tab(away)?.click();
      await committed();
      tab(back)?.click();
      await committed();
      const host = document.querySelector<HTMLElement & { terminal?: Terminal }>(
        '[data-testid="terminal"] [data-renderer]',
      );
      const watch: { rows?: string; swapDrawn?: boolean } = {};
      document.body.dataset["switchWatch"] = "{}";
      let drawn = false;
      const rendering = host?.terminal?.onRender(() => {
        drawn = true;
      });
      const swap = new MutationObserver(() => {
        if (host?.getAttribute("data-renderer") !== "webgl") return;
        swap.disconnect();
        drawn = false;
        requestAnimationFrame(() => {
          watch.swapDrawn = drawn;
          document.body.dataset["switchWatch"] = JSON.stringify(watch);
          rendering?.dispose();
        });
      });
      if (host !== null) swap.observe(host, { attributeFilter: ["data-renderer"] });
      return new Promise<string>((resolve) => {
        requestAnimationFrame(() => {
          resolve(host?.querySelector(".xterm-rows")?.textContent ?? "");
        });
      });
    },
    [away, back] as const,
  );
  assert.ok(painted.trim() !== "", "a terminal hidden and shown within one frame painted no rows");
  let live: string[] = [];
  let shown: string | undefined;
  await waitUntil(
    async () => {
      live = await liveRenderers(page);
      shown = (await readTerminal(page))?.renderer;
      const webgl = live.filter((renderer) => renderer === "webgl").length;
      return (
        shown === (gpu ? "webgl" : "dom") &&
        webgl === (gpu ? 1 : 0) &&
        (!gpu || (await switchWatched(page)).swapDrawn !== undefined)
      );
    },
    promptTimeoutMs,
    () =>
      `a terminal hidden and shown within one frame was drawn by ${String(shown)} with the renderers ${JSON.stringify(live)}`,
  );
  assert.ok(
    !gpu || (await switchWatched(page)).swapDrawn === true,
    "a terminal hidden and shown within one frame took WebGL and a frame was painted before it drew",
  );
  const pid = pids[back - 1];
  assert.ok(pid !== undefined, "the last tab has no stand-in");
  await checkSizeHeld(session, pid, "after a terminal was hidden and shown within one frame");
}

async function checkGpuShared(session: AppSession, firstPid: number): Promise<void> {
  const { page } = session;
  const gpu = await gpuAvailable(page);
  const warnings: string[] = [];
  const listen = (message: ConsoleMessage) => {
    if (message.text().includes(tooManyContexts)) warnings.push(message.text());
  };
  page.on("console", listen);
  try {
    const pids = [firstPid];
    for (let tab = 2; tab <= maxTerminals; tab += 1) {
      await page.getByTestId("new-session").click();
      await page.getByTestId(`session-tab-${String(tab)}`).waitFor();
      let started: number[] = [];
      await waitUntil(
        async () => {
          started = await claudePids(session);
          return started.length === tab;
        },
        promptTimeoutMs,
        () => `session ${String(tab)} started ${String(started.length)} stand-ins`,
      );
      const pid = started.at(-1);
      assert.ok(pid !== undefined, `session ${String(tab)} has no stand-in`);
      pids.push(pid);
    }
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
        const pid = pids[tab - 1];
        assert.ok(pid !== undefined, `${where} the tab has no stand-in`);
        await checkSizeHeld(session, pid, where);
      }
    }
    await checkQuickReturn(session, gpu, pids);
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

async function checkResize(session: AppSession, devtools: CDPSession, pid: number): Promise<void> {
  const initial = await readTerminal(session.page);
  assert.ok(initial !== null, "the terminal shows no screen before the window shrinks");
  const inner = await windowSize(session.page);
  for (const height of [Math.max(smallestHeight, inner.height - shrinkPx), inner.height]) {
    await sizeWindow(devtools, { width: inner.width, height });
    let rows: number | undefined;
    await waitUntil(
      async () => {
        rows = (await readTerminal(session.page))?.rows;
        return height === inner.height ? rows === initial.rows : rows !== initial.rows;
      },
      promptTimeoutMs,
      () =>
        `at ${String(height)} tall the terminal kept ${String(rows)} rows from ${String(initial.rows)}`,
    );
    await checkSizeHeld(session, pid, `at ${String(height)} tall`);
  }
  for (let height = inner.height - 1; height > inner.height - 40; height -= 13) {
    await sizeWindow(devtools, { width: inner.width, height });
    await checkSizeHeld(session, pid, `at ${String(height)} tall`);
  }
  await sizeWindow(devtools, inner);
  await checkSizeHeld(session, pid, "back at the opened size");
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  await checkWindow(page);
  await session.answerFolderDialog(session.repo);
  await page.getByTestId("add-first-project").click();
  await page.getByTestId("changes").waitFor({ timeout: promptTimeoutMs });
  await checkColumnsFill(page);
  const firstPid = await startClaude(session, 1);
  await checkSizeHeld(session, firstPid, "once started");
  const devtools = await page.context().newCDPSession(page);
  await checkType(session, devtools, firstPid);
  await checkScale(session, devtools, firstPid);
  await checkInput(session);
  await checkResize(session, devtools, firstPid);
  await session.screenshot("launch");
  await checkGpuShared(session, firstPid);
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
