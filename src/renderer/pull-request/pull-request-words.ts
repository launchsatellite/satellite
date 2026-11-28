import type {
  PullRequestAnswer,
  PullRequestFound,
  PullRequestTrouble,
} from "../../shared/bridge-contract.ts";
import type { PixelState } from "../ui/status-pixel.tsx";

type Counts = PullRequestFound["counts"];
type Absence = Extract<PullRequestAnswer, { kind: "absent" }>["reason"];

export const linkSentence =
  "This address comes from the pull request. Check it before you open it.";
export const loadingSentence = "Reading the pull request.";
export const readingLogSentence = "Reading the failing lines.";
export const emptyLogSentence = "No failing lines came back. Open the check on GitHub.";
export const largeLogSentence = "This log is too large to show here. Open the check on GitHub.";
export const noLogSentence =
  "This kind of check has no log to read here. Open its details on GitHub.";
export const logCutSentence = "The rest is on GitHub.";
export const sendLabel = "Send to Claude Code";

const troubles: Record<PullRequestTrouble, string> = {
  "signed-out": "The GitHub CLI is signed out. Run gh auth login in a terminal and come back.",
  "gh-missing":
    "Satellite reads pull requests through the GitHub CLI, and it is not installed. Install it and come back.",
  "gh-old": "This GitHub CLI is too old to read pull requests. Update it to 2.21 or newer.",
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
  target: "Pull requests land on this branch, so it has none of its own.",
};
const states: Record<PullRequestFound["state"], string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

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

export function moreSentence(count: number): string {
  return `${String(count)} more on GitHub.`;
}

export function openLabel(host: string, address: string, otherLabel: string): string {
  return URL.parse(address)?.host === host ? "Open on GitHub" : otherLabel;
}
