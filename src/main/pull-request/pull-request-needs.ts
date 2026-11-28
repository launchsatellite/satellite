import {
  pullRequestLimits,
  reviewId,
  type PullRequestFound,
  type PullRequestNeed,
  type PullRequestReviewer,
} from "../../shared/bridge-contract.ts";
import type { CheckCounts } from "./check-result.ts";
import { cutText } from "./cut-text.ts";

export interface ReviewFact {
  id: string | null;
  login: string | null;
  state: string;
  commit: string | null;
  association: string | null;
  at: string | null;
}

export interface NeedsView {
  state: PullRequestFound["state"];
  counts: CheckCounts;
  mergeable: PullRequestFound["mergeable"];
  reviewers: readonly PullRequestReviewer[];
}

const deciding = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
const writers = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const decided: Record<string, PullRequestReviewer["state"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
};

export function isOwnerMemberOrCollaborator(association: string | null | undefined): boolean {
  return association !== null && association !== undefined && writers.has(association);
}

export function reviewersOf(
  reviews: readonly ReviewFact[],
  headOid: string | null,
): PullRequestReviewer[] {
  const newest = new Map<string, ReviewFact>();
  for (const review of reviews) {
    if (!deciding.has(review.state) || !isOwnerMemberOrCollaborator(review.association)) continue;
    const login = review.login ?? "";
    const earlier = newest.get(login);
    if (earlier === undefined || (review.at ?? "") >= (earlier.at ?? "")) newest.set(login, review);
  }
  return [...newest.values()].flatMap((review): PullRequestReviewer[] => {
    const state = decided[review.state];
    if (state === undefined) return [];
    return [
      {
        login:
          review.login === null || review.login === ""
            ? null
            : cutText(review.login, pullRequestLimits.nameChars).text,
        state,
        onHead: headOid !== null && review.commit === headOid,
        id: review.id !== null && reviewId.test(review.id) ? review.id : null,
      },
    ];
  });
}

export function needsOf(view: NeedsView): PullRequestNeed[] {
  if (view.state !== "open") return [];
  const needs: PullRequestNeed[] = [];
  if (view.counts.failed > 0) needs.push("checks");
  if (view.reviewers.some(({ state, onHead }) => state === "changes-requested" && onHead)) {
    needs.push("review");
  }
  if (view.mergeable === "conflicting") needs.push("conflicts");
  return needs;
}
