import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { AppSession } from "../driver.ts";
import { withoutGitVariables } from "../repo-recipe.ts";
import type { Journey } from "../journeys.ts";
import {
  claudePids,
  goneTimeoutMs,
  processGone,
  settingsFileOf,
  startClaude,
  stateIs,
  waitUntil,
} from "./conditions.ts";

interface Snapshot {
  hashes: Record<string, string>;
  status: Record<string, string>;
}

const run = promisify(execFile);
const ownerOnly = 0o600;
const settingsShape = z.record(z.string(), z.unknown());

async function hashesUnder(folder: string, into: Record<string, string>): Promise<void> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    into[path] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  }
}

async function gitStatus(session: AppSession, folder: string): Promise<string> {
  const { stdout } = await run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: folder,
    env: { ...withoutGitVariables(process.env), ...session.gitEnv },
    windowsHide: true,
  });
  return stdout;
}

async function snapshot(session: AppSession, alpha: string): Promise<Snapshot> {
  const hashes: Record<string, string> = {};
  for (const folder of [
    session.claudeConfig,
    join(session.repo, ".claude"),
    join(alpha, ".claude"),
  ]) {
    await hashesUnder(folder, hashes);
  }
  return {
    hashes,
    status: {
      repo: await gitStatus(session, session.repo),
      alpha: await gitStatus(session, alpha),
    },
  };
}

async function settingsLeft(home: string): Promise<string[]> {
  const names = await readdir(join(home, "sessions")).catch(() => []);
  return names.filter((name) => name.endsWith(".json"));
}

async function promptToDone(session: AppSession, row: string, count: number): Promise<number> {
  await session.page.getByTestId(row).click();
  const pid = await startClaude(session, count);
  await session.page.keyboard.type("go");
  await session.page.keyboard.press("Enter");
  await stateIs(session, `${row}-status`, "done", `after the prompt in ${row}`);
  return pid;
}

async function checkSettingsFile(session: AppSession, pid: number): Promise<void> {
  const file = await settingsFileOf(session, pid);
  const sessions = join(session.home, "sessions");
  assert.equal(dirname(file), sessions, `the settings file ${file} is outside the sessions folder`);
  if (process.platform !== "win32") {
    const mode = (await stat(file)).mode & 0o777;
    assert.equal(mode, ownerOnly, `the settings file has mode ${mode.toString(8)}, not 600`);
  }
  const keys = Object.keys(settingsShape.parse(JSON.parse(await readFile(file, "utf8"))));
  assert.deepEqual(keys, ["hooks"], `the settings file holds ${JSON.stringify(keys)}`);
}

async function journey(session: AppSession): Promise<void> {
  const { page } = session;
  const alpha = join(session.home, "worktrees", "repo", "alpha");
  const before = await snapshot(session, alpha);
  assert.ok(
    Object.keys(before.hashes).length >= 6,
    `only ${Object.keys(before.hashes).join(", ")} were found to compare`,
  );
  const mainPid = await promptToDone(session, "workspace-repo-main", 1);
  const alphaPid = await promptToDone(session, "workspace-repo-alpha", 2);
  await checkSettingsFile(session, mainPid);
  await checkSettingsFile(session, alphaPid);
  await page.getByTestId("close-session-1").click();
  await page.getByTestId("workspace-repo-main").click();
  await page.getByTestId("close-session-1").click();
  for (const pid of await claudePids(session)) {
    await waitUntil(
      () => processGone(pid),
      goneTimeoutMs,
      `the stand-in ${String(pid)} still ran after its tab closed`,
    );
  }
  let after: Snapshot | undefined;
  let left: string[] = [];
  await session.relaunch(async () => {
    after = await snapshot(session, alpha);
    left = await settingsLeft(session.home);
  });
  assert.ok(after !== undefined, "nothing was compared while the app was closed");
  assert.deepEqual(after.hashes, before.hashes, "a Claude Code settings file changed");
  assert.deepEqual(after.status, before.status, "git status changed in the repo or alpha");
  assert.deepEqual(left, [], `settings files outlived their sessions, ${left.join(", ")}`);
}

export const settingsJourney: Journey = {
  name: "settings",
  scenario: "settings-files",
  run: journey,
};
