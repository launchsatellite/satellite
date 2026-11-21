import { describe, expect, it } from "vitest";
import type { PullRequestFound } from "../../shared/bridge-contract.ts";
import {
  absentSentence,
  blocks,
  checksSummary,
  readoutLabel,
  readoutPixel,
  readoutRest,
  stateWord,
  troubleSentence,
} from "./pull-request-words.ts";

const troubles = [
  "signed-out",
  "gh-missing",
  "gh-old",
  "offline",
  "other-host",
  "rate-limited",
  "hung",
  "failed",
] as const;

function found(change: Partial<PullRequestFound> = {}): PullRequestFound {
  return {
    kind: "found",
    number: 12,
    url: "https://github.com/example-org/verify-repo/pull/12",
    host: "github.com",
    title: "Add the greeting",
    state: "open",
    base: "main",
    head: "alpha",
    crossRepository: false,
    mergeable: "mergeable",
    mergeState: "clean",
    review: "none",
    counts: { failed: 0, pending: 0, passed: 3, total: 3 },
    needs: [],
    atHead: true,
    body: "",
    bodyCut: false,
    changedFiles: 1,
    commits: [],
    moreCommits: 0,
    checks: [],
    moreChecks: 0,
    detail: null,
    ...change,
  };
}

function keys(change: Partial<PullRequestFound>): string[] {
  return blocks(found(change)).map((row) => row.key);
}

describe("pull request words", () => {
  it("has a sentence for every trouble and absence and none holds a colon", () => {
    const sentences = [
      ...troubles.map(troubleSentence),
      absentSentence("none"),
      absentSentence("not-pushed"),
    ];
    expect(new Set(sentences).size).toBe(10);
    for (const sentence of sentences) {
      expect(sentence).not.toContain(":");
      expect(sentence.endsWith(".")).toBe(true);
    }
    expect(troubleSentence("signed-out")).toContain("gh auth login");
    expect(troubleSentence("gh-old")).toContain("2.18");
  });

  it("summarises checks", () => {
    expect(checksSummary({ failed: 0, pending: 0, passed: 0, total: 0 })).toBe("No checks");
    expect(checksSummary({ failed: 1, pending: 2, passed: 1, total: 4 })).toBe("1 failed");
    expect(checksSummary({ failed: 2, pending: 0, passed: 1, total: 3 })).toBe("2 failed");
    expect(checksSummary({ failed: 0, pending: 3, passed: 0, total: 3 })).toBe("3 running");
    expect(checksSummary({ failed: 0, pending: 0, passed: 5, total: 5 })).toBe("All 5 passed");
  });

  it("lists what blocks a pull request in order", () => {
    expect(keys({ state: "draft", mergeable: "conflicting" })).toEqual(["draft", "conflicts"]);
    expect(
      keys({
        mergeable: "unknown",
        review: "changes-requested",
        counts: { failed: 2, pending: 1, passed: 0, total: 3 },
        mergeState: "behind",
      }),
    ).toEqual(["unknown", "changes", "failed", "running", "behind"]);
    expect(keys({ review: "review-required" })).toEqual(["review"]);
    expect(keys({ mergeState: "blocked" })).toEqual(["rule"]);
    expect(keys({ mergeState: "blocked", review: "review-required" })).toEqual(["review"]);
    expect(blocks(found())).toEqual([{ key: "clear", sentence: "Nothing blocks it." }]);
    expect(blocks(found({ state: "merged", mergeable: "conflicting" }))).toEqual([
      { key: "merged", sentence: "It is merged." },
    ]);
    expect(blocks(found({ state: "closed" }))).toEqual([
      { key: "closed", sentence: "It is closed." },
    ]);
    const sentences = blocks(
      found({
        mergeable: "conflicting",
        counts: { failed: 1, pending: 1, passed: 0, total: 2 },
        mergeState: "behind",
      }),
    ).map((row) => row.sentence);
    expect(sentences).toEqual([
      "It conflicts with main.",
      "1 check failed.",
      "1 check is still running.",
      "It is behind main.",
    ]);
    expect(blocks(found({ mergeable: "conflicting", base: null }))[0]?.sentence).toBe(
      "It conflicts with the base branch.",
    );
    for (const row of blocks(found({ mergeable: "conflicting", base: "a‮b" }))) {
      expect(row.sentence).not.toContain("‮");
    }
  });

  it("labels the readout", () => {
    expect(readoutLabel(found())).toBe("Pull request 12, Open, All 3 passed");
    expect(readoutRest(found({ state: "merged" }))).toBe(" Merged · All 3 passed");
    expect(stateWord("draft")).toBe("Draft");
    const pixel = (change: Partial<PullRequestFound>) => readoutPixel(found(change));
    expect(pixel({})).toBe("ready");
    expect(pixel({ counts: { failed: 1, pending: 0, passed: 0, total: 1 } })).toBe("needs-you");
    expect(pixel({ counts: { failed: 0, pending: 1, passed: 0, total: 1 } })).toBe("working");
    expect(pixel({ state: "merged" })).toBe("done");
    expect(pixel({ state: "closed" })).toBe("idle");
    expect(pixel({ counts: { failed: 0, pending: 0, passed: 0, total: 0 } })).toBe("idle");
  });
});
