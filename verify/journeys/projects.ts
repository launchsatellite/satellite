import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, rename } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
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
  await addWithShortcut(session, "beta");
  await workspaceReads(session, "beta", "develop");
  await addWithShortcut(session, "alpha");
  await toastReads(session, "alpha is already in Satellite.", "after adding alpha twice");

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
  await runCommand(session, "move this repo down", "command-project-down");
  await waitUntil(
    async () => (await topOf(session, "beta")) < (await topOf(session, "alpha")),
    promptTimeoutMs,
    "beta never rose above alpha after Move this repo down",
  );

  await session.relaunch();
  await workspaceReads(session, "alpha", "main");
  await workspaceReads(session, "beta", "feature");
  await isSelected(session, "alpha", "after the restart");
  assert.ok(
    (await topOf(session, "beta")) < (await topOf(session, "alpha")),
    "alpha moved down was above beta again after the restart",
  );

  await runCommand(session, "remove", "command-project-remove");
  await visible(session, "remove-project-dialog", "after Remove this repo");
  await session.page.getByTestId("remove-project-confirm").click();
  await toastReads(
    session,
    "Satellite removed alpha. Its folder is untouched.",
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

  const agentMade = join(session.folder("beta"), ".claude", "worktrees", "Agent_One");
  await gitInBeta(session, ["worktree", "add", "-q", "-b", "agent-one", agentMade]);
  await refocus(session);
  await visible(session, "workspace-beta-agent-one", "after an agent made a worktree in beta");
  await session.page.getByTestId("workspace-beta-agent-one").hover();
  assert.equal(
    await session.page.getByTestId("archive-workspace-beta-agent-one").count(),
    0,
    "the worktree an agent made offered Archive",
  );
  await session.page.getByTestId("workspace-beta-agent-one").click();
  await session.page.getByTestId("rail-tab-files").click();
  await waitUntil(
    async () =>
      (await session.page.getByTestId("files-tree").locator('[data-path="README.md"]').count()) > 0,
    waitMs,
    "Files never listed README.md in the worktree an agent made",
  );
  await session.screenshot("projects-agent-worktree");
  await gitInBeta(session, ["worktree", "remove", "-f", agentMade]);
  await refocus(session);
  await gone(session, "workspace-beta-agent-one", "after the agent removed its worktree");
  await session.page.getByTestId("workspace-beta-main").click();

  await gitInBeta(session, [
    "worktree",
    "add",
    "-q",
    "-b",
    "kept",
    join(session.home, "worktrees", "beta", "kept"),
  ]);
  await refocus(session);
  await visible(session, "workspace-beta-kept", "after a worktree was left in beta's folder");

  await moveAside(session.folder("beta"), session.folder("beta-moved"), "beta");
  await session.relaunch();
  await showsMissing(session, "beta", "after its folder moved");
  assert.equal(
    (await session.page.getByTestId("workspace-beta-main").innerText()).trim(),
    "main",
    "the moved beta's row lost its branch",
  );
  await session.page.getByTestId("workspace-beta-main").click();
  await centreReads(session, "beta isn't where it was", "after selecting the moved beta");
  const kept = "Its workspace's folder stays in worktrees/beta in the Satellite home.";
  const centre = await session.page.getByTestId("folder-missing").innerText();
  assert.ok(centre.endsWith(kept), `folder-missing read "${centre}" without "${kept}"`);
  await session.screenshot("projects-missing");
  await session.page.getByTestId("project-beta").hover();
  await session.page.getByTestId("remove-project-beta").click();
  await visible(session, "remove-project-dialog", "after Remove beta in the sidebar");
  await session.page.getByTestId("remove-project-confirm").click();
  await toastReads(
    session,
    "Satellite removed beta and its 1 workspace. The workspace's folder stays in worktrees/beta in the Satellite home.",
    "after removing the moved beta",
  );
  await visible(session, "no-projects", "after removing the moved beta");

  assert.equal(
    session.consoleErrors.length,
    0,
    `the window logged ${String(session.consoleErrors.length)} console errors, the first is ${JSON.stringify(session.consoleErrors[0])}`,
  );
}

async function gitInBeta(session: AppSession, args: string[]): Promise<void> {
  await execute("git", args, {
    cwd: session.folder("beta"),
    env: { ...withoutGitVariables(process.env), ...session.gitEnv },
    windowsHide: true,
  });
}

async function topOf(session: AppSession, name: string): Promise<number> {
  return (await session.page.getByTestId(`project-${name}`).boundingBox())?.y ?? Number.NaN;
}

async function runCommand(session: AppSession, query: string, testId: string): Promise<void> {
  await session.page.keyboard.press(`${commandModifier}+K`);
  await visible(session, "palette", `after opening the command menu for ${query}`);
  await session.page.getByTestId("palette-input").fill(query);
  await visible(session, testId, `in the command menu for ${query}`);
  await session.page.keyboard.press("Enter");
}

export const projectsJourney: Journey = { name: "projects", scenario: "two-projects", run };
