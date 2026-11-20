import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { findExecutable } from "./executable-search.ts";
import { endUnixTree, endWindowsTree, forceKillGraceMs, treeKillBoundMs } from "./process-tree.ts";
import { userEnvironment } from "./user-environment.ts";

export type Tool = "git" | "gh" | "claude";
export interface ResolvedCommand {
  readonly file: string;
  readonly args: readonly string[];
}
export interface ToolRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export const toolOverrideVariables: Readonly<Partial<Record<Tool, string>>> = {
  gh: "SATELLITE_GH",
  claude: "SATELLITE_CLAUDE",
};

const appLaunchKeys = new Set([
  "APPIMAGE",
  "APPDIR",
  "ARGV0",
  "OWD",
  "CHROME_DESKTOP",
  "ORIGINAL_XDG_CURRENT_DESKTOP",
]);
const gitDroppedKeys = new Set([
  "LANGUAGE",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
]);
const ghUnsafeKeys = new Set(["GH_DEBUG", "DEBUG", "GH_FORCE_TTY", "CLICOLOR_FORCE"]);
const ghQuiet = {
  GH_PROMPT_DISABLED: "1",
  GH_NO_UPDATE_NOTIFIER: "1",
  GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
  GH_TELEMETRY: "false",
  NO_COLOR: "1",
};
const gitLocale = { LC_ALL: "C" };
const outputLimit = 16 * 1024 * 1024;
const settleGraceMs = treeKillBoundMs + 1000;
const overrideSchema = z.tuple([z.string().min(1)], z.string().min(1));

function stopChild(child: ChildProcess, exited: Promise<void>): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") void endWindowsTree(pid);
  else void endUnixTree(pid, exited, forceKillGraceMs);
}

function without(env: Record<string, string>, keys: Set<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !keys.has(key.toUpperCase())));
}

function toolEnvironment(tool: Tool, env: Record<string, string>): Record<string, string> {
  if (tool === "git") return { ...without(env, gitDroppedKeys), ...gitLocale };
  if (tool === "gh") return { ...without(env, ghUnsafeKeys), ...ghQuiet };
  return env;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseToolOverride(
  variable: string,
  value: string | undefined,
): ResolvedCommand | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = overrideSchema.safeParse(parseJson(value));
  if (!parsed.success) {
    throw new Error(
      `${variable} must be a JSON array of strings, the executable then its leading arguments`,
    );
  }
  const [file, ...args] = parsed.data;
  return { file, args };
}

export async function resolveTool(tool: Tool): Promise<ResolvedCommand | undefined> {
  const variable = toolOverrideVariables[tool];
  let override: ResolvedCommand | undefined;
  try {
    override =
      variable === undefined ? undefined : parseToolOverride(variable, process.env[variable]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : `${tool} has a malformed override`);
    return undefined;
  }
  if (override !== undefined) return override;
  const file = await findExecutable(tool, await userEnvironment());
  return file === undefined ? undefined : { file, args: [] };
}

export async function childEnvironment(): Promise<Record<string, string>> {
  const environment = await userEnvironment();
  const kept = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !key.startsWith("ELECTRON_") && !appLaunchKeys.has(key),
    ),
  );
  const desktop = environment["ORIGINAL_XDG_CURRENT_DESKTOP"];
  if (desktop !== undefined) kept["XDG_CURRENT_DESKTOP"] = desktop;
  return kept;
}

export async function runTool(
  tool: Tool,
  args: readonly string[],
  options: { timeoutMs?: number } = {},
): Promise<ToolRun | undefined> {
  const command = await resolveTool(tool);
  if (command === undefined) return undefined;
  const env = toolEnvironment(tool, await childEnvironment());
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, [...command.args, ...args], {
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<void>((settle) =>
      child.once("exit", () => {
        settle();
      }),
    );
    const output = { stdout: "", stderr: "", size: 0 };
    let failure: Error | undefined;
    let abandon: NodeJS.Timeout | undefined;
    const stop = (reason: Error) => {
      if (failure !== undefined) return;
      failure = reason;
      stopChild(child, exited);
      abandon = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        reject(reason);
      }, settleGraceMs);
    };
    const timer = setTimeout(() => {
      stop(new Error(`${tool} did not finish in time`));
    }, options.timeoutMs ?? 30_000);
    const collect = (stream: "stdout" | "stderr") => (chunk: string) => {
      output.size += chunk.length;
      if (output.size > outputLimit) stop(new Error(`${tool} printed more than Satellite reads`));
      else output[stream] += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", collect("stdout"));
    child.stderr.setEncoding("utf8").on("data", collect("stderr"));
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") resolve(undefined);
      else reject(new Error(`${tool} did not start (${String(error.code)})`));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(abandon);
      if (failure !== undefined) reject(failure);
      else if (code !== null)
        resolve({ exitCode: code, stdout: output.stdout, stderr: output.stderr });
      else reject(new Error(`${tool} did not finish (${String(signal)})`));
    });
  });
}
