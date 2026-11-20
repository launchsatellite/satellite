import { BridgeFailure } from "../bridge/registry.ts";
import { AbandonedRun, runTool, type ToolRun } from "../platform/tools.ts";
import { gitReadTimeoutMs } from "../projects/repository-check.ts";

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
];

export function gitArgs(folder: string, args: readonly string[]): string[] {
  return ["--no-optional-locks", "-C", folder, ...safeConfig, ...args];
}

export async function runGit(
  folder: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<ToolRun | undefined> {
  let run: ToolRun | undefined;
  try {
    run = await runTool("git", gitArgs(folder, args), { timeoutMs });
  } catch (error) {
    if (error instanceof AbandonedRun) await error.exited;
    return undefined;
  }
  if (run === undefined) {
    throw new BridgeFailure(
      "tool-missing",
      "Satellite needs git for workspaces. Install git, then try again.",
    );
  }
  return run;
}
