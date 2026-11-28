import { describe, expect, it } from "vitest";
import type { PullRequestFound, PullRequestReviewer } from "../../shared/bridge-contract.ts";
import { blocks, readyCard } from "./ready-rows.ts";

function found(change: Partial<PullRequestFound> = {}): PullRequestFound {
  return {
    kind: "found",
    number: 12,
    url: "https://github.com/example-org/verify-repo/pull/12",
    host: "github.com",
    state: "open",
    base: "main",
    head: "alpha",
    crossRepository: false,
    mergeable: "mergeable",
    mergeState: "clean",
    review: "none",
    reviewers: [],
    counts: { failed: 0, pending: 0, passed: 3, total: 3 },
    needs: [],
    commits: [],
    moreCommits: 0,
    checks: [],
    moreChecks: 0,
    detail: { kind: "read", openThreads: 0, moreThreads: 0 },
    ...change,
  };
}

function reviewer(change: Partial<PullRequestReviewer> = {}): PullRequestReviewer {
  return { login: "grace-example", state: "approved", onHead: true, id: "PRR_kwDOx", ...change };
}

function looks(change: Partial<PullRequestFound>): Record<string, string> {
  return Object.fromEntries(readyCard(found(change)).rows.map(({ key, look }) => [key, look]));
}

describe("readyCard", () => {
  it("says nothing blocks only when every row is clear", () => {
    const card = readyCard(found({ reviewers: [reviewer()], review: "approved" }));
    expect(card.look).toBe("clear");
    expect(card.title).toBe("Nothing blocks the merge");
    expect(card.rows.map(({ key, title }) => [key, title])).toEqual([
      ["checks", "Checks passed"],
      ["reviews", "Approved by grace-example"],
      ["conflicts", "No conflicts with main"],
      ["threads", "Every thread resolved"],
    ]);
    expect(card.rows.some(blocks)).toBe(false);
  });

  it("marks signal only for failed checks, changes requested and conflicts", () => {
    const card = readyCard(
      found({
        counts: { failed: 2, pending: 0, passed: 1, total: 3 },
        mergeable: "conflicting",
        reviewers: [reviewer({ state: "changes-requested" })],
        review: "changes-requested",
        needs: ["checks", "review", "conflicts"],
        detail: { kind: "read", openThreads: 3, moreThreads: 0 },
      }),
    );
    expect(card.look).toBe("signal");
    expect(card.title).toBe("3 things block the merge");
    expect(Object.fromEntries(card.rows.map(({ key, look }) => [key, look]))).toEqual({
      checks: "signal",
      reviews: "signal",
      conflicts: "signal",
      threads: "open",
    });
    expect(card.rows.find(({ key }) => key === "threads")?.title).toBe("3 open threads");
  });

  it("counts a draft, running checks and a missing review as grey blockers", () => {
    const card = readyCard(
      found({
        state: "draft",
        counts: { failed: 0, pending: 1, passed: 2, total: 3 },
        review: "review-required",
      }),
    );
    expect(card.look).toBe("blocks");
    expect(card.title).toBe("3 things block the merge");
    expect(card.rows[0]).toMatchObject({ key: "draft", look: "blocks", title: "Still a draft" });
  });

  it("keeps a draft grey while it fails, conflicts and asks for changes on the latest commit", () => {
    const card = readyCard(
      found({
        state: "draft",
        needs: [],
        counts: { failed: 1, pending: 0, passed: 2, total: 3 },
        mergeable: "conflicting",
        reviewers: [reviewer({ state: "changes-requested", onHead: true })],
      }),
    );
    expect(card.look).toBe("blocks");
    expect(Object.fromEntries(card.rows.map(({ key, look }) => [key, look]))).toMatchObject({
      checks: "blocks",
      reviews: "blocks",
      conflicts: "blocks",
    });
    expect(card.rows.find(({ key }) => key === "reviews")?.detail).toBe("On the latest commit");
  });

  it("names the threads past the read when none of the first ones are open", () => {
    const threads = readyCard(
      found({ detail: { kind: "read", openThreads: 0, moreThreads: 4 } }),
    ).rows.find(({ key }) => key === "threads");
    expect(threads?.title).toBe("4 more threads on GitHub");
  });

  it("never lets an open thread block or a stale request raise signal", () => {
    expect(looks({ detail: { kind: "read", openThreads: 1, moreThreads: 0 } })["threads"]).toBe(
      "open",
    );
    expect(
      readyCard(found({ detail: { kind: "read", openThreads: 1, moreThreads: 0 } })).title,
    ).toBe("Nothing blocks the merge");
    const stale = readyCard(
      found({ reviewers: [reviewer({ state: "changes-requested", onHead: false })] }),
    );
    expect(stale.look).toBe("blocks");
    expect(stale.rows.find(({ key }) => key === "reviews")?.detail).toBe("On an earlier commit");
  });

  it("says a branch rule blocks when GitHub blocks for a reason the rows do not show", () => {
    expect(looks({ mergeState: "blocked" })["rule"]).toBe("blocks");
    expect(looks({ mergeState: "blocked", mergeable: "conflicting" })["rule"]).toBeUndefined();
  });

  it("shows merged and closed without blockers", () => {
    for (const state of ["merged", "closed"] as const) {
      const card = readyCard(found({ state, mergeable: "conflicting" }));
      expect(card.look).toBe(state);
      expect(card.rows).toEqual([]);
    }
  });

  it("points each request at numbers and ids only", () => {
    const card = readyCard(
      found({
        mergeable: "conflicting",
        base: "a‮b",
        reviewers: [reviewer({ state: "changes-requested", login: "x‮y" })],
        needs: ["review", "conflicts"],
        detail: { kind: "read", openThreads: 2, moreThreads: 0 },
      }),
    );
    const requests = Object.fromEntries(card.rows.map(({ key, request }) => [key, request]));
    expect(requests).toEqual({
      checks: null,
      reviews:
        "Review PRR_kwDOx on pull request #12 asks for changes. Read it with gh and address it.",
      conflicts: "Update this branch from the base branch and resolve the conflicts.",
      threads:
        "Review threads on pull request #12 are unresolved. Read them with gh and address them.",
    });
    for (const row of card.rows) expect(row.title).not.toContain("‮");
  });
});
