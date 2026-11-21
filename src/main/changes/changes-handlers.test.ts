import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { BridgeOwner } from "../bridge/registry.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { changesStopWaitMs, createChanges } from "./changes-handlers.ts";

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

function storeOf(path: string | (() => string), asked: () => void): ProjectStore {
  const project = {
    id: projectId,
    get path() {
      return typeof path === "string" ? path : path();
    },
    workspaces: [],
  };
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
  return { repo, git, env, home, asked, changes: createChanges({ home, store }) };
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

  it("answers a file only from the folder its list read", async () => {
    const first = await repository();
    const second = await repository();
    let path = first.repo;
    const changes = createChanges({
      home: first.home,
      store: storeOf(
        () => path,
        () => undefined,
      ),
    });
    const page = ownerOf(1);
    const view = "uncommitted";
    await changes.handlers["changes.list"]({ workspace, view }, page);
    path = second.repo;
    await expect(
      changes.handlers["changes.file"]({ workspace, view, path: "edit.txt" }, page),
    ).rejects.toMatchObject(notListed);
  });

  it("keeps a page's last 8 lists and forgets older ones", async () => {
    const { repo, home } = await repository();
    const changes = createChanges({ home, store: storeOf(repo, () => undefined) });
    const page = ownerOf(1);
    const view = "uncommitted";
    const projects = Array.from(
      { length: 9 },
      (_, at) => `0b9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d${String(at).padStart(2, "0")}`,
    );
    for (const id of projects) {
      await changes.handlers["changes.list"](
        { workspace: { ...workspace, projectId: id }, view },
        page,
      );
    }
    const fileOf = (id: string) =>
      changes.handlers["changes.file"](
        { workspace: { ...workspace, projectId: id }, view, path: "edit.txt" },
        page,
      );
    await expect(fileOf(projects[0] ?? "")).rejects.toMatchObject(notListed);
    for (const id of projects.slice(1)) {
      expect(await fileOf(id)).toMatchObject({ kind: "text", modified: "two\n" });
    }
  });

  it("stops a page's older file read when it asks for another", async () => {
    const { changes } = await repository();
    const page = ownerOf(1);
    const view = "uncommitted";
    await changes.handlers["changes.list"]({ workspace, view }, page);
    const older = changes.handlers["changes.file"]({ workspace, view, path: "edit.txt" }, page);
    const newer = changes.handlers["changes.file"]({ workspace, view, path: "edit.txt" }, page);
    await expect(older).rejects.toMatchObject({
      code: "refused",
      message: "Satellite moved on to a newer read.",
    });
    expect(await newer).toMatchObject({ kind: "text" });
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

  it("reads a submodule moved only in its worktree as changed, not removed", async () => {
    const { repo, git, env, changes } = await repository();
    const module = join(repo, "module");
    const inModule = (...args: string[]) => run("git", ["-C", module, ...args], { env });
    await run("git", ["init", "-q", "-b", "main", module], { env });
    await inModule("commit", "-q", "--allow-empty", "-m", "one");
    const { stdout } = await inModule("rev-parse", "HEAD");
    await git("update-index", "--add", "--cacheinfo", `160000,${stdout.trim()},module`);
    await git("commit", "-q", "-m", "module");
    await inModule("commit", "-q", "--allow-empty", "-m", "two");
    const page = ownerOf(1);
    const view = "uncommitted";
    await changes.handlers["changes.list"]({ workspace, view }, page);
    expect(
      await changes.handlers["changes.file"]({ workspace, view, path: "module" }, page),
    ).toEqual({ kind: "submodule", from: null, to: null });
  });

  it("waits a bounded time for a read inside a folder that is going away", async () => {
    const { repo, home } = await repository();
    const { promise: reached, resolve: reach } = Promise.withResolvers<undefined>();
    const recorded = storeOf(repo, () => undefined);
    let asked = 0;
    const store: ProjectStore = {
      ...recorded,
      project: (id) => {
        asked += 1;
        if (asked < 3) return recorded.project(id);
        reach(undefined);
        return new Promise(() => undefined);
      },
    };
    const changes = createChanges({ home, store });
    const reading = changes.handlers["changes.list"](
      { workspace, view: "uncommitted" },
      ownerOf(1),
    );
    reading.catch(() => undefined);
    await reached;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let stopped = false;
      const stopping = changes.stopInside(repo).then(() => {
        stopped = true;
      });
      await vi.advanceTimersByTimeAsync(changesStopWaitMs - 1);
      expect(stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await stopping;
      expect(stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  describe("a named base", () => {
    async function withRemote() {
      const made = await repository();
      const { git, repo } = made;
      await git("commit", "-q", "-am", "two");
      await git("remote", "add", "origin", join(repo, "..", "elsewhere"));
      const first = (await git("rev-parse", "HEAD~1")).stdout.trim();
      await git("update-ref", "refs/remotes/origin/main", first);
      await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
      await git("update-ref", "refs/remotes/origin/dev", "HEAD");
      await git("checkout", "-q", "-b", "work");
      await writeFile(join(repo, "calm.txt"), "busy\n");
      await git("commit", "-q", "-am", "three");
      return made;
    }
    const files = (listed: unknown) =>
      typeof listed === "object" && listed !== null && "changes" in listed
        ? JSON.stringify(listed.changes)
        : "";

    it("reads the branch diff against a named base", async () => {
      const { changes } = await withRemote();
      const page = ownerOf(1);
      const listed = await changes.handlers["changes.list"](
        { workspace, view: "branch", base: "dev" },
        page,
      );
      expect(listed).toMatchObject({
        base: "origin/dev",
        changes: { kind: "files", files: [{ path: "calm.txt" }] },
      });
      expect(files(listed)).not.toContain("edit.txt");
    });

    it("answers no-base for a base branch with no remote ref", async () => {
      const { changes } = await withRemote();
      const listed = await changes.handlers["changes.list"](
        { workspace, view: "branch", base: "absent" },
        ownerOf(1),
      );
      expect(listed).toMatchObject({ changes: { kind: "unavailable", reason: "no-base" } });
    });

    it("keeps the default base when none is named", async () => {
      const { changes } = await withRemote();
      const listed = await changes.handlers["changes.list"](
        { workspace, view: "branch" },
        ownerOf(1),
      );
      expect(listed).toMatchObject({ base: "origin/main" });
      expect(files(listed)).toContain("edit.txt");
      expect(files(listed)).toContain("calm.txt");
    });

    it("caches a named base apart from the default", async () => {
      const { changes } = await withRemote();
      const page = ownerOf(1);
      await changes.handlers["changes.list"]({ workspace, view: "branch", base: "dev" }, page);
      await expect(
        changes.handlers["changes.file"](
          { workspace, view: "branch", path: "edit.txt", base: "dev" },
          page,
        ),
      ).rejects.toMatchObject(notListed);
      await expect(
        changes.handlers["changes.file"]({ workspace, view: "branch", path: "calm.txt" }, page),
      ).rejects.toMatchObject(notListed);
      expect(
        await changes.handlers["changes.file"](
          { workspace, view: "branch", path: "calm.txt", base: "dev" },
          page,
        ),
      ).toMatchObject({ kind: "text", modified: "busy\n" });
    });
  });
});
