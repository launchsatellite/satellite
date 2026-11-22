import type { ToolRun } from "../platform/tools.ts";
import { gitReadMs, noLazyFetch, runGit, storedObjects } from "./git-command.ts";

interface Tracking {
  ahead: number;
  behind: number;
}

const countCap = 1_000_000;
const branchesPerRead = 21;
const countShape = /^\d+\n?$/;
const trackShape = /^(?:ahead (\d+)(?:, behind (\d+))?|behind (\d+))$/;

function capped(digits: string | undefined): number {
  return digits === undefined ? 0 : Math.min(Number(digits), countCap);
}

export function parseCount(stdout: string): number | null {
  return countShape.test(stdout) ? capped(stdout.trim()) : null;
}

export async function hasRemote(
  root: string,
  listed: Promise<ToolRun | undefined> = runGit(root, ["remote"], gitReadMs, undefined, {
    gitVariables: noLazyFetch,
  }),
): Promise<boolean | undefined> {
  const run = await listed;
  return run?.exitCode === 0 ? run.stdout.trim() !== "" : undefined;
}

export async function countUnpushed(root: string, branch: string): Promise<number | null> {
  const run = await runGit(
    root,
    ["rev-list", "--count", `refs/heads/${branch}`, "--not", "--remotes", "--"],
    gitReadMs,
    undefined,
    { gitVariables: storedObjects },
  );
  return run?.exitCode === 0 ? parseCount(run.stdout) : null;
}

export function parseTrack(track: string): Tracking | null {
  if (track === "") return { ahead: 0, behind: 0 };
  const match = trackShape.exec(track);
  if (match === null) return null;
  const [, ahead, behindAfterAhead, behindAlone] = match;
  return { ahead: capped(ahead), behind: capped(behindAfterAhead ?? behindAlone) };
}

export async function readTracking(
  root: string,
  branches: readonly string[],
): Promise<Map<string, Tracking | null>> {
  const tracking = new Map<string, Tracking | null>();
  const refs = new Map(
    [...new Set(branches)]
      .slice(0, branchesPerRead)
      .map((branch) => [`refs/heads/${branch}`, branch]),
  );
  if (refs.size === 0) return tracking;
  const run = await runGit(
    root,
    [
      "for-each-ref",
      "--format=%(refname)%00%(upstream)%00%(upstream:track,nobracket)",
      ...refs.keys(),
    ],
    gitReadMs,
    undefined,
    { gitVariables: storedObjects },
  );
  if (run?.exitCode !== 0) return tracking;
  for (const line of run.stdout.split("\n")) {
    const [refname, upstream, track, ...rest] = line.split("\0");
    const branch = refname === undefined ? undefined : refs.get(refname);
    if (branch === undefined || upstream === undefined || track === undefined || rest.length > 0)
      continue;
    tracking.set(branch, upstream === "" ? null : parseTrack(track));
  }
  return tracking;
}
