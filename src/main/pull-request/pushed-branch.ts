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

export interface BranchFacts {
  upstream: string | null;
  upstreamRepository: { owner: string; repo: string } | null;
  isDefault: boolean;
}

const upstreamRef = /^refs\/heads\/(.+)$/;
const defaultRef = /^refs\/remotes\/[^/]+\/(.+)$/;
const remoteName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const remoteAddress =
  /^(?:https:\/\/[^/@\s]+\/|ssh:\/\/(?:[^/@\s]+@)?[^/\s]+\/|[^/@\s]+@[^/:\s]+:)([A-Za-z0-9][A-Za-z0-9_-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

async function configValue(
  folder: string,
  key: string,
  signal: AbortSignal,
): Promise<string | null | undefined> {
  const run = await runGit(folder, ["config", "--get", key], gitReadMs, signal, {
    gitVariables: noLazyFetch,
  });
  if (run === undefined || run.exitCode > 1) return undefined;
  return run.exitCode === 0 ? run.stdout.trim() : null;
}

export async function branchFacts(
  folder: string,
  branch: string | null,
  signal: AbortSignal,
): Promise<BranchFacts | undefined> {
  if (branch === null) return { upstream: null, upstreamRepository: null, isDefault: false };
  if (!isBranchName(branch)) return undefined;
  const options = { gitVariables: noLazyFetch };
  const merge = await runGit(
    folder,
    ["config", "--get", `branch.${branch}.merge`],
    gitReadMs,
    signal,
    options,
  );
  if (merge === undefined || merge.exitCode > 1) return undefined;
  const named = upstreamRef.exec(merge.stdout.trim())?.[1];
  const upstream = named !== undefined && isBranchName(named) ? named : null;
  const remote = await configValue(folder, `branch.${branch}.remote`, signal);
  if (remote === undefined) return undefined;
  const address =
    remote !== null && remoteName.test(remote)
      ? await configValue(folder, `remote.${remote}.url`, signal)
      : null;
  if (address === undefined) return undefined;
  const [, owner, repo] = (address === null ? null : remoteAddress.exec(address)) ?? [];
  const upstreamRepository = owner === undefined || repo === undefined ? null : { owner, repo };
  const heads = await runGit(
    folder,
    ["for-each-ref", "--format=%(symref)", "refs/remotes/*/HEAD"],
    gitReadMs,
    signal,
    options,
  );
  if (heads?.exitCode !== 0) return undefined;
  const isDefault = heads.stdout.split("\n").some((line) => defaultRef.exec(line)?.[1] === branch);
  return { upstream, upstreamRepository, isDefault };
}
