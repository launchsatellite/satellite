import type { PullRequestFound, PullRequestNeed } from "../../shared/bridge-contract.ts";
import type { CheckCounts } from "./check-result.ts";

export interface ReviewFact {
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
  reviews: readonly ReviewFact[];
  headOid: string | null;
}

const deciding = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
const writers = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function hasWriteAccess(association: string | null | undefined): boolean {
  return association !== null && association !== undefined && writers.has(association);
}

function asksForChangesOnHead(reviews: readonly ReviewFact[], headOid: string | null): boolean {
  if (headOid === null) return false;
  const newest = new Map<string, ReviewFact>();
  for (const review of reviews) {
    if (!deciding.has(review.state) || !hasWriteAccess(review.association)) continue;
    const login = review.login ?? "";
    const earlier = newest.get(login);
    if (earlier === undefined || (review.at ?? "") >= (earlier.at ?? "")) newest.set(login, review);
  }
  return [...newest.values()].some(
    ({ state, commit }) => state === "CHANGES_REQUESTED" && commit === headOid,
  );
}

export function needsOf(view: NeedsView): PullRequestNeed[] {
  if (view.state !== "open") return [];
  const needs: PullRequestNeed[] = [];
  if (view.counts.failed > 0) needs.push("checks");
  if (asksForChangesOnHead(view.reviews, view.headOid)) needs.push("review");
  if (view.mergeable === "conflicting") needs.push("conflicts");
  return needs;
}
