import { describe, expect, it } from "vitest";
import { adoptable, droppedSentences, type AdoptionInput } from "./workspace-reads.ts";
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
    initializing: false,
    prunable: false,
    ...extra,
  };
}

function input(worktrees: ListedWorktree[], overrides: Partial<AdoptionInput> = {}): AdoptionInput {
  return {
    listed: { worktrees: [worktree("/Users/<name>/repo", "main"), ...worktrees], separator: "\0" },
    recorded: [],
    room: 20,
    root: "/Users/<name>/.satellite/worktrees",
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
      worktree(`${segment}/half`, "half", { locked: true, initializing: true }),
      worktree(`${segment}/loose`, null),
      worktree(`${segment}/Upper`, "upper"),
      worktree(`${segment}/odd`, "bad..name"),
      worktree(`${segment}/nested/deeper`, "deeper"),
      worktree("/Users/<name>/.satellite/worktrees/other/elsewhere", "elsewhere"),
    ];
    expect(adoptable(input(skipped, { recorded: [`${segment}/recorded`] }))).toEqual([]);
  });

  it("adopts a worktree an agent made outside Satellite under a name it can show", () => {
    const outside = [
      worktree("/Users/<name>/repo/.claude/worktrees/Agent_A1", "agent-a1"),
      worktree("/Users/<name>/elsewhere/fix-login", "fix-login"),
      worktree("/Users/<name>/elsewhere/loose", null),
      worktree("/Users/<name>/elsewhere/gone", "gone", { prunable: true }),
    ];
    expect(adoptable(input(outside))).toEqual([
      {
        name: "agent-a1",
        path: "/Users/<name>/repo/.claude/worktrees/Agent_A1",
        branch: "agent-a1",
      },
      { name: "fix-login", path: "/Users/<name>/elsewhere/fix-login", branch: "fix-login" },
    ]);
  });

  it("adopts a folder git lists twice only once", () => {
    const twice = [
      worktree(`${segment}/left-over`, "left-over"),
      worktree(`${segment}/left-over`, "left-over"),
    ];
    expect(adoptable(input(twice))).toHaveLength(1);
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

describe("droppedSentences", () => {
  it("names as many dropped workspaces as fit and keeps the prune advice", () => {
    const project = "a-project-with-a-long-name-for-its-folder";
    const drops = Array.from({ length: 8 }, (_, index) => ({
      workspaceId: String(index),
      projectId: "p",
      name: `workspace-number-${String(index)}-with-a-long-name`,
      project,
      prunable: true,
      quiet: false,
      sentence: "unused",
    }));
    const [sentence = ""] = droppedSentences(drops);
    expect(sentence.length).toBeLessThanOrEqual(300);
    expect(sentence).toMatch(
      /^8 workspaces left a-project-with-a-long-name-for-its-folder because they were removed outside Satellite, workspace-number-0-with-a-long-name, .* and \d more\. git still counts some of their branches as checked out until you run git worktree prune\.$/,
    );
  });

  it("says nothing about a worktree an agent made and removed again", () => {
    const quiet = {
      workspaceId: "q",
      projectId: "p",
      name: "agent-a1",
      project: "repo",
      prunable: false,
      quiet: true,
      sentence: "agent-a1 left repo.",
    };
    expect(droppedSentences([quiet])).toEqual([]);
  });
});
