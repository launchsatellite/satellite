import { describe, expect, it } from "vitest";
import { forcedBackend, plannedRoots, retryDelay } from "./watch-plan.ts";

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
    expect([...roots].map(([root, ids]) => [root, [...ids].sort()])).toEqual([
      ["/code/app", ["a", "b"]],
      ["/code/other", ["c"]],
      ["/srv/satellite/worktrees/app/two", ["a"]],
    ]);
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
  });
});

describe("retryDelay", () => {
  it("doubles from 5 seconds up to 5 minutes", () => {
    expect([1, 2, 3, 7, 50].map(retryDelay)).toEqual([5000, 10_000, 20_000, 300_000, 300_000]);
  });
});
