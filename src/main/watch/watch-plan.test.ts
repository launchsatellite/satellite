import { describe, expect, it } from "vitest";
import {
  forcedBackend,
  isIgnoredLiterally,
  plannedRoots,
  retryDelay,
  splitIgnores,
} from "./watch-plan.ts";

const project = (id: string, path: string, workspaces: string[] = []) => ({
  id,
  path,
  workspaces: workspaces.map((each) => ({ path: each })),
});

describe("plannedRoots", () => {
  it("watches each folder once, folding one inside another into it", () => {
    const roots = plannedRoots(
      [
        project("a", "/code/app", [
          "/code/app/.claude/worktrees/one",
          "/srv/satellite/worktrees/app/two",
        ]),
        project("b", "/code/app/packages/lib"),
        project("c", "/code/other"),
      ],
      "linux",
    );
    expect([...roots].map(([root, { ids }]) => [root, [...ids].sort()])).toEqual([
      ["/code/app", ["a", "b"]],
      ["/code/other", ["c"]],
      ["/srv/satellite/worktrees/app/two", ["a"]],
    ]);
    expect(roots.get("/code/app")?.ignore).toEqual([
      ".git/objects",
      ".git/lfs",
      "node_modules",
      "packages/lib/.git/objects",
      "packages/lib/.git/lfs",
      "packages/lib/node_modules",
      ".claude/worktrees/one/.git/objects",
      ".claude/worktrees/one/.git/lfs",
      ".claude/worktrees/one/node_modules",
    ]);
  });

  it("keeps an ignore that reads as a pattern out of the native side and matches it literally", () => {
    const roots = plannedRoots([project("a", "/code/app", ["/code/app/packages/[ab]"])], "linux");
    const { native, literal } = splitIgnores(roots.get("/code/app")?.ignore ?? []);
    expect(native).toEqual([".git/objects", ".git/lfs", "node_modules"]);
    expect(literal).toEqual([
      "packages/[ab]/.git/objects",
      "packages/[ab]/.git/lfs",
      "packages/[ab]/node_modules",
    ]);
    const ignored = (path: string) => isIgnoredLiterally("/code/app", path, literal, "linux");
    expect(ignored("/code/app/packages/[ab]/node_modules/x/index.js")).toBe(true);
    expect(ignored("/code/app/packages/a/node_modules/x/index.js")).toBe(false);
    expect(ignored("/code/app/packages/[ab]/src/index.ts")).toBe(false);
  });

  it("folds paths by the platform's rule", () => {
    const roots = plannedRoots([project("a", "C:\\Code\\App", ["c:\\code\\app\\wt"])], "win32");
    expect([...roots.keys()]).toEqual(["C:\\Code\\App"]);
  });
});

describe("forcedBackend", () => {
  it("names the native backend so Watchman never starts", () => {
    expect(forcedBackend("darwin")).toBe("fs-events");
    expect(forcedBackend("win32")).toBe("windows");
    expect(forcedBackend("linux")).toBe("inotify");
    expect(forcedBackend("freebsd")).toBeUndefined();
  });
});

describe("retryDelay", () => {
  it("doubles from 5 seconds up to 5 minutes", () => {
    expect([1, 2, 3, 7, 50].map(retryDelay)).toEqual([5000, 10_000, 20_000, 300_000, 300_000]);
  });
});
