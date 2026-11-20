import type { WorkspaceView } from "../../shared/bridge-contract.ts";
import { AbandonedRun, runTool } from "../platform/tools.ts";
import { gitReadTimeoutMs } from "./repository-check.ts";

const branchLimit = 255;

async function currentBranch(path: string): Promise<string | null> {
  const run = await runTool("git", ["-C", path, "branch", "--show-current"], {
    timeoutMs: gitReadTimeoutMs,
  }).catch(async (error: unknown) => {
    if (error instanceof AbandonedRun) await error.exited;
    return undefined;
  });
  const branch = run?.exitCode === 0 ? run.stdout.trim() : "";
  return branch === "" ? null : branch.slice(0, branchLimit);
}

export async function mainWorkspace(path: string): Promise<WorkspaceView> {
  return { key: "main", branch: await currentBranch(path) };
}
