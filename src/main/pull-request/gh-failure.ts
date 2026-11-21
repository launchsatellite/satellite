import type { PullRequestTrouble } from "../../shared/bridge-contract.ts";
import type { StopReason, ToolRun } from "../platform/tools.ts";

const offlineLine =
  /dial tcp|no such host|connection refused|network is unreachable|i\/o timeout|TLS handshake timeout|error connecting to/;
const rateLimitLine = /rate limit/i;
const signedOutExit = 4;

export function ghFailure(
  run: ToolRun | undefined,
  stopped: StopReason | undefined,
): PullRequestTrouble | "none" | "not-pushed" {
  if (run === undefined && stopped === undefined) return "gh-missing";
  if (stopped === "time" || stopped === "output") return "hung";
  if (run === undefined) return "failed";
  const { exitCode, stderr } = run;
  if (exitCode === signedOutExit || stderr.includes("gh auth login")) return "signed-out";
  if (stderr.trimStart().startsWith("no pull requests found")) return "none";
  if (stderr.includes("no git remotes found")) return "not-pushed";
  if (stderr.includes("Unknown JSON field") || stderr.includes("unknown flag")) return "gh-old";
  if (stderr.includes("point to a known GitHub host")) return "other-host";
  if (rateLimitLine.test(stderr)) return "rate-limited";
  if (offlineLine.test(stderr)) return "offline";
  return "failed";
}
