import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderListing } from "../../shared/bridge-contract.ts";
import { listFolder } from "./folder-listing.ts";
import { readFileForViewing } from "./file-read.ts";
import { readNames } from "./name-index.ts";
import {
  git,
  isolateGit,
  makeRepository,
  mockedEnvironment,
  put,
  scratch,
  snapshot,
} from "./repository-fixture.ts";

vi.mock("../platform/user-environment.ts", () => ({
  userEnvironment: () => mockedEnvironment(),
}));

beforeEach(isolateGit);
afterEach(() => {
  vi.unstubAllEnvs();
});

function shown(listing: FolderListing): string[] | string {
  return listing.state === "listed"
    ? listing.entries.map((entry) => `${entry.ignored ? "~" : ""}${entry.kind}:${entry.name}`)
    : listing.state;
}

async function makeMany(folder: string, count: number): Promise<void> {
  await mkdir(folder, { recursive: true });
  for (let at = 0; at < count; at += 250) {
    const batch = Array.from({ length: Math.min(250, count - at) }, (_, i) =>
      writeFile(join(folder, `f${String(at + i).padStart(5, "0")}`), ""),
    );
    await Promise.all(batch);
  }
}

describe("listFolder", () => {
  it("lists folders first, shows ignored entries and dot files flagged, and leaves out .git", async () => {
    const root = await makeRepository();
    await put(root, {
      ".gitignore": "*.log\nbuild/\n",
      "b.txt": "x",
      "a.txt": "x",
      "debug.log": "x",
      ".dotfile": "x",
      "z/inner.txt": "x",
      "build/out.js": "x",
      "src/app.ts": "x",
    });
    expect(shown(await listFolder(root, ""))).toEqual([
      "~folder:build",
      "folder:src",
      "folder:z",
      "file:.dotfile",
      "file:.gitignore",
      "file:a.txt",
      "file:b.txt",
      "~file:debug.log",
    ]);
    expect(shown(await listFolder(root, "build"))).toEqual(["~file:out.js"]);
    expect(shown(await listFolder(root, "src"))).toEqual(["file:app.ts"]);
  });

  it("shows entries plain when the ignore check cannot answer", async () => {
    const root = await makeRepository();
    await put(root, { ".gitignore": "*.log\n", "debug.log": "x", "a.txt": "x" });
    await writeFile(join(root, ".git", "index"), "not an index");
    expect(shown(await listFolder(root, ""))).toEqual([
      "file:.gitignore",
      "file:a.txt",
      "file:debug.log",
    ]);
  });

  it("does not flag a tracked file that an ignore pattern matches", async () => {
    const root = await makeRepository();
    await put(root, {
      ".gitignore": "*.log\nbuild/\n",
      "build/forced.js": "x",
      "build/other.js": "x",
    });
    await git(root, "add", "-f", "build/forced.js");
    expect(shown(await listFolder(root, "build"))).toEqual(["file:forced.js", "~file:other.js"]);
  });

  it("marks a folder that holds a .git entry as a repository and a link as a link", async () => {
    const root = await makeRepository();
    const outside = join(await scratch(), "outside");
    await mkdir(outside);
    await put(root, {
      "nested/.git": "gitdir: ../elsewhere\n",
      "nested/a.txt": "x",
      "plain/a": "x",
    });
    await symlink(outside, join(root, "linked"), "junction");
    expect(shown(await listFolder(root, ""))).toEqual([
      "repository:nested",
      "folder:plain",
      "link:linked",
    ]);
    await put(root, { "nested/sub/b.txt": "x" });
    expect(await listFolder(root, "nested")).toEqual({ state: "unreadable" });
    expect(await listFolder(root, "nested/sub")).toEqual({ state: "unreadable" });
    expect(await listFolder(root, "nested/missing")).toEqual({ state: "unreadable" });
  });

  it.skipIf(process.platform === "win32")(
    "marks a link to a file as a link and leaves out a pipe",
    async () => {
      const root = await makeRepository();
      await put(root, { "a.txt": "x" });
      await symlink("a.txt", join(root, "to-file"));
      const { execFileSync } = await import("node:child_process");
      execFileSync("mkfifo", [join(root, "pipe")]);
      expect(shown(await listFolder(root, ""))).toEqual(["file:a.txt", "link:to-file"]);
    },
  );

  it("refuses a folder reached through a linked folder, .git, .., an absolute path and a drive path", async () => {
    const root = await makeRepository();
    const outside = join(await scratch(), "outside");
    await put(outside, { "deep/x.txt": "x" });
    await symlink(outside, join(root, "linked"), "junction");
    await put(root, { "sub/inner/a.txt": "x" });
    for (const folder of [
      "linked",
      "linked/deep",
      ".git",
      ".GIT/hooks",
      "..",
      "../outside",
      "sub/../..",
      "/etc",
      "C:/Windows",
      "C:",
      "sub\\inner",
      "sub//inner",
      "sub/",
    ]) {
      expect(await listFolder(root, folder)).toEqual({ state: "unreadable" });
    }
    expect(shown(await listFolder(root, "sub/inner"))).toEqual(["file:a.txt"]);
  });

  it("answers too-many past the scan limit and cuts the list at 1000 with the rest counted", async () => {
    const root = await makeRepository();
    await makeMany(join(root, "huge"), 5001);
    await makeMany(join(root, "many"), 1100);
    expect(await listFolder(root, "huge")).toEqual({ state: "too-many" });
    const listing = await listFolder(root, "many");
    expect(listing.state === "listed" && listing.entries.length).toBe(1000);
    expect(listing.state === "listed" && listing.more).toBe(100);
  });

  it("answers missing for a folder that is gone and for a file", async () => {
    const root = await makeRepository();
    await put(root, { "a.txt": "x" });
    expect(await listFolder(root, "nope")).toEqual({ state: "missing" });
    expect(await listFolder(root, "nope/deeper")).toEqual({ state: "missing" });
    expect(await listFolder(root, "a.txt")).toEqual({ state: "missing" });
    expect(await listFolder(join(root, "gone"), "")).toEqual({ state: "missing" });
  });

  it("writes nothing into the repository", async () => {
    const root = await makeRepository();
    await put(root, { ".gitignore": "*.log\n", "a.txt": "x", "debug.log": "x", "src/b.ts": "x" });
    await git(root, "add", "a.txt");
    const before = await snapshot(join(root, ".git"));
    await listFolder(root, "");
    await listFolder(root, "src");
    await readNames(root);
    await readFileForViewing(root, "a.txt", null);
    expect(await snapshot(join(root, ".git"))).toEqual(before);
  });
});
