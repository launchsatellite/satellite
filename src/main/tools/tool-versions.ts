import type { BridgeResponse } from "../../shared/bridge-contract.ts";
import { runTool, type Tool } from "../platform/tools.ts";

async function versionOf(tool: Tool): Promise<string | null> {
  const run = await runTool(tool, ["--version"]);
  if (run?.exitCode !== 0) return null;
  const firstLine = run.stdout.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.trim().slice(0, 200);
}

export async function toolVersions(): Promise<BridgeResponse<"tools.versions">> {
  const [git, gh, claude] = await Promise.all([
    versionOf("git"),
    versionOf("gh"),
    versionOf("claude"),
  ]);
  return { git, gh, claude };
}
