import { isBranchName } from "../../shared/workspace-name.ts";
import { gitReadMs, noLazyFetch, runGit } from "../workspaces/git-command.ts";

const remoteRef = /^refs\/remotes\/[^/]+\/(.+)$/;

export async function isPushed(
  folder: string,
  branch: string | null,
  signal: AbortSignal,
): Promise<boolean | undefined> {
  if (branch === null) return false;
  if (!isBranchName(branch)) return undefined;
  const options = { gitVariables: noLazyFetch };
  const refs = await runGit(
    folder,
    ["for-each-ref", "--format=%(refname)", `refs/remotes/*/${branch}`],
    gitReadMs,
    signal,
    options,
  );
  if (refs?.exitCode !== 0) return undefined;
  if (refs.stdout.split("\n").some((line) => remoteRef.exec(line)?.[1] === branch)) return true;
  const upstream = await runGit(
    folder,
    ["config", "--get", `branch.${branch}.merge`],
    gitReadMs,
    signal,
    options,
  );
  if (upstream === undefined || upstream.exitCode > 1) return undefined;
  return upstream.exitCode === 0 && upstream.stdout.trim() !== "";
}
