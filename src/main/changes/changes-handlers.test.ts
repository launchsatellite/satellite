import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { BridgeOwner } from "../bridge/registry.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { createChanges } from "./changes-handlers.ts";

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
const workspace = { projectId, workspace: "main" };
const notListed = {
  code: "not-found",
  message: "That file is no longer in the list of changes. The list refreshes in a moment.",
};

function storeOf(path: string, asked: () => void): ProjectStore {
  const project = { id: projectId, path, workspaces: [] };
  return {
    list: () => Promise.resolve([project]),
    project: () => {
      asked();
      return Promise.resolve(project);
    },
    available: () => Promise.resolve(true),
    addWorkspace: () => Promise.resolve(),
    writable: () => Promise.resolve(true),
    removeWorkspace: () => Promise.resolve(),
    busy: new Set(),
    creating: new Set(),
  };
}

function ownerOf(id: number): BridgeOwner & { leave(): void } {
  const listeners: (() => void)[] = [];
  return {
    id,
    emit: () => undefined,
    onGone: (listener) => {
      listeners.push(listener);
    },
    leave: () => {
      for (const listener of listeners) listener();
    },
  };
}

async function repository() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-changes-")));
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
  const git = (...args: string[]) => run("git", ["-C", repo, ...args], { env });
  await writeFile(join(repo, "edit.txt"), "one\n");
  await writeFile(join(repo, "calm.txt"), "calm\n");
  await writeFile(join(base, "outside.txt"), "outside\n");
  await git("add", ".");
  await git("commit", "-q", "-m", "one");
  await writeFile(join(repo, "edit.txt"), "two\n");
  const asked = { count: 0, then: (): void => undefined };
  const store = storeOf(repo, () => {
    asked.count += 1;
    asked.then();
  });
  return { repo, home, asked, changes: createChanges({ home, store }) };
}

describe("changes handlers", { timeout: 30_000 }, () => {
  it("answers a file only when the page's last list named it", async () => {
    const { changes } = await repository();
    const list = changes.handlers["changes.list"];
    const file = changes.handlers["changes.file"];
    const page = ownerOf(1);
    const view = "uncommitted";
    await expect(file({ workspace, view, path: "edit.txt" }, page)).rejects.toMatchObject(
      notListed,
    );
    const listed = await list({ workspace, view }, page);
    expect(listed).toMatchObject({
      branch: "main",
      base: null,
      changes: { kind: "files", files: [{ path: "edit.txt", letter: "M" }], more: 0 },
    });
    expect(await file({ workspace, view, path: "edit.txt" }, page)).toEqual({
      kind: "text",
      original: "one\n",
      modified: "two\n",
    });
    for (const path of ["calm.txt", "../outside.txt", ".git/config", "edit.txt/"]) {
      await expect(file({ workspace, view, path }, page)).rejects.toMatchObject(notListed);
    }
    await expect(file({ workspace, view: "branch", path: "edit.txt" }, page)).rejects.toMatchObject(
      notListed,
    );
    const other = ownerOf(2);
    await expect(file({ workspace, view, path: "edit.txt" }, other)).rejects.toMatchObject(
      notListed,
    );
    page.leave();
    await expect(file({ workspace, view, path: "edit.txt" }, page)).rejects.toMatchObject(
      notListed,
    );
  });

  it("stops a page's older list when it asks for another view", async () => {
    const { changes } = await repository();
    const list = changes.handlers["changes.list"];
    const page = ownerOf(1);
    const first = list({ workspace, view: "uncommitted" }, page);
    const second = list({ workspace, view: "branch" }, page);
    await expect(first).rejects.toMatchObject({
      code: "refused",
      message: "Satellite moved on to a newer read.",
    });
    expect(await second).toMatchObject({ changes: { kind: "unavailable", reason: "no-base" } });
    const same = [
      list({ workspace, view: "uncommitted" }, page),
      list({ workspace, view: "uncommitted" }, page),
    ];
    const [one, two] = await Promise.all(same);
    expect(one).toBe(two);
  });

  it("stops every read inside a folder that is going away", async () => {
    const { repo, asked, changes } = await repository();
    const page = ownerOf(1);
    const start = asked.count;
    asked.then = () => {
      if (asked.count === start + 3) void changes.stopInside(repo);
    };
    const reading = changes.handlers["changes.list"]({ workspace, view: "uncommitted" }, page);
    await expect(reading).rejects.toMatchObject({
      code: "not-found",
      message: "That workspace's folder is gone, so Satellite can't show its changes.",
    });
  });
});
