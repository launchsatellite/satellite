import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { BridgeOwner } from "../bridge/registry.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { createChanges } from "./changes-handlers.ts";

interface Held {
  release: () => void;
  started: number;
  result: { kind: "none" } | undefined;
}

const held = vi.hoisted((): Held => ({ release: () => undefined, started: 0, result: undefined }));

vi.mock("./conflict-check.ts", () => ({
  knownConflict: () => held.result,
  conflictCheck: () => {
    held.started += 1;
    return new Promise((settle) => {
      held.release = () => {
        held.result = { kind: "none" };
        settle({ kind: "none" });
      };
    });
  },
}));

vi.mock("../platform/user-environment.ts", () => ({
  userEnvironment: () =>
    Promise.resolve(
      Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    ),
}));

const run = promisify(execFile);
const projectId = "0b9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e";
const owner: BridgeOwner = { id: 1, emit: () => undefined, onGone: () => undefined };

async function movedBase() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-trial-")));
  const repo = join(base, "repo");
  const home = join(base, "home");
  const config = join(base, "gitconfig");
  await mkdir(home);
  await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  const env = { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
  await run("git", ["init", "-q", "-b", "main", repo], { env });
  const git = async (...args: string[]) =>
    (await run("git", ["-C", repo, ...args], { env })).stdout.trim();
  await writeFile(join(repo, "a.txt"), "one\n");
  await git("add", ".");
  await git("commit", "-q", "-m", "one");
  const first = await git("rev-parse", "HEAD");
  await git("switch", "-q", "-c", "other");
  await writeFile(join(repo, "a.txt"), "other\n");
  await git("commit", "-q", "-am", "other");
  const moved = await git("rev-parse", "HEAD");
  await git("switch", "-q", "main");
  await writeFile(join(repo, "a.txt"), "mine\n");
  await git("commit", "-q", "-am", "mine");
  await git("update-ref", "refs/remotes/origin/main", moved);
  await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  await git("remote", "add", "origin", base);
  expect(first).not.toBe(moved);
  const project = { id: projectId, path: repo, workspaces: [] };
  const store: ProjectStore = {
    list: () => Promise.resolve([project]),
    project: () => Promise.resolve(project),
    available: () => Promise.resolve(true),
    addWorkspace: () => Promise.resolve(),
    writable: () => Promise.resolve(true),
    removeWorkspace: () => Promise.resolve(),
    busy: new Set(),
    creating: new Set(),
  };
  return createChanges({ home, store });
}

describe("changes.list and the trial merge", { timeout: 30_000 }, () => {
  it("answers at once while a trial merge is held open, then carries its result", async () => {
    const changes = await movedBase();
    const ask = () =>
      changes.handlers["changes.list"](
        { workspace: { projectId, workspace: "main" }, view: "branch" },
        owner,
      );
    const first = await ask();
    expect(first.conflict).toBeNull();
    expect(held.started).toBe(1);
    await ask();
    expect(held.started).toBe(1);
    held.release();
    const after = await ask();
    expect(after.conflict).toBeNull();
    expect(held.started).toBe(1);
  });
});
