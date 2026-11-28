import assert from "node:assert/strict";
import { appendFile, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import type { Page } from "playwright-core";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  promptTimeoutMs,
  standInInput,
  startClaude,
  stateIs,
  toastReads,
  waitUntil,
} from "./conditions.ts";

interface Row {
  path: string;
  state: string;
  ignored: boolean;
  open: string | null;
  label: string;
  text: string;
}

const linesShortcut = process.platform === "darwin" ? "Meta+L" : "Control+Shift+L";
const bracketed = (text: string) => `\u001b[200~${text}\u001b[201~`;
const hiddenNameSentence =
  "This file's name holds hidden characters, so Satellite can't point Claude Code at it. Ask in your own words.";
const findShortcut = process.platform === "darwin" ? "Meta+F" : "Control+Shift+F";
const waitMs = 15_000;
const followMs = 45_000;
const deepFolders = [
  "src",
  "src/deep",
  "src/deep/er",
  "src/deep/er/than",
  "src/deep/er/than/usual",
];
const deepFile = "src/deep/er/than/usual/needle-target.ts";
const rowSelector = '[data-testid="files-tree"] [data-kind]';

function worktree(session: AppSession): string {
  return join(session.home, "worktrees", "repo", "alpha");
}

function rowLocator(page: Page, path: string) {
  return page.locator(`${rowSelector}[data-path=${JSON.stringify(path)}]`);
}

async function rows(page: Page): Promise<Row[]> {
  return page.evaluate(
    (selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((row) => ({
        path: row.dataset["path"] ?? "",
        state: row.dataset["state"] ?? "",
        ignored: row.dataset["ignored"] === "true",
        open: row.closest("[role=treeitem]")?.getAttribute("aria-expanded") ?? null,
        label: row.closest("[role=treeitem]")?.getAttribute("aria-label") ?? "",
        text: row.innerText,
      })),
    rowSelector,
  );
}

async function rowOf(session: AppSession, path: string, when: string): Promise<Row> {
  let found: Row | undefined;
  await waitUntil(
    async () => {
      found = (await rows(session.page)).find((row) => row.path === path);
      return found !== undefined;
    },
    followMs,
    `no row for ${path} appeared ${when}`,
  );
  if (found === undefined) throw new Error(`no row for ${path} ${when}`);
  return found;
}

async function noRow(session: AppSession, path: string, when: string): Promise<void> {
  await waitUntil(
    async () => !(await rows(session.page)).some((row) => row.path === path),
    followMs,
    `the row for ${path} was still listed ${when}`,
  );
}

async function openFolder(session: AppSession, path: string): Promise<void> {
  const row = await rowOf(session, path, "to open it");
  if (row.open !== "true") await rowLocator(session.page, path).click();
  await waitUntil(
    async () => (await rowOf(session, path, "while opening it")).open === "true",
    waitMs,
    `${path} never opened`,
  );
}

async function editorText(page: Page): Promise<string> {
  const lines = page.locator('[data-testid="file-text"] .view-lines');
  if ((await lines.count()) === 0) return "";
  return (await lines.first().innerText()).replaceAll("\u{a0}", " ");
}

async function editorShows(session: AppSession, text: string, when: string): Promise<void> {
  let shown = "";
  await waitUntil(
    async () => {
      shown = await editorText(session.page);
      return shown.includes(text);
    },
    followMs,
    () =>
      `the editor did not show ${JSON.stringify(text)} ${when}, it read ${JSON.stringify(shown.slice(0, 200))}`,
  );
}

async function sentenceReads(session: AppSession, expected: string): Promise<void> {
  const sentence = session.page.getByTestId("file-sentence");
  let read = "";
  await waitUntil(
    async () => {
      read = (await sentence.count()) === 0 ? "" : await sentence.innerText();
      return read.includes(expected);
    },
    followMs,
    () => `file-sentence read ${JSON.stringify(read)} instead of ${JSON.stringify(expected)}`,
  );
}

async function tabPaths(page: Page): Promise<{ titles: string[]; active: number }> {
  return page.evaluate(() => {
    const tabs = [
      ...document.querySelectorAll<HTMLElement>('[data-testid^="file-tab-"][role="tab"]'),
    ];
    return {
      titles: tabs.map((tab) => tab.getAttribute("aria-label") ?? ""),
      active: tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true"),
    };
  });
}

async function listsTheDisk(session: AppSession): Promise<void> {
  const { page } = session;
  await page.getByTestId("workspace-repo-alpha").click();
  await page.getByTestId("rail-tab-files").click();
  await rowOf(session, "README.md", "after opening Files");
  const listed = await rows(page);
  const root = listed.filter((row) => !row.path.includes("/"));
  for (const name of ["src", "assets", "docs", "README.md", "build", "debug.log", ".gitignore"]) {
    assert.ok(
      root.some((row) => row.path === name),
      `the root did not list ${name}`,
    );
  }
  assert.ok(
    listed.every((row) => row.path !== ".git" && !row.path.startsWith(".git/")),
    "the tree listed a .git path",
  );
  let letters: string[] = [];
  await waitUntil(
    async () => {
      const now = await rows(page);
      letters = ["README.md", "it's new.txt"].map(
        (name) => now.find((row) => row.path === name)?.state ?? "",
      );
      return letters[0] === "M" && letters[1] === "A";
    },
    waitMs,
    () => `README.md and it's new.txt read ${JSON.stringify(letters)}, not M and A`,
  );
  const byPath = new Map((await rows(page)).map((row) => [row.path, row]));
  assert.equal(byPath.get("debug.log")?.ignored, true, "debug.log was not marked ignored");
  assert.equal(byPath.get("README.md")?.ignored, false, "README.md was marked ignored");
  const hostile = listed.find((row) => row.path.includes("report"));
  assert.ok(
    hostile?.label.includes("[U+202E]") === true && hostile.text.includes("[U+202E]"),
    `the hostile name was not revealed, it read ${JSON.stringify(hostile?.text)}`,
  );
  const violations = await page.evaluate((): unknown => Reflect.get(window, "policyViolations"));
  assert.deepEqual(violations, [], "the tree broke the content security policy");
}

async function opensReadOnly(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  for (const path of deepFolders) await openFolder(session, path);
  await rowLocator(page, deepFile).click();
  await editorShows(session, "needle", "after opening it");
  const before = await editorText(page);
  const onDisk = await readFile(join(folder, deepFile));
  await page.locator('[data-testid="file-text"] .view-lines').first().click();
  await page.keyboard.press("a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await page.keyboard.type("typed");
  assert.equal(await editorText(page), before, "typing into the file changed the editor");
  assert.ok(
    onDisk.equals(await readFile(join(folder, deepFile))),
    "typing into the file changed it on disk",
  );
}

async function followsTheDisk(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await appendFile(join(folder, deepFile), 'export const second = "appeared";\n');
  await editorShows(session, "appeared", "without any click after the append");
  await writeFile(join(folder, "src", "fresh.txt"), "new on disk\n");
  await rowOf(session, "src/fresh.txt", "without any click after it was written");
  await rowLocator(page, "src/fresh.txt").click();
  await editorShows(session, "new on disk", "after opening fresh.txt");
  await writeFile(join(folder, "src", "gone.txt"), "soon gone\n");
  await rowOf(session, "src/gone.txt", "after it was written");
  await rowLocator(page, "src/gone.txt").click();
  await editorShows(session, "soon gone", "after opening gone.txt");
  await unlink(join(folder, "src", "gone.txt"));
  await noRow(session, "src/gone.txt", "after it was deleted");
  await sentenceReads(session, "This file isn't there anymore.");
  await page.getByTestId("file-tab-2-close").click({ force: true });
  await waitUntil(async () => (await tabPaths(page)).titles.length === 2, waitMs, "close failed");
}

async function remembersTabs(session: AppSession): Promise<void> {
  const before = await tabPaths(session.page);
  await session.relaunch();
  await session.page.getByTestId("workspace-repo-alpha").click();
  await session.page.getByTestId(`file-tab-${String(before.active)}`).click();
  let found = before;
  await waitUntil(
    async () => {
      found = await tabPaths(session.page);
      return found.titles.join("\n") === before.titles.join("\n") && found.active === before.active;
    },
    waitMs,
    () =>
      `the tabs did not come back as they were, expected ${JSON.stringify(before)} and found ${JSON.stringify(found)}`,
  );
  await waitUntil(
    async () => (await editorText(session.page)).length > 0,
    waitMs,
    "the active file did not show after the relaunch",
  );
}

async function resultPaths(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="file-result-"]')].map(
      (result) => result.dataset["path"] ?? "",
    ),
  );
}

async function openByName(session: AppSession, query: string, path: string): Promise<void> {
  const { page } = session;
  await page.keyboard.press(findShortcut);
  await page.getByTestId("palette-input").waitFor({ timeout: waitMs });
  await page.keyboard.type(query, { delay: 30 });
  let listed: string[] = [];
  await waitUntil(
    async () => {
      listed = await resultPaths(page);
      return listed[0] === path;
    },
    waitMs,
    () => `the first result for ${query} was ${JSON.stringify(listed[0])}, not ${path}`,
  );
  await page.keyboard.press("Enter");
  await page.getByTestId("palette").waitFor({ state: "detached", timeout: waitMs });
}

async function findsByName(session: AppSession): Promise<void> {
  const { page } = session;
  while ((await page.getByTestId("file-tab-0-close").count()) > 0) {
    await page.getByTestId("file-tab-0-close").click({ force: true });
  }
  await page.getByTestId("rail-tab-changes").click();
  await page.getByTestId("changes").waitFor({ timeout: waitMs });
  await openByName(session, "needle", deepFile);
  await editorShows(session, "needle", "after opening it by name");
}

async function sendsLines(session: AppSession): Promise<void> {
  const { page } = session;
  await page.getByTestId("session-tab-start").click();
  await startClaude(session, 1);
  await page.keyboard.type("look at the files");
  await page.keyboard.press("Enter");
  await stateIs(session, "session-tab-1", "done", "before the lines were sent");
  await openByName(session, "src/app", "src/app.ts");
  await editorShows(session, "greet", "after opening src/app.ts");
  let from = (await session.standInEvents()).length;
  await session.selectFileLines(2, 3);
  await page.keyboard.press(linesShortcut);
  const expected = bracketed("Lines 2 to 3 of src/app.ts in this workspace. ");
  let typed = "";
  await waitUntil(
    async () => {
      typed = await standInInput(session, from);
      return typed.length >= expected.length;
    },
    promptTimeoutMs,
    () => `the prompt received ${JSON.stringify(typed)}`,
  );
  assert.equal(typed, expected, `the prompt received ${JSON.stringify(typed)}`);

  await page.getByTestId("rail-tab-files").click();
  const hostile = (await rows(page)).find((row) => row.path.includes("report"));
  assert.ok(hostile !== undefined, "the hostile name was not listed");
  from = (await session.standInEvents()).length;
  await rowLocator(page, hostile.path).click();
  await editorShows(session, "", "after opening the hostile name");
  await session.selectFileLines(1, 1);
  await page.keyboard.press(linesShortcut);
  await toastReads(session, hiddenNameSentence, "after sending lines of a hidden name");
  assert.equal(await standInInput(session, from), "", "a hidden name reached the prompt");
}

function chunk(kind: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

function pngSignature(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
  ]);
}

async function openRoot(session: AppSession, name: string): Promise<void> {
  await rowOf(session, name, "after it was written");
  await rowLocator(session.page, name).click();
}

async function showsSentences(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await openFolder(session, "assets");
  await rowLocator(page, "assets/pixel.png").click();
  const image = page.getByTestId("file-image");
  await waitUntil(
    async () =>
      (await image.count()) > 0 &&
      (await image.evaluate(
        (element) => element instanceof HTMLImageElement && element.naturalWidth,
      )) === 1,
    waitMs,
    "pixel.png did not draw",
  );
  assert.ok(
    ((await image.getAttribute("src")) ?? "").startsWith("data:image/png;base64,"),
    "the image was not drawn from a data address",
  );

  await writeFile(join(folder, "bomb.png"), pngSignature(10_000, 10_000));
  await openRoot(session, "bomb.png");
  await sentenceReads(session, "50 megapixels");

  await writeFile(join(folder, "many-lines.txt"), "x\n".repeat(30_000));
  await openRoot(session, "many-lines.txt");
  await sentenceReads(session, "too large");

  await writeFile(join(folder, "has-nul.txt"), Buffer.from([0x61, 0x00, 0x62, 0x0a]));
  await openRoot(session, "has-nul.txt");
  await sentenceReads(session, "binary file");
}

export const filesJourney: Journey = {
  name: "files",
  scenario: "mixed-changes",
  async run(session) {
    const folder = worktree(session);
    await session.page.evaluate(() => {
      const violations: string[] = [];
      Reflect.set(window, "policyViolations", violations);
      document.addEventListener("securitypolicyviolation", (event) => {
        violations.push(event.violatedDirective);
      });
    });
    await listsTheDisk(session);
    await opensReadOnly(session, folder);
    await followsTheDisk(session, folder);
    await remembersTabs(session);
    await findsByName(session);
    await sendsLines(session);
    await showsSentences(session, folder);
    assert.deepEqual(session.consoleErrors, [], "the window logged errors");
  },
};
