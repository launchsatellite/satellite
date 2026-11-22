import type { ClaudeState, GhState, ToolCheck, ToolState } from "../../shared/bridge-contract.ts";
import { stat } from "node:fs/promises";
import { installCommand } from "../platform/install-commands.ts";
import { runTool, type ResolvedCommand, type Tool } from "../platform/tools.ts";
import { parseGhAuthStatus, type GhSignIn } from "./gh-auth.ts";

const versionTimeoutMs = 5000;
const authTimeoutMs = 10_000;
const versionLimit = 200;
const firstWithActive = [2, 40, 0];
const claudeMinimum = [2, 1, 78];
export const claudeAnswerMs = 60_000;

let running: Promise<ToolCheck> | undefined;
let claudeAnswer: { key: string; at: number; state: Promise<ClaudeState> } | undefined;

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

export async function checkClaude(): Promise<ClaudeState> {
  const version = await versionOf("claude");
  if (version.state !== "ready" || atLeast(version.version, claudeMinimum)) return version;
  return { state: "too-old", version: version.version, minimum: claudeMinimum.join(".") };
}

async function fileKey(file: string): Promise<string | undefined> {
  try {
    const { size, mtimeMs } = await stat(file);
    return JSON.stringify([file, size, mtimeMs]);
  } catch {
    return undefined;
  }
}

export async function launchableClaude(command: ResolvedCommand): Promise<ClaudeState> {
  const key = await fileKey(command.file);
  const now = performance.now();
  if (key !== undefined && claudeAnswer?.key === key && now - claudeAnswer.at < claudeAnswerMs) {
    return claudeAnswer.state;
  }
  const state = checkClaude();
  if (key !== undefined) claudeAnswer = { key, at: now, state };
  return state;
}

async function readTools(): Promise<ToolCheck> {
  const [git, gh, claude] = await Promise.all([versionOf("git"), checkGh(), checkClaude()]);
  return { git, gh, claude };
}

function atLeast(version: string, minimum: readonly number[]): boolean {
  const parts = version.split(".").map(Number);
  const index = minimum.findIndex((part, at) => (parts[at] ?? 0) !== part);
  return index === -1 || (parts[index] ?? 0) > (minimum[index] ?? 0);
}

export function authStatusArguments(ghVersion: string): string[] {
  return atLeast(ghVersion, firstWithActive) ? ["auth", "status", "--active"] : ["auth", "status"];
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
