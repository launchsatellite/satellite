import { describe, expect, it } from "vitest";
import { isStartRef, shownWorktreeName, workspaceNameProblem } from "./workspace-name.ts";

const patternSentence = "Use lowercase letters, digits and single hyphens, like fix-login.";

describe("workspaceNameProblem", () => {
  it("accepts the names Satellite suggests", () => {
    for (const name of ["fix-login", "a", "x1-2"]) expect(workspaceNameProblem(name)).toBeNull();
  });

  it("refuses names git refuses as branches", () => {
    const names = [
      "-x",
      "x-",
      "a..b",
      "a.lock",
      "a b",
      "a~b",
      "a^b",
      "a:b",
      "a?b",
      "a*b",
      "a[b",
      "a\\b",
      "@",
      "a@{b",
      ".x",
      "x.",
    ];
    for (const name of names) expect(workspaceNameProblem(name)).toBe(patternSentence);
  });

  it("refuses names that climb or nest folders", () => {
    for (const name of ["..", "../x", "a/b", "/abs", "C:\\x"]) {
      expect(workspaceNameProblem(name)).toBe(patternSentence);
    }
  });

  it("refuses uppercase so names never collide by case", () => {
    expect(workspaceNameProblem("Fix-Login")).toBe(patternSentence);
  });

  it("refuses names Windows keeps for itself", () => {
    for (const name of ["con", "nul", "com1", "lpt9", "com0"]) {
      expect(workspaceNameProblem(name)).toBe(
        `${name} is a name Windows keeps for itself. Pick another.`,
      );
    }
  });

  it("refuses an empty and a long name", () => {
    expect(workspaceNameProblem("")).toBe("Give the workspace a name.");
    expect(workspaceNameProblem("a".repeat(49))).toBe("Keep the name to 48 characters or fewer.");
    expect(workspaceNameProblem("a".repeat(48))).toBeNull();
  });
});

describe("isStartRef", () => {
  it("checks start refs like git", () => {
    for (const ref of ["refs/heads/feature/x", "refs/remotes/origin/main"]) {
      expect(isStartRef(ref)).toBe(true);
    }
    const refused = [
      "refs/tags/v1",
      "HEAD",
      "refs/heads/a..b",
      "refs/heads/-x",
      "refs/heads/a.lock",
      "refs/heads/",
      "refs/heads/a//b",
      "refs/heads/a/",
      "refs/heads/a/.b",
      "refs/heads/a@{1}",
      "refs/heads/@",
      "refs/heads/a\u007fb",
      "refs/heads/a\nb",
      `refs/heads/${"a".repeat(256)}`,
    ];
    for (const ref of refused) expect(isStartRef(ref)).toBe(false);
  });

  it("refuses refs that hold a control that reorders text", () => {
    for (const control of ["\u061c", "\u200e", "\u200f", "\u202a", "\u202e", "\u2066", "\u2069"]) {
      expect(isStartRef(`refs/heads/main${control}x`)).toBe(false);
    }
    expect(isStartRef("refs/heads/caf\u00e9")).toBe(true);
  });
});

describe("shownWorktreeName", () => {
  it("turns any folder an agent named into a valid workspace name", () => {
    expect(shownWorktreeName("fix-login")).toBe("fix-login");
    expect(shownWorktreeName("Agent_A1b2 (copy)")).toBe("agent-a1b2-copy");
    expect(shownWorktreeName("--x--")).toBe("x");
    expect(shownWorktreeName(`${"a".repeat(47)}-b`)).toBe("a".repeat(47));
  });

  it("falls back to worktree for a folder with nothing usable or a name Windows keeps", () => {
    for (const folder of ["", "___", "Üï", "CON", "\u202e"]) {
      expect(shownWorktreeName(folder)).toBe("worktree");
    }
  });
});
