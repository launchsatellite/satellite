import type {
  PullRequestAnswer,
  PullRequestCheck,
  PullRequestDetail,
  PullRequestFound,
  PullRequestThread,
  PullRequestTrouble,
} from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import type { PixelState } from "../ui/status-pixel.tsx";

type CheckResult = PullRequestCheck["result"];
type Review = Extract<PullRequestDetail, { kind: "read" }>["reviews"][number];
type Counts = PullRequestFound["counts"];
type Absence = Extract<PullRequestAnswer, { kind: "absent" }>["reason"];

export const linkSentence =
  "This address comes from the pull request. Check it before you open it.";
export const loadingSentence = "Reading the pull request.";
export const emptyBodySentence = "No description.";
export const bodyCutSentence = "The rest is on GitHub.";
export const untitled = "Untitled";
export const noChecksSentence = "No checks ran on this pull request.";
export const runningChecksSentence = "Checks that are still running show their result here.";
export const unnamedCheck = "Unnamed check";
export const readingLogSentence = "Reading the failing lines.";
export const emptyLogSentence = "No failing lines came back. Open the check on GitHub.";
export const noLogSentence =
  "This kind of check has no log to read here. Open its details on GitHub.";
export const logCutSentence = "The rest is on GitHub.";
export function showMoreLabel(left: number): string {
  return left === 1 ? "Show 1 more" : `Show ${String(left)} more`;
}

export function hiddenCommentSentence(reason: string | null): string {
  return reason === null
    ? "This comment is hidden on GitHub."
    : `This comment is hidden on GitHub as ${reason}.`;
}
export const noConversationSentence = "Nobody has reviewed or commented yet.";
export const conversationTroubleSentence =
  "The conversation could not be read. The overview above is current.";
export const someone = "Someone";
export const sendLabel = "Send to Claude Code";

const troubles: Record<PullRequestTrouble, string> = {
  "signed-out": "The GitHub CLI is signed out. Run gh auth login in a terminal and come back.",
  "gh-missing":
    "Satellite reads pull requests through the GitHub CLI, and it is not installed. Install it and come back.",
  "gh-old": "This GitHub CLI is too old to read pull requests. Update it to 2.18 or newer.",
  offline: "GitHub is out of reach. Satellite tries again when you are back online.",
  "other-host":
    "This repository's remote is on a host the GitHub CLI is not signed in to. Run gh auth login for that host and come back.",
  "rate-limited":
    "GitHub asked Satellite to slow down. Pull requests refresh again in a few minutes.",
  hung: "The GitHub CLI took too long to answer. Satellite tries again shortly.",
  failed: "Satellite could not read this pull request. It tries again shortly.",
};
const absences: Record<Absence, string> = {
  none: "No pull request for this branch yet.",
  "not-pushed": "This branch is not on GitHub yet. Push it and its pull request shows up here.",
  target: "Pull requests land on this branch. They live on other branches.",
};
const results: Record<CheckResult, string> = {
  failed: "Failed",
  pending: "Running",
  passed: "Passed",
  skipped: "Skipped",
  cancelled: "Cancelled",
  unknown: "Unknown",
};
const resultPixels: Record<CheckResult, PixelState> = {
  failed: "needs-you",
  pending: "working",
  passed: "ready",
  skipped: "idle",
  cancelled: "idle",
  unknown: "idle",
};
const reviewWords: Record<Review["state"], string> = {
  approved: "Approved",
  "changes-requested": "Changes requested",
  commented: "Commented",
  dismissed: "Dismissed",
  pending: "Pending",
};
const states: Record<PullRequestFound["state"], string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace("<n>", String(count));
}

function baseOf(found: PullRequestFound): string {
  return found.base === null ? "the base branch" : visibleText(found.base);
}

export function troubleSentence(reason: PullRequestTrouble): string {
  return troubles[reason];
}

export function absentSentence(reason: Absence): string {
  return absences[reason];
}

export function stateWord(state: PullRequestFound["state"]): string {
  return states[state];
}

export function checksSummary({ failed, pending, total }: Counts): string {
  if (total === 0) return "No checks";
  if (failed > 0) return `${String(failed)} failed`;
  if (pending > 0) return `${String(pending)} running`;
  return `All ${String(total)} passed`;
}

export function blocks(found: PullRequestFound): { key: string; sentence: string }[] {
  if (found.state === "merged") return [{ key: "merged", sentence: "It is merged." }];
  if (found.state === "closed") return [{ key: "closed", sentence: "It is closed." }];
  const base = baseOf(found);
  const rows: { key: string; sentence: string }[] = [];
  const add = (applies: boolean, key: string, sentence: string) => {
    if (applies) rows.push({ key, sentence });
  };
  add(found.state === "draft", "draft", "It is a draft.");
  add(found.mergeable === "conflicting", "conflicts", `It conflicts with ${base}.`);
  add(
    found.mergeable === "unknown",
    "unknown",
    "GitHub is still working out whether it can merge.",
  );
  add(found.review === "changes-requested", "changes", "A review asks for changes.");
  add(found.review === "review-required", "review", "It still needs a review.");
  add(
    found.counts.failed > 0,
    "failed",
    plural(found.counts.failed, "1 check failed.", "<n> checks failed."),
  );
  add(
    found.counts.pending > 0,
    "running",
    plural(found.counts.pending, "1 check is still running.", "<n> checks are still running."),
  );
  add(found.mergeState === "behind", "behind", `It is behind ${base}.`);
  add(found.mergeState === "blocked" && rows.length === 0, "rule", "A branch rule blocks it.");
  add(rows.length === 0, "clear", "Nothing blocks it.");
  return rows;
}

const decisions: Record<PullRequestFound["review"], string | null> = {
  approved: "The pull request is approved.",
  "changes-requested": "A review asks for changes.",
  "review-required": "It still needs a review.",
  none: null,
};

export function decisionSentence(review: PullRequestFound["review"]): string | null {
  return decisions[review];
}

export function readoutLabel(found: PullRequestFound): string {
  return `Pull request ${String(found.number)}, ${stateWord(found.state)}, ${checksSummary(found.counts)}`;
}

export function readoutRest(found: PullRequestFound): string {
  return ` ${stateWord(found.state)} · ${checksSummary(found.counts)}`;
}

export function readoutPixel({ state, counts }: PullRequestFound): PixelState {
  if (state === "merged") return "done";
  if (state === "closed") return "idle";
  if (counts.failed > 0) return "needs-you";
  if (counts.pending > 0) return "working";
  return counts.total > 0 ? "ready" : "idle";
}

export function checksState(counts: Counts): "failed" | "pending" | "passed" | "none" {
  if (counts.total === 0) return "none";
  if (counts.failed > 0) return "failed";
  return counts.pending > 0 ? "pending" : "passed";
}

export function tabLabel(number: number | null): string {
  return number === null ? "Pull request" : `Pull request #${String(number)}`;
}

export function resultWord(result: CheckResult): string {
  return results[result];
}

export function resultPixel(result: CheckResult): PixelState {
  return resultPixels[result];
}

export type FileState = "clean" | "changed" | "unknown" | "loading";

export function unmarkedSentence(atHead: boolean | null, file: FileState): string | null {
  if (atHead === true && (file === "clean" || file === "loading")) return null;
  if (atHead === true && file === "changed") {
    return "This file has uncommitted changes, so its threads are not marked on lines.";
  }
  if (atHead === true) {
    return "Satellite cannot tell whether this file has uncommitted changes, so its threads are not marked on lines.";
  }
  if (atHead === false) {
    return "This workspace is not at the pull request's last commit, so threads are not marked on lines.";
  }
  return "Satellite cannot tell whether this workspace is at the pull request's last commit, so threads are not marked on lines.";
}
export const threadsHeading = "Threads in this file";
export const offLineHeading = "Not on a line here";
export const noFileThreadsSentence = "No threads in this file.";
export const noUnresolvedSentence = "No unresolved threads.";

export function noBaseSentence(base: string | null): string {
  return `Satellite does not have ${base === null ? "the base branch" : visibleText(base)} here yet.`;
}

export function moreSentence(count: number): string {
  return `${String(count)} more on GitHub.`;
}

export function openLabel(host: string, address: string, otherLabel: string): string {
  return URL.parse(address)?.host === host ? "Open on GitHub" : otherLabel;
}

export function reviewWord(state: Review["state"]): string {
  return reviewWords[state];
}

export function threadBadges(thread: PullRequestThread): string[] {
  return [thread.resolved ? "Resolved" : "Unresolved", ...(thread.outdated ? ["Outdated"] : [])];
}
