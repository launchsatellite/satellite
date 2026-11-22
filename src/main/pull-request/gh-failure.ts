import type { PullRequestTrouble } from "../../shared/bridge-contract.ts";
import type { StopReason, ToolRun } from "../platform/tools.ts";

const signedOutStart = /^(?:To get started with GitHub CLI, please run:|HTTP 401[: ])/;
const otherHostStarts = [
  "none of the git remotes configured for this repository point to a known GitHub host",
  "set the GH_HOST environment variable to specify which GitHub host to use",
  "could not find any host configurations",
];
const rateLimitStart =
  /^(?:HTTP \d{3}: |GraphQL: )?(?:API rate limit|You have exceeded a (?:secondary )?rate limit)/i;
const offlineStart = /^(?:error connecting to |dial tcp|(?:Get|Post|Head) "https:\/\/[^"\n]+": )/;
const offlineLine =
  /dial tcp|no such host|connection refused|network is unreachable|i\/o timeout|TLS handshake timeout|error connecting to/;
const signedOutExit = 4;
const apiPrefix = "gh: ";

export function ghFailure(
  run: ToolRun | undefined,
  stopped: StopReason | undefined,
): PullRequestTrouble | "none" | "not-pushed" {
  if (run === undefined && stopped === undefined) return "gh-missing";
  if (stopped === "time" || stopped === "output") return "hung";
  if (run === undefined) return "failed";
  const { exitCode } = run;
  const stderr = run.stderr.trimStart();
  if (exitCode === signedOutExit) return "signed-out";
  if (stderr.startsWith("no pull requests found")) return "none";
  if (otherHostStarts.some((start) => stderr.startsWith(start))) return "other-host";
  if (stderr.startsWith("no git remotes found")) return "not-pushed";
  if (stderr.startsWith("Unknown JSON field") || stderr.startsWith("unknown flag")) return "gh-old";
  const api = stderr.startsWith(apiPrefix);
  const said = api ? stderr.slice(apiPrefix.length) : stderr;
  const first = said.split("\n", 1)[0] ?? "";
  const status = api ? (/ \(HTTP (\d{3})\)$/.exec(first)?.[1] ?? "") : "";
  if (signedOutStart.test(said) || status === "401") return "signed-out";
  if (rateLimitStart.test(said) || status === "429") return "rate-limited";
  if (offlineStart.test(said) && offlineLine.test(first)) return "offline";
  return "failed";
}
