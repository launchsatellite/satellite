import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, rename } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { interfaceLimits } from "../../src/shared/bridge-contract.ts";
import { withoutGitVariables } from "../repo-recipe.ts";
import { gone, promptTimeoutMs, toastReads, visible, waitUntil } from "./conditions.ts";

interface Entry {
  path: string;
  size: number;
  sha256: string;
}

const execute = promisify(execFile);
const waitMs = 15_000;
const commandModifier = process.platform === "darwin" ? "Meta" : "Control+Shift";
const narrowPresses = 4;
const menuCommands = 13;
const keyStep = 8;
const moveTimeoutMs = 5000;
const busyCodes = new Set(["EBUSY", "EPERM", "EACCES"]);

async function snapshot(root: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  const found = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of found) {
    const path = join(entry.parentPath, entry.name);
    const relativePath = relative(root, path).split("\\").join("/");
    if (entry.isDirectory()) {
      entries.push({ path: `${relativePath}/`, size: 0, sha256: "" });
      continue;
    }
    const bytes = await readFile(path);
    entries.push({
      path: relativePath,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function compareSnapshots(before: Entry[], after: Entry[]): void {
  const afterByPath = new Map(after.map((entry) => [entry.path, entry]));
  for (const entry of before) {
    const now = afterByPath.get(entry.path);
    assert.ok(now !== undefined, `alpha lost ${entry.path} after it was removed`);
    assert.ok(
      now.size === entry.size,
      `alpha's ${entry.path} changed from ${String(entry.size)} bytes to ${String(now.size)}`,
    );
    assert.ok(
      now.sha256 === entry.sha256,
      `alpha's ${entry.path} kept its size but its bytes changed`,
    );
  }
  const beforePaths = new Set(before.map((entry) => entry.path));
  const added = after.find((entry) => !beforePaths.has(entry.path));
  assert.ok(added === undefined, `alpha gained ${added?.path ?? ""} while it was in Satellite`);
}

async function addWithShortcut(session: AppSession, name: string): Promise<void> {
  await session.answerFolderDialog(session.folder(name));
  await session.page.keyboard.press(`${commandModifier}+O`);
}

async function workspaceReads(session: AppSession, name: string, branch: string): Promise<void> {
  const row = session.page.getByTestId(`workspace-${name}-main`);
  let shown = "";
  await waitUntil(
    async () => {
      shown = (await row.count()) === 0 ? "no row" : await row.innerText();
      return shown === branch;
    },
    waitMs,
    () => `workspace-${name}-main read "${shown}" instead of "${branch}"`,
  );
}

async function isSelected(session: AppSession, name: string, when: string): Promise<void> {
  const row = session.page.getByTestId(`workspace-${name}-main`);
  await waitUntil(
    async () => (await row.getAttribute("aria-current")) === "true",
    waitMs,
    `workspace-${name}-main was not selected ${when}`,
  );
}

async function projectsWidth(session: AppSession, expected: number, when: string): Promise<void> {
  const column = session.page.getByTestId("column-projects");
  let width: number | undefined;
  await waitUntil(
    async () => {
      const box = await column.boundingBox();
      width = box === null ? undefined : Math.round(box.width);
      return width === expected;
    },
    waitMs,
    () => `${when} the projects column was ${String(width)} px wide instead of ${String(expected)}`,
  );
}

async function narrowWithKeyboard(session: AppSession): Promise<number> {
  const divider = session.page.getByTestId("divider-left");
  await divider.focus();
  await waitUntil(
    () =>
      session.page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") === "divider-left",
      ),
    waitMs,
    "divider-left did not take focus",
  );
  const start = Number(await divider.getAttribute("aria-valuenow"));
  for (let press = 0; press < narrowPresses; press += 1) {
    await session.page.keyboard.press("ArrowLeft");
  }
  return Math.max(interfaceLimits.left.min, start - narrowPresses * keyStep);
}

async function moveAside(from: string, to: string, what: string): Promise<void> {
  let reason = "";
  await waitUntil(
    async () => {
      try {
        await rename(from, to);
        return true;
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "";
        if (!busyCodes.has(code)) throw error;
        reason = code;
        return false;
      }
    },
    moveTimeoutMs,
    () => `${what} could not be moved aside, the last try failed with ${reason}`,
  );
}

async function refocus(session: AppSession): Promise<void> {
  await session.page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function showsMissing(session: AppSession, name: string, when: string): Promise<void> {
  const row = session.page.getByTestId(`project-${name}`);
  let shown = "";
  await waitUntil(
    async () => {
      shown = (await row.count()) === 0 ? "no row" : await row.innerText();
      return shown.includes("MISSING");
    },
    waitMs,
    () => `project-${name} read "${shown}" ${when}, with no MISSING`,
  );
}

async function centreReads(session: AppSession, title: string, when: string): Promise<void> {
  const view = session.page.getByTestId("folder-missing");
  let shown = "";
  await waitUntil(
    async () => {
      shown = (await view.count()) === 0 ? "nothing" : await view.innerText();
      return shown.startsWith(title);
    },
    waitMs,
    () => `folder-missing read "${shown}" ${when} instead of "${title}"`,
  );
}

async function run(session: AppSession): Promise<void> {
  const before = await snapshot(session.folder("alpha"));

  await session.answerFolderDialog(session.folder("notes"));
  await session.page.getByTestId("add-first-project").click({ timeout: promptTimeoutMs });
  await toastReads(
    session,
    "notes is not a git repository. Choose the folder a repository was cloned into.",
    "after adding a plain folder",
  );
  await visible(session, "no-projects", "after the plain folder was refused");

  await addWithShortcut(session, "alpha");
  await workspaceReads(session, "alpha", "main");
  await session.dropFolder(session.folder("beta"));
  await workspaceReads(session, "beta", "develop");
  await addWithShortcut(session, "alpha");
  await toastReads(session, "alpha is already in Satellite.", "after adding alpha twice");

  const narrowed = await narrowWithKeyboard(session);
  await projectsWidth(session, narrowed, "after narrowing it with the keyboard");

  await session.page.keyboard.press(`${commandModifier}+P`);
  await session.page.getByTestId("palette-input").fill("alp");
  await session.page.keyboard.press("Enter");
  await isSelected(session, "alpha", "after choosing it in the switcher");

  await execute("git", ["switch", "-c", "feature"], {
    cwd: session.folder("beta"),
    env: { ...withoutGitVariables(process.env), ...session.gitEnv },
    windowsHide: true,
  });
  await refocus(session);
  await workspaceReads(session, "beta", "feature");

  await session.relaunch();
  await workspaceReads(session, "alpha", "main");
  await workspaceReads(session, "beta", "feature");
  await isSelected(session, "alpha", "after the restart");
  await projectsWidth(session, narrowed, "after the restart");

  await session.page.keyboard.press(`${commandModifier}+K`);
  await visible(session, "palette", "after opening the command menu");
  const listed = await session.page.locator("[data-testid^='command-']").count();
  assert.equal(
    listed,
    menuCommands,
    `the command menu listed ${String(listed)} commands instead of ${String(menuCommands)}`,
  );
  await session.page.getByTestId("palette-input").fill("remove");
  await visible(session, "command-project-remove", "in the command menu for remove");
  await session.page.keyboard.press("Enter");
  await toastReads(
    session,
    "Satellite forgot alpha. Its folder is untouched.",
    "after removing alpha",
  );
  await gone(session, "project-alpha", "after removing it");
  await session.screenshot("projects-removed");

  compareSnapshots(before, await snapshot(session.folder("alpha")));

  const betaGit = join(session.folder("beta"), ".git");
  const betaGitAside = join(session.folder("beta"), "git-aside");
  await moveAside(betaGit, betaGitAside, "beta's .git");
  await refocus(session);
  await showsMissing(session, "beta", "after its .git moved aside");
  await session.page.getByTestId("workspace-beta-main").click();
  await centreReads(
    session,
    "beta isn't a repository anymore",
    "after selecting beta without its .git",
  );
  await session.screenshot("projects-not-repository");
  await moveAside(betaGitAside, betaGit, "beta's .git on its way back");
  await refocus(session);
  await workspaceReads(session, "beta", "feature");

  await moveAside(session.folder("beta"), session.folder("beta-moved"), "beta");
  await session.relaunch();
  await showsMissing(session, "beta", "after its folder moved");
  await session.page.getByTestId("workspace-beta-main").click();
  await centreReads(session, "beta isn't where it was", "after selecting the moved beta");
  await session.screenshot("projects-missing");
  await session.page.getByTestId("remove-project").click();
  await visible(session, "no-projects", "after removing the moved beta");

  assert.equal(
    session.consoleErrors.length,
    0,
    `the window logged ${String(session.consoleErrors.length)} console errors, the first is ${JSON.stringify(session.consoleErrors[0])}`,
  );
}

export const projectsJourney: Journey = { name: "projects", scenario: "two-projects", run };
