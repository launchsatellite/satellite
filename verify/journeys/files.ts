import assert from "node:assert/strict";
import { appendFile, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
  kind: string;
  ignored: boolean;
  open: string | null;
  label: string;
  text: string;
  iconDrawn: boolean;
}

const linesShortcut = process.platform === "darwin" ? "Meta+L" : "Control+Shift+L";
const bracketed = (text: string) => `\u001b[200~${text}\u001b[201~`;
const noLinesSentence = "Select some lines in the file first.";
const notTextSentence = "This file isn't shown as text, so there are no lines to send.";
const hiddenNameSentence =
  "This file's name holds hidden characters, so Satellite can't point Claude Code at it. Ask in your own words.";
const findShortcut = process.platform === "darwin" ? "Meta+F" : "Control+Shift+F";
const quickMs = 2000;
const waitMs = 15_000;
const followMs = 45_000;
const settleMs = 6000;
const quietMs = 1500;
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
      [...document.querySelectorAll<HTMLElement>(selector)].map((row) => {
        const image = row.querySelector("img");
        return {
          path: row.dataset["path"] ?? "",
          state: row.dataset["state"] ?? "",
          kind: row.dataset["kind"] ?? "",
          ignored: row.dataset["ignored"] === "true",
          open: row.closest("[role=treeitem]")?.getAttribute("aria-expanded") ?? null,
          label: row.closest("[role=treeitem]")?.getAttribute("aria-label") ?? "",
          text: row.innerText,
          iconDrawn: image !== null && image.complete && image.naturalWidth > 0,
        };
      }),
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
  await page.getByTestId("centre-tab-files").click();
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
  assert.equal(byPath.get("build")?.ignored, true, "build was not marked ignored");
  assert.equal(byPath.get("README.md")?.ignored, false, "README.md was marked ignored");
  let bare: string[] = [];
  await waitUntil(
    async () => {
      bare = (await rows(page)).filter((row) => !row.iconDrawn).map((row) => row.path);
      return bare.length === 0;
    },
    waitMs,
    () => `no icon was drawn on ${JSON.stringify(bare)}`,
  );
  const hostile = listed.find((row) => row.path.includes("report"));
  assert.ok(
    hostile?.label.includes("[U+202E]") === true && hostile.text.includes("[U+202E]"),
    `the hostile name was not revealed, it read ${JSON.stringify(hostile?.text)}`,
  );
  const violations = await page.evaluate((): unknown => Reflect.get(window, "policyViolations"));
  assert.deepEqual(violations, [], "the icons broke the content security policy");
}

async function opensReadOnly(session: AppSession, folder: string): Promise<string> {
  const { page } = session;
  for (const path of deepFolders) await openFolder(session, path);
  await rowLocator(page, deepFile).click();
  await page.getByTestId("file-tab-0").waitFor({ timeout: waitMs });
  await editorShows(session, "needle", "after opening it");
  const before = await editorText(page);
  const onDisk = await readFile(join(folder, deepFile));
  await page.locator('[data-testid="file-text"] .view-lines').first().click();
  await page.keyboard.press("a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await page.keyboard.type("typed");
  assert.equal(await editorText(page), before, "typing into the file changed the editor");
  assert.deepEqual(
    (await tabPaths(page)).titles.length,
    1,
    "typing into the file changed the tabs",
  );
  assert.ok(
    onDisk.equals(await readFile(join(folder, deepFile))),
    "typing into the file changed it on disk",
  );
  return before;
}

async function watchTree(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target =
          record.target instanceof Element ? record.target : record.target.parentElement;
        if (target === null) continue;
        if (target.closest(".scrollbar") !== null) continue;
        seen.push(`${record.type} in ${(target.getAttribute("class") ?? "").slice(0, 60)}`);
      }
    });
    for (const id of ["files-tree", "file-pane", "file-tabs"]) {
      const element = document.querySelector(`[data-testid="${id}"]`);
      if (element !== null) {
        observer.observe(element, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
      }
    }
    Reflect.set(window, "filesMutations", { observer, seen });
  });
}

async function mutationsSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const watched: unknown = Reflect.get(window, "filesMutations");
    if (typeof watched !== "object" || watched === null) return ["nothing was watched"];
    const observer: unknown = Reflect.get(watched, "observer");
    if (observer instanceof MutationObserver) observer.disconnect();
    const seen: unknown = Reflect.get(watched, "seen");
    return Array.isArray(seen) ? seen.map(String) : ["nothing was recorded"];
  });
}

async function nudge(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function activeTestId(page: Page): Promise<string> {
  return page.evaluate(
    () => document.activeElement?.closest("[data-testid]")?.getAttribute("data-testid") ?? "",
  );
}

async function focusRow(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    const row = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="files-tree"] [data-kind]'),
    ]
      .find((candidate) => candidate.dataset["path"] === target)
      ?.closest<HTMLElement>("[role=treeitem]");
    row?.focus();
  }, path);
}

async function treeHoldsFocus(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('[data-testid="files-tree"]') != null);
}

async function keepsFocus(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await writeFile(join(folder, "src", "focus-one.txt"), "one\n");
  await rowOf(session, "src/focus-one.txt", "after it was written");
  await focusRow(page, "src/focus-one.txt");
  assert.ok(await treeHoldsFocus(page), "the row did not take focus");
  await page.getByTestId("file-tab-0").focus();
  await writeFile(join(folder, "src", "focus-two.txt"), "two\n");
  await rowOf(session, "src/focus-two.txt", "after it was written beside a focused tab");
  await delay(settleMs / 2);
  const focusedNow = await activeTestId(page);
  assert.equal(focusedNow, "file-tab-0", `a refresh moved focus from the tab to ${focusedNow}`);
  await focusRow(page, "src/focus-one.txt");
  await unlink(join(folder, "src", "focus-one.txt"));
  await noRow(session, "src/focus-one.txt", "after it was deleted");
  await waitUntil(
    () => treeHoldsFocus(page),
    waitMs,
    "focus did not move to a remaining row when the focused row went away",
  );
  await unlink(join(folder, "src", "focus-two.txt"));
  await noRow(session, "src/focus-two.txt", "after it was deleted");
}

async function staysStill(session: AppSession): Promise<void> {
  const { page } = session;
  await page.getByTestId("file-tab-0").focus();
  await waitUntil(
    async () => (await page.locator('[data-testid="file-text"] .focused').count()) === 0,
    waitMs,
    "the editor kept its focus ring",
  );
  for (let round = 0; round < 10; round += 1) {
    await watchTree(page);
    await delay(quietMs);
    if ((await mutationsSeen(page)).length === 0) break;
  }
  await watchTree(page);
  for (let round = 0; round < 3; round += 1) {
    await nudge(page);
    await delay(settleMs / 3);
  }
  const seen = await mutationsSeen(page);
  assert.deepEqual(
    seen,
    [],
    `the tree, the tabs or the file changed while nothing did, ${seen.slice(0, 5).join(", ")}`,
  );
}

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((hide) => {
    if (hide) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function stopsWhenHidden(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await setHidden(page, true);
  await delay(500);
  await writeFile(join(folder, "src", "unseen.txt"), "written while hidden\n");
  await appendFile(join(folder, deepFile), "export const hidden = true;\n");
  await delay(settleMs);
  assert.ok(
    !(await rows(page)).some((row) => row.path === "src/unseen.txt"),
    "the tree read the disk while the window was hidden",
  );
  assert.ok(
    !(await editorText(page)).includes("hidden"),
    "the open file read the disk while the window was hidden",
  );
  await setHidden(page, false);
  await rowOf(session, "src/unseen.txt", "once the window was visible again");
  await editorShows(session, "hidden", "once the window was visible again");
}

async function followsTheDisk(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await appendFile(join(folder, deepFile), 'export const second = "appeared";\n');
  await editorShows(session, "appeared", "without any click after the append");
  await writeFile(join(folder, "src", "fresh.txt"), "new on disk\n");
  await rowOf(session, "src/fresh.txt", "without any click after it was written");
  await writeFile(join(folder, "src", "fresh.txt"), "new on disk, then changed\n");
  await rowLocator(page, "src/fresh.txt").click();
  await editorShows(session, "then changed", "after opening fresh.txt");
  await writeFile(join(folder, "src", "gone.txt"), "soon gone\n");
  await rowOf(session, "src/gone.txt", "after it was written");
  await rowLocator(page, "src/gone.txt").click();
  await editorShows(session, "soon gone", "after opening gone.txt");
  await unlink(join(folder, "src", "gone.txt"));
  await noRow(session, "src/gone.txt", "after it was deleted");
  await waitUntil(
    async () =>
      (await page.getByTestId("file-sentence").count()) > 0 &&
      (await page.getByTestId("file-sentence").innerText()) === "This file isn't there anymore.",
    followMs,
    "the open tab of a deleted file did not say so",
  );
  assert.equal((await tabPaths(page)).titles.length, 3, "the tab of a deleted file closed");
  await page.getByTestId("file-tab-2-close").click({ force: true });
  await waitUntil(async () => (await tabPaths(page)).titles.length === 2, waitMs, "close failed");
}

async function managesTabs(session: AppSession): Promise<void> {
  const { page } = session;
  await rowLocator(page, "README.md").click();
  await waitUntil(async () => (await tabPaths(page)).titles.length === 3, waitMs, "no third tab");
  await page.getByTestId("file-tab-0-close").click({ force: true });
  await waitUntil(async () => (await tabPaths(page)).titles.length === 2, waitMs, "close failed");
  await rowLocator(page, deepFile).click();
  await waitUntil(async () => (await tabPaths(page)).titles.length === 3, waitMs, "no reopen");
  const shown = await tabPaths(page);
  await page.locator(`[data-testid^="file-tab-"][role="tab"]`).nth(shown.active).focus();
  await page.keyboard.press("Delete");
  await waitUntil(async () => (await tabPaths(page)).titles.length === 2, waitMs, "Delete failed");
}

async function remembersTabs(session: AppSession): Promise<void> {
  const { page } = session;
  const before = await tabPaths(page);
  await session.relaunch();
  await session.page.getByTestId("workspace-repo-alpha").click();
  await session.page.getByTestId("centre-tab-files").click();
  await waitUntil(
    async () => {
      const now = await tabPaths(session.page);
      return now.titles.join("\n") === before.titles.join("\n") && now.active === before.active;
    },
    waitMs,
    "the tabs did not come back as they were",
  );
  assert.equal(
    (await rowOf(session, "src", "after the relaunch")).open,
    "false",
    "the tree opened a folder by itself",
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

async function findsByName(session: AppSession): Promise<void> {
  const { page } = session;
  while ((await page.getByTestId("file-tab-0-close").count()) > 0) {
    await page.getByTestId("file-tab-0-close").click({ force: true });
  }
  await page.getByTestId("file-empty").waitFor({ timeout: waitMs });
  await page.getByTestId("centre-tab-changes").click();
  await page.getByTestId("changes").waitFor({ timeout: waitMs });
  await page.keyboard.press(findShortcut);
  await page.getByTestId("palette").waitFor({ timeout: waitMs });
  assert.equal(
    await page.getByTestId("palette-input").getAttribute("aria-label"),
    "Open a file by name",
    "the shortcut did not open the finder",
  );
  await page.keyboard.type("needle", { delay: 30 });
  await page.getByTestId("file-result-0").waitFor({ timeout: waitMs });
  const listed = await resultPaths(page);
  assert.equal(listed[0], deepFile, `the first result was ${JSON.stringify(listed[0])}`);
  await session.screenshot("find");
  await page.keyboard.press("Enter");
  await page.getByTestId("files").waitFor({ timeout: waitMs });
  await editorShows(session, "needle", "after opening it by name");
  assert.equal((await tabPaths(page)).titles.length, 1, "opening by name made no single tab");
  assert.equal(
    (await rowOf(session, "src", "after opening by name")).open,
    "false",
    "opening by name opened a folder in the tree",
  );
  for (const name of ["debug.log", "out.js"]) {
    await page.keyboard.press(findShortcut);
    await page.getByTestId("palette-input").waitFor({ timeout: waitMs });
    await page.keyboard.type(name, { delay: 30 });
    await waitUntil(
      async () => (await page.getByTestId("palette-empty").count()) > 0,
      waitMs,
      `${name} was offered, or the finder never said nothing matched`,
    );
    assert.deepEqual(await resultPaths(page), [], `${name} was offered`);
    await page.keyboard.press("Escape");
    await page.getByTestId("palette").waitFor({ state: "detached", timeout: waitMs });
  }
}

async function openByName(session: AppSession, query: string, path: string): Promise<void> {
  const { page } = session;
  await page.keyboard.press(findShortcut);
  await page.getByTestId("palette-input").waitFor({ timeout: waitMs });
  await page.keyboard.type(query, { delay: 30 });
  await waitUntil(
    async () => (await resultPaths(page))[0] === path,
    waitMs,
    `the first result for ${query} was not ${path}`,
  );
  await page.keyboard.press("Enter");
  await page.getByTestId("palette").waitFor({ state: "detached", timeout: waitMs });
}

async function typedAfter(session: AppSession, from: number, expected: string): Promise<void> {
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
  assert.ok(!typed.includes("\r"), "the reference was submitted");
}

async function sendsLines(session: AppSession): Promise<void> {
  const { page } = session;
  await startClaude(session, 1);
  await page.keyboard.type("look at the files");
  await page.keyboard.press("Enter");
  await stateIs(session, "session-tab-1", "done", "before the lines were sent");
  await openByName(session, "src/app", "src/app.ts");
  await editorShows(session, "greet", "after opening src/app.ts");
  let from = (await session.standInEvents()).length;
  await page.locator('[data-testid="file-text"] .view-lines').first().click();
  await page.keyboard.press(linesShortcut);
  await toastReads(session, noLinesSentence, "after pressing the shortcut with nothing selected");
  assert.equal(await standInInput(session, from), "", "lines nobody selected reached the prompt");
  await session.selectFileLines(2, 3);
  await page.keyboard.press(linesShortcut);
  await typedAfter(session, from, bracketed("Lines 2 to 3 of src/app.ts in this workspace. "));

  from = (await session.standInEvents()).length;
  await focusRow(page, "README.md");
  assert.ok(await treeHoldsFocus(page), "the row did not take focus");
  await page.keyboard.press(linesShortcut);
  await delay(quickMs);
  assert.equal(
    await standInInput(session, from),
    "",
    "the shortcut sent lines with focus in the tree",
  );
  await page.getByTestId("file-send-lines").click();
  await typedAfter(session, from, bracketed("Lines 2 to 3 of src/app.ts in this workspace. "));

  await rowLocator(page, "logo.bin").click();
  await page.getByTestId("file-sentence").waitFor({ timeout: waitMs });
  from = (await session.standInEvents()).length;
  await page.getByTestId("file-send-lines").click();
  await toastReads(session, notTextSentence, "after sending lines of a binary file");
  assert.equal(await standInInput(session, from), "", "lines of a binary file reached the prompt");

  const hostile = (await rows(page)).find((row) => row.path.includes("report"));
  assert.ok(hostile !== undefined, "the hostile name was not listed");
  await rowLocator(page, hostile.path).click();
  await editorShows(session, "", "after opening the hostile name");
  await session.selectFileLines(1, 1);
  await page.keyboard.press(linesShortcut);
  await toastReads(session, hiddenNameSentence, "after sending lines of a hidden name");
  assert.equal(await standInInput(session, from), "", "a hidden name reached the prompt");
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
    await staysStill(session);
    await keepsFocus(session, folder);
    await stopsWhenHidden(session, folder);
    await followsTheDisk(session, folder);
    await managesTabs(session);
    await remembersTabs(session);
    await findsByName(session);
    await sendsLines(session);
    await session.screenshot("files");
    assert.deepEqual(session.consoleErrors, [], "the window logged errors");
  },
};
