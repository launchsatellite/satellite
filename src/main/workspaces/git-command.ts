import { BridgeFailure } from "../bridge/registry.ts";
import { isFullyQualified } from "../platform/paths.ts";
import {
  AbandonedRun,
  runTool,
  ToolStopped,
  type GitVariable,
  type StopReason,
  type ToolRun,
} from "../platform/tools.ts";
import { gitReadTimeoutMs } from "../projects/repository-check.ts";

export type GitStop = StopReason | "stuck" | "failed";
interface GitExtra {
  gitVariables?: Readonly<Partial<Record<GitVariable, string>>>;
  bytes?: boolean;
}

export const gitReadMs = gitReadTimeoutMs;
export const lsRemoteMs = 10_000;
export const fetchMs = 15_000;
export const branchMs = 5000;
export const worktreeAddMs = 300_000;
export const ignoredListMs = 30_000;
export const worktreeRemoveMs = 120_000;

const safeConfig = [
  "-c",
  "core.fsmonitor=",
  "-c",
  "core.askPass=",
  "-c",
  "credential.interactive=false",
  "-c",
  "gc.auto=0",
  "-c",
  "maintenance.auto=false",
  "-c",
  "protocol.ext.allow=never",
  "-c",
  "submodule.recurse=false",
];
const foldersWithStuckGit = new Set<string>();

export function gitArgs(folder: string, args: readonly string[]): string[] {
  if (!isFullyQualified(folder)) throw new Error("git runs only in an absolute folder");
  return ["--no-optional-locks", "-C", folder, ...safeConfig, ...args];
}

export async function readGit(
  folder: string,
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
  extra: GitExtra = {},
): Promise<ToolRun | GitStop> {
  if (foldersWithStuckGit.has(folder)) return "stuck";
  let run: ToolRun | undefined;
  try {
    run = await runTool("git", gitArgs(folder, args), { timeoutMs, signal, ...extra });
  } catch (error) {
    if (error instanceof AbandonedRun) {
      foldersWithStuckGit.add(folder);
      const release = () => {
        foldersWithStuckGit.delete(folder);
      };
      error.exited.then(release, release);
      return "stuck";
    }
    return error instanceof ToolStopped ? error.reason : "failed";
  }
  if (run === undefined) {
    throw new BridgeFailure(
      "tool-missing",
      "Satellite needs git for workspaces. Install git, then try again.",
    );
  }
  return run;
}

export async function runGit(
  folder: string,
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
  extra: GitExtra = {},
): Promise<ToolRun | undefined> {
  const run = await readGit(folder, args, timeoutMs, signal, extra);
  return typeof run === "string" ? undefined : run;
}
