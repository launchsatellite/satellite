import type { PullRequestTrouble } from "../../shared/bridge-contract.ts";
import type { StopReason, ToolRun } from "../platform/tools.ts";

const signedOutStart = /^(?:To get started with GitHub CLI, please run:|HTTP 401[: ])/;
const otherHostStart =
  "none of the git remotes configured for this repository point to a known GitHub host";
const rateLimitStart =
  /^(?:HTTP \d{3}: |GraphQL: )?(?:API rate limit|You have exceeded a (?:secondary )?rate limit)/i;
const offlineStart = /^(?:error connecting to |dial tcp|(?:Get|Post|Head) "https:\/\/[^"\n]+": )/;
const offlineLine =
  /dial tcp|no such host|connection refused|network is unreachable|i\/o timeout|TLS handshake timeout|error connecting to/;
const signedOutExit = 4;

export function ghFailure(
  run: ToolRun | undefined,
  stopped: StopReason | undefined,
): PullRequestTrouble | "none" | "not-pushed" {
  if (run === undefined && stopped === undefined) return "gh-missing";
  if (stopped === "time" || stopped === "output") return "hung";
  if (run === undefined) return "failed";
  const { exitCode } = run;
  const stderr = run.stderr.trimStart();
  const first = stderr.split("\n", 1)[0] ?? "";
  if (exitCode === signedOutExit) return "signed-out";
  if (stderr.startsWith("no pull requests found")) return "none";
  if (stderr.startsWith(otherHostStart)) return "other-host";
  if (stderr.startsWith("no git remotes found")) return "not-pushed";
  if (stderr.startsWith("Unknown JSON field") || stderr.startsWith("unknown flag")) return "gh-old";
  if (signedOutStart.test(stderr)) return "signed-out";
  if (rateLimitStart.test(stderr)) return "rate-limited";
  if (offlineStart.test(stderr) && offlineLine.test(first)) return "offline";
  return "failed";
}
