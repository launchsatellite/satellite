import { execFile } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { samePath } from "../platform/paths.ts";
import { listWorktrees, parseWorktreeList } from "./worktree-list.ts";

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
const manualExample = [
  ["worktree /path/to/bare-source", "bare"],
  [
    "worktree /path/to/linked-worktree",
    "HEAD abcd1234abcd1234abcd1234abcd1234abcd1234",
    "branch refs/heads/master",
  ],
  [
    "worktree /path/to/other-linked-worktree",
    "HEAD 1234abc1234abc1234abc1234abc1234abc1234a",
    "detached",
  ],
  [
    "worktree /path/to/linked-worktree-locked-no-reason",
    "HEAD 5678abc5678abc5678abc5678abc5678abc5678c",
    "branch refs/heads/locked-no-reason",
    "locked",
  ],
  [
    "worktree /path/to/linked-worktree-locked-with-reason",
    "HEAD 3456def3456def3456def3456def3456def3456b",
    "branch refs/heads/locked-with-reason",
    "locked reason why is locked",
  ],
  [
    "worktree /path/to/linked-worktree-prunable",
    "HEAD 1233def1234def1234def1234def1234def1234b",
    "detached",
    "prunable gitdir file points to non-existent location",
  ],
];
const plain = { detached: false, bare: false, locked: false, prunable: false };
const manualParsed = [
  { ...plain, path: "/path/to/bare-source", head: null, branch: null, bare: true },
  {
    ...plain,
    path: "/path/to/linked-worktree",
    head: "abcd1234abcd1234abcd1234abcd1234abcd1234",
    branch: "master",
  },
  {
    ...plain,
    path: "/path/to/other-linked-worktree",
    head: "1234abc1234abc1234abc1234abc1234abc1234a",
    branch: null,
    detached: true,
  },
  {
    ...plain,
    path: "/path/to/linked-worktree-locked-no-reason",
    head: "5678abc5678abc5678abc5678abc5678abc5678c",
    branch: "locked-no-reason",
    locked: true,
  },
  {
    ...plain,
    path: "/path/to/linked-worktree-locked-with-reason",
    head: "3456def3456def3456def3456def3456def3456b",
    branch: "locked-with-reason",
    locked: true,
  },
  {
    ...plain,
    path: "/path/to/linked-worktree-prunable",
    head: "1233def1234def1234def1234def1234def1234b",
    branch: null,
    detached: true,
    prunable: true,
  },
];

function gitEnvironment(config: string): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  return { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
}

function joined(records: string[][], separator: string): string {
  return (
    records.map((lines) => lines.map((line) => line + separator).join("")).join(separator) +
    separator
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseWorktreeList", () => {
  it("reads every attribute of a NUL separated list", () => {
    const stdout = joined(manualExample, "\0");
    expect(stdout.endsWith("\0\0")).toBe(true);
    expect(parseWorktreeList(stdout, "\0")).toEqual(manualParsed);
  });

  it("reads the same list separated by newlines", () => {
    expect(parseWorktreeList(joined(manualExample, "\n"), "\n")).toEqual(manualParsed);
  });

  it("reads an unborn branch as a branch with no commit", () => {
    const stdout =
      "worktree /Users/<name>/repo\0HEAD 0000000000000000000000000000000000000000\0branch refs/heads/main\0\0";
    expect(parseWorktreeList(stdout, "\0")).toEqual([
      { ...plain, path: "/Users/<name>/repo", head: null, branch: "main" },
    ]);
  });

  it("keeps a path with spaces and a newline whole when NUL separated", () => {
    const stdout =
      'worktree /Users/<name>/repo\0bare\0\0worktree /Users/<name>/my work\ntree "é"\0HEAD abcd\0branch refs/heads/w1\0\0';
    expect(parseWorktreeList(stdout, "\0").map((worktree) => worktree.path)).toEqual([
      "/Users/<name>/repo",
      '/Users/<name>/my work\ntree "é"',
    ]);
  });

  it("reads Windows paths", () => {
    expect(
      parseWorktreeList("worktree C:/Users/<name>/repo\0HEAD abcd\0detached\0\0", "\0")[0]?.path,
    ).toBe("C:/Users/<name>/repo");
    expect(
      parseWorktreeList("worktree C:/Users/<name>/repo\nHEAD abcd\ndetached\n\n", "\n")[0],
    ).toEqual({
      ...plain,
      path: "C:/Users/<name>/repo",
      head: "abcd",
      branch: null,
      detached: true,
    });
  });

  it("ignores labels it does not know", () => {
    const stdout =
      "worktree /home/<name>/repo\0HEAD abcd\0sparse\0origin cone 3\0branch refs/remotes/origin/x\0\0HEAD abcd\0branch refs/heads/orphan\0\0worktree /home/<name>/cut\0HEAD ab";
    expect(parseWorktreeList(stdout, "\0")).toEqual([
      { ...plain, path: "/home/<name>/repo", head: "abcd", branch: "refs/remotes/origin/x" },
      { ...plain, path: "/home/<name>/cut", head: "ab", branch: null },
    ]);
    expect(parseWorktreeList("", "\0")).toEqual([]);
  });

  it("reads a long list in bounded time", () => {
    const record = ["worktree /home/<name>/w", "HEAD abcd", "branch refs/heads/w"];
    const stdout = joined(
      Array.from({ length: 200_000 }, () => record),
      "\0",
    );
    const started = Date.now();
    expect(parseWorktreeList(stdout, "\0")).toHaveLength(200_000);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("listWorktrees", () => {
  it("reads the list real git prints", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-worktrees-")));
    const config = join(base, "gitconfig");
    await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const repo = join(base, "repo");
    const git = (args: string[]) =>
      run("git", ["-C", repo, ...args], { env: gitEnvironment(config) });
    await run("git", ["init", "-q", "-b", "main", repo], { env: gitEnvironment(config) });
    await writeFile(join(repo, "a"), "a\n");
    await git(["add", "a"]);
    await git(["commit", "-q", "-m", "one"]);
    await git(["branch", "w1"]);
    await git(["worktree", "add", "-q", join(base, "wt", "w1"), "w1"]);
    const listed = await listWorktrees(repo);
    expect(listed?.worktrees.map((worktree) => worktree.branch)).toEqual(["main", "w1"]);
    expect(samePath(listed?.worktrees[1]?.path ?? "", await realpath(join(base, "wt", "w1")))).toBe(
      true,
    );
    expect(listed?.worktrees[0]?.head).toMatch(/^[0-9a-f]{40,64}$/);
  });
});
