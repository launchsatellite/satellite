import { describe, expect, it } from "vitest";
import { adoptable, type AdoptionInput } from "./workspace-reads.ts";
import type { ListedWorktree } from "./worktree-list.ts";

const segment = "/Users/<name>/.satellite/worktrees/repo";

function worktree(path: string, branch: string | null, extra: Partial<ListedWorktree> = {}) {
  return {
    path,
    head: "a".repeat(40),
    branch,
    detached: branch === null,
    bare: false,
    locked: false,
    prunable: false,
    ...extra,
  };
}

function input(worktrees: ListedWorktree[], overrides: Partial<AdoptionInput> = {}): AdoptionInput {
  return {
    listed: { worktrees: [worktree("/Users/<name>/repo", "main"), ...worktrees], separator: "\0" },
    recorded: [],
    room: 20,
    segmentFolder: segment,
    blocked: false,
    ...overrides,
  };
}

describe("adoptable", () => {
  it("adopts a listed worktree in the project's own folder that has no record", () => {
    expect(adoptable(input([worktree(`${segment}/left-over`, "left-over")]))).toEqual([
      { name: "left-over", path: `${segment}/left-over`, branch: "left-over" },
    ]);
  });

  it("adopts nothing it cannot trust or does not own", () => {
    const skipped = [
      worktree(`${segment}/recorded`, "recorded"),
      worktree(`${segment}/gone`, "gone", { prunable: true }),
      worktree(`${segment}/loose`, null),
      worktree(`${segment}/Upper`, "upper"),
      worktree(`${segment}/odd`, "bad..name"),
      worktree(`${segment}/nested/deeper`, "deeper"),
      worktree("/Users/<name>/.satellite/worktrees/other/elsewhere", "elsewhere"),
      worktree("/Users/<name>/own-worktree", "own"),
    ];
    expect(adoptable(input(skipped, { recorded: [`${segment}/recorded`] }))).toEqual([]);
  });

  it("never adopts the main worktree even inside the folder", () => {
    const main = worktree(`${segment}/main-here`, "main");
    expect(adoptable({ ...input([]), listed: { worktrees: [main], separator: "\0" } })).toEqual([]);
  });

  it("adopts nothing while the project is busy, on newline output or past the limit", () => {
    const one = [worktree(`${segment}/left-over`, "left-over")];
    expect(adoptable(input(one, { blocked: true }))).toEqual([]);
    expect(adoptable(input(one, { room: 0 }))).toEqual([]);
    expect(adoptable(input(one, { listed: undefined }))).toEqual([]);
    const newline = input(one);
    expect(
      adoptable({
        ...newline,
        listed: { worktrees: newline.listed?.worktrees ?? [], separator: "\n" },
      }),
    ).toEqual([]);
    const three = ["a", "b", "c"].map((name) => worktree(`${segment}/${name}`, name));
    expect(adoptable(input(three, { room: 2 })).map((found) => found.name)).toEqual(["a", "b"]);
  });
});
