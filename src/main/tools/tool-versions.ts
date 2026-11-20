import type { BridgeResponse } from "../../shared/bridge-contract.ts";
import { runTool, type Tool } from "../platform/tools.ts";

const versionTimeoutMs = 5000;

async function versionOf(tool: Tool): Promise<string | null> {
  try {
    const run = await runTool(tool, ["--version"], { timeoutMs: versionTimeoutMs });
    if (run?.exitCode !== 0) return null;
    const firstLine = run.stdout.split(/\r?\n/, 1)[0] ?? "";
    return firstLine.trim().slice(0, 200);
  } catch (error) {
    console.error(error instanceof Error ? error.message : `${tool} --version failed`);
    return null;
  }
}

export async function toolVersions(): Promise<BridgeResponse<"tools.versions">> {
  const [git, gh, claude] = await Promise.all([
    versionOf("git"),
    versionOf("gh"),
    versionOf("claude"),
  ]);
  return { git, gh, claude };
}
