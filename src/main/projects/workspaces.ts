import type { WorkspaceView } from "../../shared/bridge-contract.ts";
import { runTool } from "../platform/tools.ts";
import { gitReadFlags, gitReadTimeoutMs } from "./repository-check.ts";

const branchLimit = 255;

async function currentBranch(path: string): Promise<string | null> {
  const run = await runTool("git", ["-C", path, ...gitReadFlags, "branch", "--show-current"], {
    timeoutMs: gitReadTimeoutMs,
  }).catch(() => undefined);
  const branch = run?.exitCode === 0 ? run.stdout.trim() : "";
  return branch === "" ? null : branch.slice(0, branchLimit);
}

export async function mainWorkspace(path: string): Promise<WorkspaceView> {
  return { key: "main", branch: await currentBranch(path) };
}
