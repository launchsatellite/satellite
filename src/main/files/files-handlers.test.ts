import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeOwner } from "../bridge/registry.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { createFiles, nameIndexMs } from "./files-handlers.ts";
import {
  git,
  isolateGit,
  makeRepository,
  mockedEnvironment,
  put,
  scratch,
} from "./repository-fixture.ts";

const held = vi.hoisted(() => ({ reads: 0 }));

vi.mock("../platform/user-environment.ts", () => ({
  userEnvironment: () => mockedEnvironment(),
}));
vi.mock("./file-read.ts", async (original) => {
  const real = await original<typeof import("./file-read.ts")>();
  return { readFileForViewing: vi.fn(real.readFileForViewing) };
});
vi.mock("./folder-listing.ts", async (original) => {
  const real = await original<typeof import("./folder-listing.ts")>();
  return { listFolders: vi.fn(real.listFolders) };
});
vi.mock("./name-index.ts", async (original) => {
  const real = await original<typeof import("./name-index.ts")>();
  return { ...real, readNames: vi.fn(real.readNames) };
});

const { readFileForViewing } = await import("./file-read.ts");
const { listFolders } = await import("./folder-listing.ts");
const { readNames } = await import("./name-index.ts");

const projectId = "0b9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e";
const workspace = { projectId, workspace: "main" };
const movedOn = { code: "refused", message: "Satellite moved on to a newer read." };

beforeEach(isolateGit);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(readFileForViewing).mockClear();
  vi.mocked(listFolders).mockClear();
  vi.mocked(readNames).mockClear();
  held.reads = 0;
});

function storeOf(path: string): ProjectStore {
  const project = { id: projectId, path, workspaces: [] };
  return {
    list: () => Promise.resolve([project]),
    project: () => Promise.resolve(project),
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
  const repo = await makeRepository();
  await put(repo, { "a/one.txt": "one\n", "b/two.txt": "two\n", "top.txt": "top\n" });
  await git(repo, "add", ".");
  await git(repo, "commit", "-q", "-m", "one");
  const home = await scratch();
  return { repo, home, files: createFiles({ home, store: storeOf(repo) }) };
}

function holdNextRead() {
  const { promise, resolve } = Promise.withResolvers<{ kind: "gone" }>();
  vi.mocked(readFileForViewing).mockImplementationOnce(() => {
    held.reads += 1;
    return promise;
  });
  return () => {
    resolve({ kind: "gone" });
  };
}

async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("files handlers", { timeout: 30_000 }, () => {
  it("answers a listing in the order asked and each folder once", async () => {
    const { files } = await repository();
    const listed = await files.handlers["files.list"](
      { workspace, folders: ["b", "a", "b", ""] },
      ownerOf(1),
    );
    expect(listed.folders.map(({ path }) => path)).toEqual(["b", "a", ""]);
    expect(listed.folders.map(({ listing }) => listing.state)).toEqual([
      "listed",
      "listed",
      "listed",
    ]);
    expect(vi.mocked(listFolders)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listFolders).mock.calls[0]?.[1]).toEqual(["b", "a", ""]);
  });

  it("a newer list stops the page's older one and answers refused", async () => {
    const { files } = await repository();
    const { promise, resolve } = Promise.withResolvers<{ state: "missing" }[]>();
    vi.mocked(listFolders).mockImplementationOnce(() => promise);
    const page = ownerOf(1);
    const older = files.handlers["files.list"]({ workspace, folders: ["a", "b"] }, page);
    await until(() => vi.mocked(listFolders).mock.calls.length === 1);
    const newer = files.handlers["files.list"]({ workspace, folders: ["b"] }, page);
    resolve([{ state: "missing" }, { state: "missing" }]);
    await expect(older).rejects.toMatchObject(movedOn);
    expect((await newer).folders).toHaveLength(1);
    expect(vi.mocked(listFolders)).toHaveBeenCalledTimes(2);
  });

  it("a read of a path the rules refuse reads nothing", async () => {
    const { repo, files } = await repository();
    const outside = await scratch();
    await writeFile(join(outside, "secret.txt"), "secret\n");
    await symlink(outside, join(repo, "out"), "junction");
    const page = ownerOf(1);
    const read = (path: string) =>
      files.handlers["files.read"]({ workspace, path, known: null }, page);
    for (const path of [
      "../x",
      "a/../../x",
      "/etc/hosts",
      "C:\\Windows",
      ".git/config",
      ".GIT/HEAD",
      "out/secret.txt",
    ]) {
      expect(await read(path)).toEqual({ kind: "unreadable" });
    }
    expect(await read("top.txt")).toMatchObject({ kind: "text", text: "top\n" });
  });

  it("a page that goes stops its reads and drops its names", async () => {
    const { files } = await repository();
    const page = ownerOf(1);
    const release = holdNextRead();
    const reading = files.handlers["files.read"]({ workspace, path: "top.txt", known: null }, page);
    await until(() => held.reads === 1);
    page.leave();
    release();
    await expect(reading).rejects.toMatchObject(movedOn);
    const find = (owner: BridgeOwner) =>
      files.handlers["files.find"]({ workspace, query: "top" }, owner);
    await find(page);
    await find(page);
    expect(vi.mocked(readNames)).toHaveBeenCalledTimes(1);
    page.leave();
    await find(page);
    expect(vi.mocked(readNames)).toHaveBeenCalledTimes(2);
  });

  it("archiving a workspace stops its reads", async () => {
    const { repo, files } = await repository();
    const release = holdNextRead();
    const reading = files.handlers["files.read"](
      { workspace, path: "top.txt", known: null },
      ownerOf(1),
    );
    await until(() => held.reads === 1);
    const stopping = files.stopInside(repo);
    release();
    await expect(reading).rejects.toMatchObject({
      code: "not-found",
      message: "That workspace's folder is gone, so Satellite can't show its files.",
    });
    await stopping;
  });

  it("answers not-found for a workspace the page does not own and limit past 16 waiting", async () => {
    const { files } = await repository();
    await expect(
      files.handlers["files.list"](
        {
          workspace: { projectId, workspace: "7f3a1c2e-9b4d-4e5f-8a6b-0c1d2e3f4a5b" },
          folders: [""],
        },
        ownerOf(1),
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    const releases: (() => void)[] = [];
    const reads: Promise<unknown>[] = [];
    for (let at = 0; at < 20; at += 1) {
      releases.push(holdNextRead());
      reads.push(
        files.handlers["files.read"]({ workspace, path: "top.txt", known: null }, ownerOf(10 + at)),
      );
    }
    await until(() => held.reads === 4);
    const over = files.handlers["files.read"](
      { workspace, path: "top.txt", known: null },
      ownerOf(99),
    );
    await expect(over).rejects.toMatchObject({
      code: "limit",
      message: "Satellite is reading a lot of files at once. It tries again in a moment.",
    });
    for (let at = 0; at < releases.length; at += 1) {
      await until(() => held.reads > at);
      releases[at]?.();
    }
    await Promise.all(reads);
  });

  it("reuses the name list for five seconds and reads again after", async () => {
    const { files } = await repository();
    const page = ownerOf(1);
    const find = (query: string) => files.handlers["files.find"]({ workspace, query }, page);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect(await find("one")).toEqual({ kind: "found", paths: ["a/one.txt"] });
      expect(await find("two")).toEqual({ kind: "found", paths: ["b/two.txt"] });
      expect(vi.mocked(readNames)).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + nameIndexMs + 1);
      await find("one");
      expect(vi.mocked(readNames)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
