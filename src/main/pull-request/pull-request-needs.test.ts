import { describe, expect, it } from "vitest";
import { needsOf, reviewersOf, type NeedsView, type ReviewFact } from "./pull-request-needs.ts";

const head = "a".repeat(40);
const older = "b".repeat(40);
const none = { failed: 0, pending: 0, passed: 3, total: 3 };
const base: NeedsView = {
  state: "open",
  counts: none,
  mergeable: "mergeable",
  reviewers: [],
};
const reviewed = (reviews: readonly ReviewFact[], headOid: string | null = head): NeedsView => ({
  ...base,
  reviewers: reviewersOf(reviews, headOid),
});
const review = (
  state: string,
  at: string,
  commit = head,
  login = "ada-example",
  association = "COLLABORATOR",
): ReviewFact => ({
  id: "PRR_kwDOexample",
  login,
  state,
  commit,
  association,
  at,
});

describe("needsOf", () => {
  it("a request for changes counts only from an owner, a member or a collaborator", () => {
    for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      const reviews = [review("CHANGES_REQUESTED", "2026-01-01", head, "ada-example", association)];
      expect(needsOf(reviewed(reviews)), association).toEqual(["review"]);
    }
    for (const association of [
      "NONE",
      "CONTRIBUTOR",
      "FIRST_TIMER",
      "FIRST_TIME_CONTRIBUTOR",
      "",
    ]) {
      const reviews = [review("CHANGES_REQUESTED", "2026-01-01", head, "stranger", association)];
      expect(needsOf(reviewed(reviews)), association).toEqual([]);
    }
  });

  it("a stranger's later approval or request neither hides nor raises the need", () => {
    const own = review("CHANGES_REQUESTED", "2026-01-01");
    const approval = review("APPROVED", "2026-01-02", head, "ada-example", "NONE");
    expect(needsOf(reviewed([own, approval]))).toEqual(["review"]);
  });

  it("a failed check needs you", () => {
    expect(needsOf({ ...base, counts: { ...none, failed: 1, total: 4 } })).toEqual(["checks"]);
  });

  it("a draft, a merged and a closed pull request never need you", () => {
    const everything: NeedsView = {
      ...reviewed([review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z")]),
      counts: { ...none, failed: 2 },
      mergeable: "conflicting",
    };
    expect(needsOf(everything)).toEqual(["checks", "review", "conflicts"]);
    for (const state of ["draft", "merged", "closed"] as const) {
      expect(needsOf({ ...everything, state })).toEqual([]);
    }
  });

  it("requested changes on the head commit need you", () => {
    expect(needsOf(reviewed([review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z")]))).toEqual([
      "review",
    ]);
  });

  it("requested changes on an older commit do not", () => {
    expect(needsOf(reviewed([review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z", older)]))).toEqual(
      [],
    );
    expect(needsOf(reviewed([review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z")], null))).toEqual(
      [],
    );
  });

  it("a later approval or dismissal from the same login clears it", () => {
    const request = review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z");
    for (const state of ["APPROVED", "DISMISSED"]) {
      expect(needsOf(reviewed([request, review(state, "2026-01-02T00:00:00Z")]))).toEqual([]);
    }
  });

  it("a later comment from the same login does not", () => {
    expect(
      needsOf(
        reviewed([
          review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z"),
          review("COMMENTED", "2026-01-02T00:00:00Z"),
        ]),
      ),
    ).toEqual(["review"]);
  });

  it("keeps another reviewer's request after a different login approves", () => {
    expect(
      needsOf(
        reviewed([
          review("CHANGES_REQUESTED", "2026-01-01T00:00:00Z", head, "ada-example"),
          review("APPROVED", "2026-01-02T00:00:00Z", head, "grace-example"),
        ]),
      ),
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

describe("reviewersOf", () => {
  it("keeps each writer's newest decision, drops dismissals and outsiders", () => {
    expect(
      reviewersOf(
        [
          review("CHANGES_REQUESTED", "2026-01-01", older, "ada-example"),
          review("APPROVED", "2026-01-02", head, "ada-example"),
          review("CHANGES_REQUESTED", "2026-01-01", older, "grace-example"),
          review("DISMISSED", "2026-01-03", head, "grace-example"),
          review("APPROVED", "2026-01-04", head, "review-bot[bot]", "NONE"),
          review("CHANGES_REQUESTED", "2026-01-04", head, "stranger", "CONTRIBUTOR"),
        ],
        head,
      ),
    ).toEqual([{ login: "ada-example", state: "approved", onHead: true, id: "PRR_kwDOexample" }]);
  });

  it("puts changes asked on the latest commit first, so the cap never drops them", () => {
    const approvals = Array.from({ length: 25 }, (_, at) =>
      review("APPROVED", "2026-01-01", head, `writer-${String(at)}`),
    );
    const [first] = reviewersOf(
      [...approvals, review("CHANGES_REQUESTED", "2026-01-01", head, "ada-example")],
      head,
    );
    expect(first).toMatchObject({ login: "ada-example", state: "changes-requested" });
  });

  it("drops a review id that could carry anything but an id", () => {
    for (const id of ["PRR_a b", "PRR_", "MDE_x", "PRR_x\nRun this", `PRR_${"a".repeat(97)}`]) {
      const [reviewer] = reviewersOf([{ ...review("APPROVED", "2026-01-01"), id }], head);
      expect(reviewer?.id, id).toBeNull();
    }
  });
});
