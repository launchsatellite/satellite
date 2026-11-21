import type {
  PullRequestAnswer,
  PullRequestFound,
  PullRequestTrouble,
} from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import type { PixelState } from "../ui/status-pixel.tsx";

type Counts = PullRequestFound["counts"];
type Absence = Extract<PullRequestAnswer, { kind: "absent" }>["reason"];

export const linkSentence =
  "This address comes from the pull request. Check it before you open it.";
export const loadingSentence = "Reading the pull request.";
export const emptyBodySentence = "No description.";
export const bodyCutSentence = "The rest is on GitHub.";
export const untitled = "Untitled";

const troubles: Record<PullRequestTrouble, string> = {
  "signed-out": "The GitHub CLI is signed out. Run gh auth login in a terminal and come back.",
  "gh-missing": "Satellite reads pull requests through the GitHub CLI, and it is not installed.",
  "gh-old": "This GitHub CLI is too old to read pull requests. Update it to 2.18 or newer.",
  offline: "GitHub is out of reach. Satellite tries again when you are back online.",
  "other-host": "This repository's remote is on a host the GitHub CLI is not signed in to.",
  "rate-limited":
    "GitHub asked Satellite to slow down. Pull requests refresh again in a few minutes.",
  hung: "The GitHub CLI took too long to answer. Satellite tries again shortly.",
  failed: "Satellite could not read this pull request. It tries again shortly.",
};
const absences: Record<Absence, string> = {
  none: "No pull request for this branch yet.",
  "not-pushed": "This branch is not on GitHub yet. Push it and its pull request shows up here.",
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
