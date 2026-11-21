import assert from "node:assert/strict";
import { appendFile, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { waitUntil } from "./conditions.ts";

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

const waitMs = 15_000;
const followMs = 45_000;
const settleMs = 6000;
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
  const byPath = new Map(listed.map((row) => [row.path, row]));
  assert.equal(byPath.get("README.md")?.state, "M", "README.md did not read M");
  assert.equal(byPath.get("it's new.txt")?.state, "A", "it's new.txt did not read A");
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

async function staysStill(session: AppSession): Promise<void> {
  const { page } = session;
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
    await followsTheDisk(session, folder);
    await managesTabs(session);
    await remembersTabs(session);
    await session.screenshot("files");
    assert.deepEqual(session.consoleErrors, [], "the window logged errors");
  },
};
