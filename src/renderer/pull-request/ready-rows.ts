import type { PullRequestFound, PullRequestReviewer } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { conflictRequest } from "../changes/prompt-requests.ts";
import { reviewRequest, threadsRequest } from "./pull-request-requests.ts";

export type RowLook = "clear" | "signal" | "blocks" | "open";
export type CardLook = "clear" | "signal" | "blocks" | "merged" | "closed";
export type RowKey = "draft" | "checks" | "reviews" | "conflicts" | "threads" | "rule";

export interface ReadyRow {
  key: RowKey;
  look: RowLook;
  title: string;
  detail: string | null;
  count: string | null;
  request: string | null;
}

export interface ReadyCard {
  look: CardLook;
  title: string;
  rows: ReadyRow[];
}

function row(key: RowKey, look: RowLook, title: string, extra: Partial<ReadyRow> = {}): ReadyRow {
  return { key, look, title, detail: null, count: null, request: null, ...extra };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace("<n>", String(count));
}

function baseOf(found: PullRequestFound): string {
  return found.base === null ? "the base branch" : visibleText(found.base);
}

function namesOf(reviewers: readonly PullRequestReviewer[]): string {
  const names = reviewers.map(({ login }) => (login === null ? "someone" : visibleText(login)));
  return [...new Set(names)].join(", ");
}

function checksRow(found: PullRequestFound): ReadyRow {
  const { failed, pending, passed, total } = found.counts;
  const count = `${String(passed)}/${String(total)}`;
  if (total === 0) return row("checks", "clear", "No checks ran");
  if (failed > 0) {
    return row("checks", "signal", plural(failed, "1 check failed", "<n> checks failed"), {
      count,
    });
  }
  if (pending > 0) {
    return row(
      "checks",
      "blocks",
      plural(pending, "1 check is running", "<n> checks are running"),
      { count },
    );
  }
  return row("checks", "clear", "Checks passed", { count });
}

function reviewsRow(found: PullRequestFound): ReadyRow {
  const asking = found.reviewers.filter(({ state }) => state === "changes-requested");
  const onHead = asking.filter((reviewer) => reviewer.onHead);
  const approving = found.reviewers.filter(({ state }) => state === "approved");
  const pointer = (from: readonly PullRequestReviewer[]) =>
    reviewRequest(found.number, from.find(({ id }) => id !== null)?.id ?? null);
  if (found.needs.includes("review")) {
    return row("reviews", "signal", `Changes requested by ${namesOf(onHead)}`, {
      detail: "On the latest commit",
      request: pointer(onHead),
    });
  }
  if (asking.length > 0) {
    return row("reviews", "blocks", `Changes requested by ${namesOf(asking)}`, {
      detail: "On an earlier commit",
      request: pointer(asking),
    });
  }
  if (found.review === "changes-requested") {
    return row("reviews", "blocks", "Changes requested", { request: pointer([]) });
  }
  if (found.review === "review-required") {
    return row("reviews", "blocks", "Waiting for a review", {
      detail: approving.length > 0 ? `Approved by ${namesOf(approving)} so far` : null,
    });
  }
  if (approving.length > 0) return row("reviews", "clear", `Approved by ${namesOf(approving)}`);
  return row("reviews", "clear", "No reviews yet");
}

function conflictsRow(found: PullRequestFound): ReadyRow {
  const base = baseOf(found);
  if (found.mergeable === "conflicting") {
    return row("conflicts", "signal", `Conflicts with ${base}`, {
      request: conflictRequest(found.base),
    });
  }
  if (found.mergeable === "unknown") {
    return row("conflicts", "blocks", `GitHub is still checking for conflicts with ${base}`);
  }
  if (found.mergeState === "behind") return row("conflicts", "blocks", `Behind ${base}`);
  return row("conflicts", "clear", `No conflicts with ${base}`);
}

function threadsRow(found: PullRequestFound): ReadyRow {
  const { detail } = found;
  if (detail === null) return row("threads", "open", "Reading the review threads");
  if (detail.kind === "unavailable") {
    return row("threads", "open", "The review threads could not be read");
  }
  const { openThreads, moreThreads } = detail;
  if (openThreads === 0 && moreThreads === 0) {
    return row("threads", "clear", "Every thread resolved");
  }
  return row("threads", "open", plural(openThreads, "1 open thread", "<n> open threads"), {
    detail: moreThreads > 0 ? `${String(moreThreads)} more on GitHub` : null,
    request: threadsRequest(found.number),
  });
}

export function blocks({ look }: ReadyRow): boolean {
  return look === "signal" || look === "blocks";
}

export function readyCard(found: PullRequestFound): ReadyCard {
  if (found.state === "merged") return { look: "merged", title: "Merged", rows: [] };
  if (found.state === "closed") return { look: "closed", title: "Closed", rows: [] };
  const rows = [
    ...(found.state === "draft" ? [row("draft", "blocks", "Still a draft")] : []),
    checksRow(found),
    reviewsRow(found),
    conflictsRow(found),
    threadsRow(found),
  ];
  if (found.mergeState === "blocked" && !rows.some(blocks)) {
    rows.push(row("rule", "blocks", "A branch rule blocks it"));
  }
  const blocking = rows.filter(blocks).length;
  const look: CardLook =
    blocking === 0 ? "clear" : rows.some(({ look }) => look === "signal") ? "signal" : "blocks";
  const title =
    blocking === 0
      ? "Nothing blocks the merge"
      : plural(blocking, "1 thing blocks the merge", "<n> things block the merge");
  return { look, title, rows };
}
