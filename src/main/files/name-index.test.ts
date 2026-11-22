import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filesLimits } from "../../shared/bridge-contract.ts";
import { rankFiles, rankReadable, readableNames, readNames } from "./name-index.ts";
import {
  git,
  isolateGit,
  makeRepository,
  mockedEnvironment,
  put,
  scratch,
} from "./repository.test-fixture.ts";

vi.mock("../platform/user-environment.ts", () => ({
  userEnvironment: () => mockedEnvironment(),
}));

beforeEach(isolateGit);
afterEach(() => {
  vi.unstubAllEnvs();
});

async function sortedNames(root: string, limit?: number) {
  const index = await readNames(root, undefined, limit);
  return index.kind === "names" ? index.names.sort() : index.kind;
}

describe("readNames", () => {
  it("lists tracked and untracked files, hides ignored ones and drops nested repositories and duplicates", async () => {
    const root = await makeRepository();
    await put(root, {
      ".gitignore": "*.log\nbuild/\n",
      "src/a.ts": "x",
      "src/b.ts": "x",
      "debug.log": "x",
      "build/out.js": "x",
      "untracked.txt": "x",
      "nested/a.txt": "x",
    });
    await git(root, "add", "src/a.ts", ".gitignore");
    await git(root, "commit", "-qm", "first");
    await git(root, "init", "-q", join(root, "nested"));
    await git(root, "checkout", "-q", "-b", "other");
    await writeFile(join(root, "src", "a.ts"), "other\n");
    await git(root, "commit", "-qam", "other");
    await git(root, "checkout", "-q", "-");
    await writeFile(join(root, "src", "a.ts"), "main\n");
    await git(root, "commit", "-qam", "main");
    await git(root, "merge", "other").catch(() => "");
    const staged = await git(root, "ls-files", "-u");
    expect(staged.split("\n").filter((line) => line.includes("src/a.ts")).length).toBe(3);
    expect(await sortedNames(root)).toEqual([
      ".gitignore",
      "src/a.ts",
      "src/b.ts",
      "untracked.txt",
    ]);
  });

  it("answers too-many past the name limit", async () => {
    const root = await makeRepository();
    await put(root, { a: "x", b: "x", c: "x" });
    expect(await sortedNames(root, 3)).toEqual(["a", "b", "c"]);
    expect(await sortedNames(root, 2)).toBe("too-many");
  });

  it("answers failed outside a repository", async () => {
    const folder = await scratch();
    await mkdir(join(folder, "plain"));
    expect(await sortedNames(join(folder, "plain"))).toBe("failed");
  });
});

describe("rankFiles", () => {
  it("ranks a file name match above a path match and shorter first", async () => {
    expect(
      await rankFiles("needle", [
        "needle/readme.md",
        "src/deep/needle-target.ts",
        "needle-long-name.ts",
        "needle.ts",
      ]),
    ).toEqual([
      "needle.ts",
      "needle-long-name.ts",
      "src/deep/needle-target.ts",
      "needle/readme.md",
    ]);
  });

  it("stops at the result limit and keeps the best of many in order", async () => {
    const names = Array.from({ length: 5000 }, (_, at) => `d${String(at)}/file${String(at)}.ts`);
    const best = ["file.ts", "a/file.ts"];
    const ranked = await rankFiles("file", [...names, ...best.toReversed()]);
    expect(ranked).toHaveLength(filesLimits.findResults);
    expect(ranked.slice(0, 2)).toEqual(best);
  });

  it("stops between turns when its request is replaced", async () => {
    const names = Array.from({ length: 10_000 }, (_, at) => `file${String(at)}.ts`);
    const controller = new AbortController();
    const ranking = rankFiles("file", names, controller.signal);
    controller.abort(new Error("moved on"));
    await expect(ranking).rejects.toThrow("moved on");
  });
});

describe("readableNames", () => {
  it("drops a name that sits under a link, which the reader would refuse", async () => {
    const root = await scratch();
    const outside = await scratch();
    await put(root, { "ok/b.txt": "b\n", "top.txt": "t\n" });
    await writeFile(join(outside, "a.txt"), "outside\n");
    await symlink(outside, join(root, "linked"), "junction");
    const { kept } = await readableNames(root, ["linked/a.txt", "ok/b.txt", "top.txt"]);
    expect(kept).toEqual(["ok/b.txt", "top.txt"]);
  });

  it("drops a name that is not in the workspace folder", async () => {
    const root = await scratch();
    await put(root, { "top.txt": "t\n" });
    const { kept } = await readableNames(root, ["top.txt", "elsewhere.txt", "gone/inner.txt"]);
    expect(kept).toEqual(["top.txt"]);
  });
});

describe("rankReadable", () => {
  it("keeps a good match when better ranked names sit under a link", async () => {
    const root = await scratch();
    const outside = await scratch();
    await put(root, { "ok/xxa.txt": "x\n" });
    await symlink(outside, join(root, "linked"), "junction");
    const linked = Array.from(
      { length: filesLimits.findResults + 10 },
      (_, at) => `linked/a${String(at)}.txt`,
    );
    const names = [...linked, "ok/xxa.txt"];
    expect(await rankReadable(root, "a", names)).toEqual(["ok/xxa.txt"]);
  });

  it("answers no name from a repository that redirects git to another folder", async () => {
    const outside = await makeRepository();
    await put(outside, { "top-secret.txt": "s\n", "secrets/key": "k\n" });
    const root = await makeRepository();
    await mkdir(join(root, "secrets"));
    await git(root, "config", "core.worktree", outside);
    const index = await readNames(root);
    expect(index).toMatchObject({ kind: "names" });
    const names = index.kind === "names" ? index.names : [];
    expect(names).toContain("top-secret.txt");
    expect(await rankReadable(root, "secret", names)).toEqual([]);
  });

  it("answers no name from a repository whose git folder is another repository's", async () => {
    const other = await makeRepository();
    await put(other, { "payroll.csv": "p\n", "src/plan.md": "m\n" });
    await git(other, "add", ".");
    const root = await scratch();
    await writeFile(join(root, ".git"), `gitdir: ${join(other, ".git")}\n`);
    const index = await readNames(root);
    expect(index).toMatchObject({ kind: "names" });
    const names = index.kind === "names" ? index.names : [];
    expect(names).toContain("payroll.csv");
    expect(await rankReadable(root, "p", names)).toEqual([]);
  });
});
