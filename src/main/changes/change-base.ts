import { isBranchName } from "../../shared/workspace-name.ts";
import type { ToolRun } from "../platform/tools.ts";
import { samePath } from "../platform/paths.ts";
import { defaultStart } from "../workspaces/create-steps.ts";
import { gitReadMs, runGit } from "../workspaces/git-command.ts";
import { noLazyFetch, oidPattern } from "./file-sides.ts";

export interface ChangeBase {
  ref: string;
  name: string;
  oid: string;
}
export type BaseLookup =
  | { kind: "base"; base: ChangeBase }
  | { kind: "none"; why: "main-workspace" | "main-detached" | "gone" }
  | { kind: "failed" };

const cachedForks = 64;
const forks = new Map<string, string>();
const failed: BaseLookup = { kind: "failed" };
const mainWorkspace: BaseLookup = { kind: "none", why: "main-workspace" };
const mainDetached: BaseLookup = { kind: "none", why: "main-detached" };

function oneLine(stdout: string): string {
  return stdout.endsWith("\n") ? stdout.slice(0, -1) : "";
}

async function commitOid(folder: string, spec: string, signal?: AbortSignal) {
  const run = await runGit(folder, ["rev-parse", "--verify", "--quiet", spec], gitReadMs, signal, {
    gitVariables: noLazyFetch,
  });
  if (run === undefined) return undefined;
  if (run.exitCode === 1) return null;
  const oid = oneLine(run.stdout);
  return run.exitCode === 0 && oidPattern.test(oid) ? oid : undefined;
}

async function baseRef(
  projectRoot: string,
  folder: string,
  signal?: AbortSignal,
  remotes?: Promise<ToolRun | undefined>,
): Promise<BaseLookup | Omit<ChangeBase, "oid">> {
  const start = await defaultStart(projectRoot, remotes);
  if (start === undefined) return failed;
  if (start.remote !== null && start.branch !== null) {
    const name = `${start.remote}/${start.branch}`;
    return { ref: `refs/remotes/${name}`, name };
  }
  if (samePath(folder, projectRoot)) return mainWorkspace;
  const branch = await currentBranch(projectRoot, signal);
  if (branch === undefined) return failed;
  if (branch === null) return mainDetached;
  return { ref: `refs/heads/${branch}`, name: branch };
}

export async function headOid(
  folder: string,
  signal?: AbortSignal,
): Promise<string | null | undefined> {
  return commitOid(folder, "HEAD^{commit}", signal);
}

export async function currentBranch(
  folder: string,
  signal?: AbortSignal,
): Promise<string | null | undefined> {
  const run = await runGit(folder, ["branch", "--show-current"], gitReadMs, signal, {
    gitVariables: noLazyFetch,
  });
  if (run?.exitCode !== 0) return undefined;
  const branch = oneLine(run.stdout);
  return isBranchName(branch) ? branch : null;
}

export async function resolveBase(
  projectRoot: string,
  folder: string,
  signal?: AbortSignal,
  remotes?: Promise<ToolRun | undefined>,
): Promise<BaseLookup> {
  const found = await baseRef(projectRoot, folder, signal, remotes);
  if ("kind" in found) return found;
  const oid = await commitOid(folder, `${found.ref}^{commit}`, signal);
  if (oid === undefined) return failed;
  if (oid === null) return { kind: "none", why: "gone" };
  return { kind: "base", base: { ...found, oid } };
}

export async function mergeBase(
  folder: string,
  head: string,
  base: string,
  signal?: AbortSignal,
): Promise<string | null | undefined> {
  if (!oidPattern.test(head) || !oidPattern.test(base)) return undefined;
  const key = `${folder}\0${head}\0${base}`;
  const known = forks.get(key);
  if (known !== undefined) return known;
  const run = await runGit(folder, ["merge-base", head, base], gitReadMs, signal, {
    gitVariables: noLazyFetch,
  });
  if (run === undefined) return undefined;
  if (run.exitCode === 1) return null;
  const oid = oneLine(run.stdout);
  if (run.exitCode !== 0 || !oidPattern.test(oid)) return undefined;
  forks.set(key, oid);
  const oldest = forks.keys().next().value;
  if (forks.size > cachedForks && oldest !== undefined) forks.delete(oldest);
  return oid;
}
