import type { GhState, ToolCheck, ToolState } from "../../shared/bridge-contract.ts";
import { installCommand } from "../platform/install-commands.ts";
import { runTool, type Tool } from "../platform/tools.ts";
import { parseGhAuthStatus, type GhSignIn } from "./gh-auth.ts";

const versionTimeoutMs = 5000;
const authTimeoutMs = 10_000;
const versionLimit = 200;

let running: Promise<ToolCheck> | undefined;

function logFailure(error: unknown, fallback: string): void {
  console.error(error instanceof Error ? error.message : fallback);
}

async function versionOf(tool: Tool): Promise<ToolState> {
  const missing: ToolState = { state: "missing", fix: installCommand(tool) };
  try {
    const run = await runTool(tool, ["--version"], { timeoutMs: versionTimeoutMs });
    if (run?.exitCode !== 0) return missing;
    const version = versionNumber(run.stdout.split(/\r?\n/, 1)[0] ?? "");
    return version === "" ? missing : { state: "ready", version };
  } catch (error) {
    logFailure(error, `${tool} --version failed`);
    return missing;
  }
}

async function signInOfGh(): Promise<GhSignIn> {
  try {
    const run = await runTool("gh", ["auth", "status", "--active"], { timeoutMs: authTimeoutMs });
    return run === undefined ? { signedIn: false, reason: "failed" } : parseGhAuthStatus(run);
  } catch (error) {
    logFailure(error, "gh auth status failed");
    return { signedIn: false, reason: "failed" };
  }
}

function ghState(version: ToolState, signIn: GhSignIn): GhState {
  if (version.state === "missing") return version;
  if (!signIn.signedIn) return { state: "signed-out", reason: signIn.reason, fix: "gh auth login" };
  return { ...version, account: signIn.account };
}

async function readTools(): Promise<ToolCheck> {
  const [git, gh, claude, signIn] = await Promise.all([
    versionOf("git"),
    versionOf("gh"),
    versionOf("claude"),
    signInOfGh(),
  ]);
  return { git, gh: ghState(gh, signIn), claude };
}

export function versionNumber(line: string): string {
  return /\d+(?:\.\d+)+/.exec(line)?.[0] ?? line.trim().slice(0, versionLimit);
}

export function checkTools(): Promise<ToolCheck> {
  running ??= readTools().finally(() => {
    running = undefined;
  });
  return running;
}
