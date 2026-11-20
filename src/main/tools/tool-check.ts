import type { GhState, ToolCheck, ToolState } from "../../shared/bridge-contract.ts";
import { installCommand } from "../platform/install-commands.ts";
import { runTool, type Tool } from "../platform/tools.ts";
import { parseGhAuthStatus, type GhSignIn } from "./gh-auth.ts";

const versionTimeoutMs = 5000;
const authTimeoutMs = 10_000;
const versionLimit = 200;
const firstWithActive = [2, 40, 0];

let running: Promise<ToolCheck> | undefined;

function logFailure(error: unknown, fallback: string): void {
  console.error(error instanceof Error ? error.message : fallback);
}

async function versionOf(tool: Tool): Promise<ToolState> {
  try {
    const run = await runTool(tool, ["--version"], { timeoutMs: versionTimeoutMs });
    if (run === undefined) return { state: "missing", fix: installCommand(tool) };
    const version = run.exitCode === 0 ? versionNumber(run.stdout.split(/\r?\n/, 1)[0] ?? "") : "";
    return version === "" ? { state: "broken" } : { state: "ready", version };
  } catch (error) {
    logFailure(error, `${tool} --version failed`);
    return { state: "broken" };
  }
}

async function signInOfGh(args: readonly string[]): Promise<GhSignIn> {
  try {
    const run = await runTool("gh", args, { timeoutMs: authTimeoutMs });
    return run === undefined ? { state: "failed" } : parseGhAuthStatus(run);
  } catch (error) {
    logFailure(error, "gh auth status failed");
    return { state: "failed" };
  }
}

async function checkGh(): Promise<GhState> {
  const version = await versionOf("gh");
  if (version.state !== "ready") return version;
  const signIn = await signInOfGh(authStatusArguments(version.version));
  if (signIn.state === "signed-in") {
    return { ...version, account: signIn.account, host: signIn.host };
  }
  if (signIn.state === "token-refused") return signIn;
  return { state: "signed-out", reason: signIn.state };
}

async function readTools(): Promise<ToolCheck> {
  const [git, gh, claude] = await Promise.all([versionOf("git"), checkGh(), versionOf("claude")]);
  return { git, gh, claude };
}

export function authStatusArguments(ghVersion: string): string[] {
  const parts = ghVersion.split(".").map(Number);
  const index = firstWithActive.findIndex((part, at) => (parts[at] ?? 0) !== part);
  const supported = index === -1 || (parts[index] ?? 0) > (firstWithActive[index] ?? 0);
  return supported ? ["auth", "status", "--active"] : ["auth", "status"];
}

export function versionNumber(line: string): string {
  return (/\d+(?:\.\d+)+/.exec(line)?.[0] ?? "").slice(0, versionLimit);
}

export function checkTools(): Promise<ToolCheck> {
  running ??= readTools().finally(() => {
    running = undefined;
  });
  return running;
}
