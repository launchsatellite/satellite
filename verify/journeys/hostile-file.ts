import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { gone, startClaude, visible, waitUntil } from "./conditions.ts";

interface Kept {
  hidden: string[];
  lines: string[];
  selected: number;
}

interface Responsive {
  longestGapMs: number;
  terminalData: number;
  settingsMs: number;
}

const waitMs = 15_000;
const watchMs = 3_000;
const answerMs = 250;
const throughDriverMs = 1000;
const liveData = 15;
const keyword = "rgb(255, 121, 198)";
const commandModifier = process.platform === "darwin" ? "Meta" : "Control+Shift";
const settingsKeys = process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";
const unbroken = `${"_".repeat(9000)}!`;
const slowest = `x = ${"a.".repeat(98)}`;

function hostileText(): string {
  const lines: string[] = [];
  for (let at = 0; at < 100; at++) lines.push(unbroken, slowest, slowest);
  return `${lines.join("\n")}\n`;
}

async function pick(session: AppSession, name: string): Promise<void> {
  await session.page.getByTestId("changes-list").getByText(name).click();
}

async function keywordColoured(session: AppSession, when: string): Promise<void> {
  await waitUntil(
    () =>
      session.page.evaluate(
        (colour) =>
          [...document.querySelectorAll(".editor.modified .view-line span span")].some(
            (span) =>
              span.textContent.trim() === "export" && getComputedStyle(span).color === colour,
          ),
        keyword,
      ),
    waitMs,
    `the diff's keywords did not take the theme's colour ${when}`,
  );
}

async function keywordShown(session: AppSession): Promise<void> {
  await waitUntil(
    () =>
      session.page.evaluate(() =>
        [...document.querySelectorAll(".view-line")].some((line) =>
          line.textContent.includes("value110"),
        ),
      ),
    waitMs,
    "the first file's diff never showed",
  );
}

async function kept(session: AppSession): Promise<Kept> {
  return session.page.evaluate(() => {
    const modified = document.querySelector(".editor.modified");
    const texts = (selector: string) =>
      [...(modified?.querySelectorAll(selector) ?? [])].map((found) => found.textContent.trim());
    return {
      hidden: texts(".diff-hidden-lines .content-row"),
      lines: texts(".line-numbers"),
      selected: modified?.querySelectorAll(".selected-text").length ?? 0,
    };
  });
}

async function runCommand(session: AppSession, id: string): Promise<void> {
  await session.page.keyboard.press(`${commandModifier}+K`);
  await visible(session, "palette", "after the command menu shortcut");
  await session.page.getByTestId(`command-${id}`).click();
  await gone(session, "palette", `after running ${id}`);
}

async function groundIs(session: AppSession, ground: string): Promise<void> {
  await waitUntil(
    () =>
      session.page.evaluate(
        (expected) =>
          getComputedStyle(
            document.querySelector(".editor.modified .monaco-editor-background") ?? document.body,
          ).backgroundColor === expected,
        ground,
      ),
    waitMs,
    `the diff did not take the ground ${ground}`,
  );
}

async function keepsItsPlace(session: AppSession): Promise<void> {
  await pick(session, "long.ts");
  await keywordColoured(session, "on the first file");
  const before = await kept(session);
  const modified = session.page.locator(".editor.modified");
  await modified.locator(".diff-hidden-lines .top").first().click();
  await waitUntil(
    async () => JSON.stringify((await kept(session)).hidden) !== JSON.stringify(before.hidden),
    waitMs,
    "Show more above did not reveal hidden lines",
  );
  await modified.hover();
  await session.page.mouse.wheel(0, 120);
  const box = await modified.boundingBox();
  assert.ok(box !== null, "the diff is not on screen");
  const x = box.x + box.width / 2;
  await session.page.mouse.click(x, box.y + box.height * 0.2);
  await session.page.keyboard.down("Shift");
  await session.page.mouse.click(x, box.y + box.height * 0.3);
  await session.page.keyboard.up("Shift");
  await delay(500);
  const expanded = await kept(session);
  assert.ok(expanded.selected > 0, "the drag left no selection to send");
  await runCommand(session, "theme-light");
  await groundIs(session, "rgb(255, 255, 255)");
  await runCommand(session, "theme-dracula");
  await groundIs(session, "rgb(40, 42, 54)");
  await keywordColoured(session, "back on the curated theme");
  await delay(3000);
  assert.deepEqual(await kept(session), expanded, "recolouring moved the open diff");
}

export async function responsiveWhileOpening(
  session: AppSession,
  name: string,
): Promise<Responsive> {
  const { page } = session;
  await page.evaluate(() => {
    const watched = { longestGapMs: 0, terminalData: 0 };
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      watched.longestGapMs = Math.max(watched.longestGapMs, now - last);
      last = now;
    }, 10);
    const bridge: unknown = Reflect.get(window, "satellite");
    const onEvent: unknown =
      typeof bridge === "object" && bridge !== null ? Reflect.get(bridge, "onEvent") : null;
    if (typeof onEvent === "function")
      Reflect.apply(onEvent, bridge, [
        (event: string) => {
          if (event === "terminal.data") watched.terminalData++;
        },
      ]);
    Reflect.set(window, "verifyWatched", {
      watched,
      stop: () => {
        clearInterval(timer);
      },
    });
  });
  const started = Date.now();
  await pick(session, name);
  await waitUntil(
    () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".view-line")].some((line) =>
          line.textContent.includes("a.a.a.a."),
        ),
      ),
    waitMs,
    `the diff of ${name} never showed its lines`,
  );
  const asked = Date.now();
  await page.keyboard.press(settingsKeys);
  await visible(session, "settings-dialog", "after the settings shortcut on a hostile file");
  const settingsMs = Date.now() - asked;
  await page.keyboard.press("Escape");
  await gone(session, "settings-dialog", "after Escape");
  await delay(Math.max(0, watchMs - (Date.now() - started)));
  const watched = await page.evaluate(() => {
    const found: unknown = Reflect.get(window, "verifyWatched");
    if (typeof found !== "object" || found === null) return null;
    const stop: unknown = Reflect.get(found, "stop");
    if (typeof stop === "function") Reflect.apply(stop, found, []);
    const values: unknown = Reflect.get(found, "watched");
    return typeof values === "object" && values !== null
      ? {
          longestGapMs: Number(Reflect.get(values, "longestGapMs")),
          terminalData: Number(Reflect.get(values, "terminalData")),
        }
      : null;
  });
  if (watched === null) throw new Error("the page lost its watch");
  return { ...watched, settingsMs };
}

function answers(reading: Responsive, theme: string): void {
  const read = JSON.stringify(reading);
  assert.ok(
    reading.longestGapMs < answerMs,
    `the page stalled on a hostile file in ${theme}, ${read}`,
  );
  assert.ok(reading.settingsMs < throughDriverMs, `Settings answered late in ${theme}, ${read}`);
  assert.ok(reading.terminalData >= liveData, `the terminal went quiet in ${theme}, ${read}`);
}

async function journey(session: AppSession): Promise<void> {
  await writeFile(
    join(session.home, "worktrees", "repo", "feature", "src", "hostile.ts"),
    hostileText(),
  );
  await session.page.getByTestId("workspace-repo-feature").click();
  await startClaude(session, 1);
  await keepsItsPlace(session);
  answers(await responsiveWhileOpening(session, "hostile.ts"), "the curated theme");
  await session.screenshot("hostile-file-dracula");
  await runCommand(session, "theme-light");
  await pick(session, "long.ts");
  await keywordShown(session);
  answers(await responsiveWhileOpening(session, "hostile.ts"), "Satellite light");
}

export const hostileFileJourney: Journey = {
  name: "hostile-file",
  scenario: "hostile-file",
  run: journey,
};
