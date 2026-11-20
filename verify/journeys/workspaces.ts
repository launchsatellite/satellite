import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { workspaceNamePattern } from "../../src/shared/workspace-name.ts";
import { isInsidePath } from "../../src/main/platform/paths.ts";
import { withoutGitVariables } from "../repo-recipe.ts";
import { gone, promptTimeoutMs, toastReads, visible, waitUntil } from "./conditions.ts";

const execute = promisify(execFile);
const waitMs = 15_000;
const commandModifier = process.platform === "darwin" ? "Meta" : "Control+Shift";
const includedFiles: [string, string][] = [
  [".env", "API_URL=http://localhost:3000\n"],
  ["config/dev.local.json", "{}\n"],
];
const leftOutFiles = ["notes.log", "node_modules", "scratch.txt"];
const onlyHere = "src/only-here.ts";
const keptCommit = "keep this commit";

function inside(folder: string, path: string): string {
  return join(folder, ...path.split("/"));
}

async function git(session: AppSession, folder: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", args, {
    cwd: folder,
    env: { ...withoutGitVariables(process.env), ...session.gitEnv },
    windowsHide: true,
  });
  return stdout;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    },
  );
}

function worktreeFolder(session: AppSession, name: string): string {
  return join(session.home, "worktrees", "repo", name);
}

async function listedWorktrees(session: AppSession): Promise<string[]> {
  const listed = await git(session, session.repo, ["worktree", "list", "--porcelain"]);
  return listed
    .split("\n")
    .flatMap((line) => (line.startsWith("worktree ") ? [line.slice("worktree ".length)] : []));
}

async function isListed(session: AppSession, name: string): Promise<boolean> {
  return (await listedWorktrees(session)).some(
    (path) => path.endsWith(`/${name}`) || path.endsWith(`\\${name}`),
  );
}

async function selectedRow(session: AppSession, name: string, when: string): Promise<void> {
  const row = session.page.getByTestId(`workspace-repo-${name}`);
  await waitUntil(
    async () => (await row.count()) > 0 && (await row.getAttribute("aria-current")) === "true",
    promptTimeoutMs,
    `workspace-repo-${name} was not the selected workspace ${when}`,
  );
}

async function openNewWorkspace(session: AppSession, open: () => Promise<void>): Promise<string> {
  await open();
  await visible(session, "create-workspace", "once the New workspace dialog had read the project");
  return session.page.getByTestId("workspace-name").inputValue();
}

async function checkIncludedFiles(session: AppSession, folder: string): Promise<void> {
  for (const [path, content] of includedFiles) {
    const copied = await readFile(inside(folder, path), "utf8").catch(() => undefined);
    assert.equal(copied, content, `${path} in first-look read ${JSON.stringify(copied)}`);
  }
  for (const path of leftOutFiles) {
    assert.ok(!(await exists(inside(folder, path))), `first-look got ${path}, which it should not`);
  }
  const subject = (await git(session, folder, ["log", "-1", "--format=%s"])).trim();
  assert.equal(
    subject,
    "second commit",
    `first-look starts from "${subject}", not the fetched main`,
  );
}

async function hasFiles(name: string, folder: string, has: string[], lacks: string[]) {
  for (const path of has) {
    assert.ok(await exists(inside(folder, path)), `${name} lacks ${path}`);
  }
  for (const path of lacks) {
    assert.ok(!(await exists(inside(folder, path))), `${name} has ${path}, which is not its own`);
  }
}

async function checkSeparateFiles(session: AppSession, first: string, second: string) {
  await mkdir(dirname(inside(first, onlyHere)), { recursive: true });
  await writeFile(inside(first, onlyHere), "export const here = true;\n");
  await hasFiles("first-look", first, [onlyHere, "CHANGELOG.md"], ["RELEASE.md"]);
  await hasFiles("second-look", second, ["RELEASE.md"], [onlyHere, "CHANGELOG.md"]);
  await hasFiles("the repo", session.repo, [], [onlyHere]);
}

async function deleteOutsideSatellite(session: AppSession, folder: string): Promise<void> {
  assert.ok(
    isInsidePath(session.home, folder) &&
      dirname(folder) === join(session.home, "worktrees", "repo"),
    `refusing to delete ${folder}, which is not a workspace folder in the session's home`,
  );
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function metaReads(session: AppSession, name: string, expected: string): Promise<void> {
  const meta = session.page.getByTestId(`workspace-repo-${name}-meta`);
  let shown = "";
  await waitUntil(
    async () => {
      shown = (await meta.count()) === 0 ? "nothing" : (await meta.innerText()).trim();
      return shown === expected;
    },
    waitMs,
    () => `workspace-repo-${name}-meta read "${shown}" instead of "${expected}"`,
  );
}

async function textOf(session: AppSession, testId: string): Promise<string> {
  return session.page.getByTestId(testId).innerText();
}

async function archiveThroughDialog(session: AppSession, folder: string): Promise<void> {
  await writeFile(join(folder, "KEEP.md"), "Kept by the branch.\n");
  await git(session, folder, ["add", "KEEP.md"]);
  await git(session, folder, ["commit", "-q", "-m", keptCommit]);
  assert.ok(await isListed(session, "first-look"), "git did not list first-look before archive");
  await session.page.getByTestId("workspace-repo-first-look").click();
  await selectedRow(session, "first-look", "after clicking it");
  await session.page.getByTestId("archive-workspace").click();
  await visible(session, "archive-confirm", "once the archive dialog had inspected first-look");
  const files = await textOf(session, "archive-files");
  assert.ok(
    files.includes("1 file isn't committed and will be deleted.") &&
      files.includes(`?? ${onlyHere}`),
    `archive-files read "${files}" without the uncommitted file`,
  );
  const commits = await textOf(session, "archive-commits");
  assert.ok(
    commits.includes("1 commit isn't pushed. The branch first-look keeps it.") &&
      commits.includes(keptCommit),
    `archive-commits read "${commits}" without the commit that is not pushed`,
  );
  await session.screenshot("workspaces-archive");
  await session.page.getByTestId("archive-confirm").click();
  await toastReads(
    session,
    "Satellite archived first-look. The branch first-look stays.",
    "after archiving first-look",
  );
  await gone(session, "workspace-repo-first-look", "after archiving it");
}

async function checkArchived(session: AppSession, folder: string): Promise<void> {
  assert.ok(!(await exists(folder)), "first-look's folder is still there after archive");
  assert.ok(!(await isListed(session, "first-look")), "git still lists first-look after archive");
  const tip = (
    await git(session, session.repo, ["log", "-1", "--format=%s", "refs/heads/first-look"])
  ).trim();
  assert.equal(tip, keptCommit, `the branch first-look ends at "${tip}" after archive`);
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  const first = worktreeFolder(session, "first-look");
  const second = worktreeFolder(session, "second-look");
  const adopted = worktreeFolder(session, "left-behind");

  await session.answerFolderDialog(session.repo);
  await page.getByTestId("add-first-project").click({ timeout: promptTimeoutMs });
  await visible(session, "new-workspace-repo", "after adding the repo");

  const suggested = await openNewWorkspace(session, () =>
    page.getByTestId("new-workspace-repo").click(),
  );
  assert.ok(workspaceNamePattern.test(suggested), `the suggested name "${suggested}" is invalid`);
  await page.getByTestId("workspace-name").fill("first-look");
  await page.keyboard.press("Enter");
  await selectedRow(session, "first-look", "after making it");
  await toastReads(session, "first-look is ready in repo.", "after making first-look");
  await checkIncludedFiles(session, first);

  await openNewWorkspace(session, () => page.keyboard.press(`${commandModifier}+N`));
  await page.getByTestId("workspace-name").fill("second-look");
  await page.getByTestId("workspace-start").selectOption({ label: "release" });
  await page.getByTestId("create-workspace").click();
  await selectedRow(session, "second-look", "after making it from release");
  await session.screenshot("workspaces-created");

  await checkSeparateFiles(session, first, second);

  await page.getByTestId("workspace-repo-first-look").click();
  await selectedRow(session, "first-look", "before second-look was deleted");
  await deleteOutsideSatellite(session, second);
  await git(session, session.repo, ["worktree", "add", "-q", "-b", "left-behind", adopted, "HEAD"]);
  await session.relaunch();
  await visible(session, "workspace-repo-first-look", "after the restart", promptTimeoutMs);
  await gone(session, "workspace-repo-second-look", "after its folder was deleted and a restart");
  await toastReads(
    session,
    "second-look left repo because its folder was deleted outside Satellite. git still counts second-look as checked out there until you run git worktree prune.",
    "after the restart",
  );
  await metaReads(session, "first-look", "1");
  await visible(session, "workspace-repo-left-behind", "after a worktree with no record was left");
  await session.screenshot("workspaces-restarted");

  await archiveThroughDialog(session, first);
  await checkArchived(session, first);

  assert.equal(
    session.consoleErrors.length,
    0,
    `the window logged ${String(session.consoleErrors.length)} console errors, the first is ${JSON.stringify(session.consoleErrors[0])}`,
  );
}

export const workspacesJourney: Journey = { name: "workspaces", scenario: "fresh-repo", run };
