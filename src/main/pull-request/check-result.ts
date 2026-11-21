import { z } from "zod";
import {
  pullRequestLimits,
  type CheckResult,
  type PullRequestCheck,
} from "../../shared/bridge-contract.ts";
import { cutText } from "./cut-text.ts";
import type { PullRequestPlace } from "./gh-arguments.ts";

export interface CheckCounts {
  failed: number;
  pending: number;
  passed: number;
  total: number;
}

interface Kept {
  check: PullRequestCheck;
  key: string;
  startedAt: string;
}

const looseText = z.string().nullish().catch(undefined);
const rawCheck = z.object({
  name: looseText,
  workflow: looseText,
  status: looseText,
  conclusion: looseText,
  context: looseText,
  state: looseText,
  url: looseText,
  startedAt: looseText,
});
const jobPath = /^\/actions\/runs\/([0-9]{1,20})\/job\/([0-9]{1,20})$/;
const failedConclusions = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const rank: Record<CheckResult, number> = {
  failed: 0,
  pending: 1,
  passed: 2,
  skipped: 2,
  cancelled: 2,
  unknown: 2,
};

function statusResult(state: string | null | undefined): CheckResult {
  if (state === "SUCCESS") return "passed";
  if (state === "FAILURE" || state === "ERROR") return "failed";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "unknown";
}

function runResult(
  status: string | null | undefined,
  conclusion: string | null | undefined,
): CheckResult {
  if (status === undefined || status === null) return "unknown";
  if (status !== "COMPLETED") return "pending";
  if (conclusion === "SUCCESS") return "passed";
  if (conclusion === "NEUTRAL" || conclusion === "SKIPPED") return "skipped";
  if (conclusion !== undefined && conclusion !== null && failedConclusions.has(conclusion)) {
    return "failed";
  }
  if (conclusion === "CANCELLED" || conclusion === "STALE") return "cancelled";
  return "unknown";
}

function name(text: string | null | undefined): string {
  return cutText(text ?? "", pullRequestLimits.nameChars).text;
}

function addressOf(text: string | null | undefined): URL | null {
  if (text === undefined || text === null || text.length > pullRequestLimits.urlChars) return null;
  const parsed = URL.parse(text);
  return parsed?.protocol === "https:" ? parsed : null;
}

function jobOf(address: URL | null, place: PullRequestPlace): { run: string; job: string } | null {
  if (address?.host !== place.host) return null;
  const prefix = `/${place.owner}/${place.repo}`;
  if (!address.pathname.startsWith(prefix)) return null;
  const [, run, job] = jobPath.exec(address.pathname.slice(prefix.length)) ?? [];
  return run === undefined || job === undefined ? null : { run, job };
}

function keep(raw: z.output<typeof rawCheck>, place: PullRequestPlace): Kept {
  const isStatus = raw.context !== undefined && raw.context !== null && raw.context !== "";
  const address = addressOf(raw.url);
  const ids = jobOf(address, place);
  const label = name(
    raw.name !== undefined && raw.name !== null && raw.name !== "" ? raw.name : raw.context,
  );
  const workflow =
    isStatus || raw.workflow === undefined || raw.workflow === null ? null : name(raw.workflow);
  return {
    key: isStatus ? `status\0${label}` : `run\0${workflow ?? ""}\0${label}`,
    startedAt: raw.startedAt ?? "",
    check: {
      name: label,
      workflow,
      result: isStatus ? statusResult(raw.state) : runResult(raw.status, raw.conclusion),
      url: address === null ? null : (raw.url ?? null),
      run: ids?.run ?? null,
      job: ids?.job ?? null,
    },
  };
}

function compare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function order(left: PullRequestCheck, right: PullRequestCheck): number {
  const ranked = rank[left.result] - rank[right.result];
  if (ranked !== 0) return ranked;
  const flow = compare(left.workflow ?? "", right.workflow ?? "");
  return flow === 0 ? compare(left.name, right.name) : flow;
}

export function checksOf(raw: unknown, place: PullRequestPlace): PullRequestCheck[] {
  if (!Array.isArray(raw)) return [];
  const newest = new Map<string, Kept>();
  for (const entry of raw) {
    const parsed = rawCheck.safeParse(entry);
    if (!parsed.success) continue;
    const kept = keep(parsed.data, place);
    const earlier = newest.get(kept.key);
    if (earlier === undefined || kept.startedAt >= earlier.startedAt) newest.set(kept.key, kept);
  }
  return [...newest.values()].map(({ check }) => check).sort(order);
}

export function countsOf(checks: readonly PullRequestCheck[]): CheckCounts {
  const count = (...results: CheckResult[]) =>
    checks.filter(({ result }) => results.includes(result)).length;
  return {
    failed: count("failed"),
    pending: count("pending"),
    passed: count("passed", "skipped"),
    total: checks.length,
  };
}
