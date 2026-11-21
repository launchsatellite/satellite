import { describe, expect, it } from "vitest";
import { needsOf, type NeedsView, type ReviewFact } from "./pull-request-needs.ts";

const head = "a".repeat(40);
const older = "b".repeat(40);
const none = { failed: 0, pending: 0, passed: 3, total: 3 };
const base: NeedsView = {
  state: "open",
  counts: none,
  mergeable: "mergeable",
  reviews: [],
  headOid: head,
};
const review = (state: string, at: string, commit = head, login = "ada-example"): ReviewFact => ({
  login,
  state,
  commit,
  at,
});

describe("needsOf", () => {
  it("a failed check needs you", () => {
    expect(needsOf({ ...base, counts: { ...none, failed: 1, total: 4 } })).toEqual(["checks"]);
  });

  it("a draft, a merged and a closed pull request never need you", () => {
    const everything: NeedsView = {
      ...base,
      counts: { ...none, failed: 2 },
      mergeable: "conflicting",
      reviews: [review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z")],
    };
    expect(needsOf(everything)).toEqual(["checks", "review", "conflicts"]);
    for (const state of ["draft", "merged", "closed"] as const) {
      expect(needsOf({ ...everything, state })).toEqual([]);
    }
  });

  it("requested changes on the head commit need you", () => {
    expect(
      needsOf({ ...base, reviews: [review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z")] }),
    ).toEqual(["review"]);
  });

  it("requested changes on an older commit do not", () => {
    expect(
      needsOf({ ...base, reviews: [review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z", older)] }),
    ).toEqual([]);
    expect(
      needsOf({
        ...base,
        headOid: null,
        reviews: [review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z")],
      }),
    ).toEqual([]);
  });

  it("a later approval or dismissal from the same login clears it", () => {
    const request = review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z");
    for (const state of ["APPROVED", "DISMISSED"]) {
      expect(
        needsOf({ ...base, reviews: [request, review(state, "2026-01-02T00:00:00Z")] }),
      ).toEqual([]);
    }
  });

  it("a later comment from the same login does not", () => {
    expect(
      needsOf({
        ...base,
        reviews: [
          review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z"),
          review("COMMENTED", "2026-01-02T00:00:00Z"),
        ],
      }),
    ).toEqual(["review"]);
  });

  it("keeps another reviewer's request after a different login approves", () => {
    expect(
      needsOf({
        ...base,
        reviews: [
          review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z", head, "ada-example"),
          review("APPROVED", "2026-01-02T00:00:00Z", head, "grace-example"),
        ],
      }),
    ).toEqual(["review"]);
  });

  it("conflicts need you", () => {
    expect(needsOf({ ...base, mergeable: "conflicting" })).toEqual(["conflicts"]);
  });

  it("cancelled, pending, skipped and unknown checks do not", () => {
    expect(needsOf({ ...base, counts: { failed: 0, pending: 2, passed: 1, total: 6 } })).toEqual(
      [],
    );
    expect(needsOf({ ...base, mergeable: "unknown" })).toEqual([]);
  });
});
