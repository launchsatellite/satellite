import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { z } from "zod";
import { findExecutable } from "./executable-search.ts";
import { isFullyQualified, samePath } from "./paths.ts";
import { endUnixTree, endWindowsTree, forceKillGraceMs, treeKillBoundMs } from "./process-tree.ts";
import { userEnvironment } from "./user-environment.ts";

export type Tool = "git" | "gh" | "claude";
export type GitVariable = (typeof gitVariables)[number];
export type StopReason = "time" | "stopped" | "output";
export interface ResolvedCommand {
  readonly file: string;
  readonly args: readonly string[];
}
export interface ToolRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class AbandonedRun extends Error {
  readonly exited: Promise<void>;
  constructor(message: string, exited: Promise<void>) {
    super(message);
    this.exited = exited;
  }
}

export class ToolStopped extends Error {
  readonly reason: StopReason;
  constructor(message: string, reason: StopReason) {
    super(message);
    this.reason = reason;
  }
}

export const toolOverrideVariables: Readonly<Partial<Record<Tool, string>>> = {
  git: "SATELLITE_GIT",
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
  "GIT_ASKPASS",
  "SSH_ASKPASS",
]);
const ghUnsafeKeys = new Set(["GH_DEBUG", "DEBUG", "GH_FORCE_TTY", "CLICOLOR_FORCE"]);
const ghQuiet = {
  GH_PROMPT_DISABLED: "1",
  GH_NO_UPDATE_NOTIFIER: "1",
  GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
  GH_TELEMETRY: "false",
  NO_COLOR: "1",
};
const gitQuiet = {
  LC_ALL: "C",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "false",
  SSH_ASKPASS_REQUIRE: "never",
};
const gitVariables = [
  "GIT_NO_LAZY_FETCH",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
] as const;
const gitReplacedKeys = new Set([...gitDroppedKeys, ...Object.keys(gitQuiet)]);
const ghReplacedKeys = new Set([...ghUnsafeKeys, ...Object.keys(ghQuiet)]);
const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
const noProxyKeys = ["NO_PROXY", "no_proxy"];
const claudeHostKeys = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_EFFORT",
  "CLAUDE_JOB_DIR",
  "CLAUDE_PID",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_CHILD_NOTES_DIR",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
  "ITERM_SESSION_ID",
  "LC_TERMINAL",
  "KITTY_WINDOW_ID",
  "KITTY_PID",
  "KITTY_LISTEN_ON",
  "KITTY_PUBLIC_KEY",
  "WT_SESSION",
  "TMUX",
  "TMUX_PANE",
  "STY",
]);
const editorPrefix = "VSCODE_";
const loopback = "127.0.0.1";
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

function withLoopback(list: string | undefined): string {
  if (list === undefined || list === "") return loopback;
  return list.split(/[\s,]+/).includes(loopback) ? list : `${list},${loopback}`;
}

function isEditorAskpass(env: Record<string, string>, platform: NodeJS.Platform): boolean {
  const askpass = env["GIT_ASKPASS"];
  const editorHelper = env[`${editorPrefix}GIT_ASKPASS_MAIN`];
  if (askpass === undefined || editorHelper === undefined) return false;
  const paths = platform === "win32" ? win32 : posix;
  return samePath(paths.dirname(askpass), paths.dirname(editorHelper), platform);
}

async function isMissingFile(file: string): Promise<boolean> {
  if (!isFullyQualified(file)) return false;
  return stat(file).then(
    (stats) => !stats.isFile(),
    () => true,
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function toolEnvironment(tool: Tool, env: Record<string, string>): Record<string, string> {
  if (tool === "git") return { ...without(env, gitReplacedKeys), ...gitQuiet };
  if (tool === "gh") return { ...without(env, ghReplacedKeys), ...ghQuiet };
  return env;
}

export function claudeEnvironment(
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const nameOf = (key: string) => (platform === "win32" ? key.toUpperCase() : key);
  const kept = Object.fromEntries(
    Object.entries(env).filter(([key]) => {
      const name = nameOf(key);
      return !claudeHostKeys.has(name) && !name.startsWith(editorPrefix);
    }),
  );
  if (isEditorAskpass(env, platform)) delete kept["GIT_ASKPASS"];
  if (!proxyKeys.some((key) => (env[key] ?? "") !== "")) return kept;
  for (const key of noProxyKeys) kept[key] = withLoopback(env[key]);
  return kept;
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
  if (override !== undefined) return (await isMissingFile(override.file)) ? undefined : override;
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
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    gitVariables?: Readonly<Partial<Record<GitVariable, string>>>;
    bytes?: boolean;
    input?: string;
  } = {},
): Promise<ToolRun | undefined> {
  const command = await resolveTool(tool);
  if (command === undefined) return undefined;
  const env = toolEnvironment(tool, await childEnvironment());
  for (const name of tool === "git" ? gitVariables : []) {
    const value = options.gitVariables?.[name];
    if (value !== undefined) env[name] = value;
  }
  return new Promise((resolve, reject) => {
    const launch = {
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
    };
    const child =
      options.input === undefined
        ? spawn(command.file, [...command.args, ...args], {
            ...launch,
            stdio: ["ignore", "pipe", "pipe"],
          })
        : spawn(command.file, [...command.args, ...args], {
            ...launch,
            stdio: ["pipe", "pipe", "pipe"],
          });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(options.input);
    const exited = new Promise<void>((settle) =>
      child.once("exit", () => {
        settle();
      }),
    );
    const output = { stdout: "", stderr: "", size: 0 };
    let failure: ToolStopped | undefined;
    let abandon: NodeJS.Timeout | undefined;
    const stop = (reason: ToolStopped) => {
      if (failure !== undefined) return;
      failure = reason;
      stopChild(child, exited);
      abandon = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        reject(new AbandonedRun(reason.message, exited));
      }, settleGraceMs);
    };
    const timer = setTimeout(() => {
      stop(new ToolStopped(`${tool} did not finish in time`, "time"));
    }, options.timeoutMs ?? 30_000);
    const abort = () => {
      stop(new ToolStopped(`${tool} was stopped`, "stopped"));
    };
    if (options.signal?.aborted === true) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const settle = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    const collect = (stream: "stdout" | "stderr") => (chunk: string) => {
      output.size += chunk.length;
      if (output.size > outputLimit) {
        stop(new ToolStopped(`${tool} printed more than Satellite reads`, "output"));
      } else output[stream] += chunk;
    };
    child.stdout
      .setEncoding(options.bytes === true ? "latin1" : "utf8")
      .on("data", collect("stdout"));
    child.stderr.setEncoding("utf8").on("data", collect("stderr"));
    child.once("error", (error: NodeJS.ErrnoException) => {
      settle();
      if (error.code === "ENOENT") resolve(undefined);
      else reject(new Error(`${tool} did not start (${String(error.code)})`));
    });
    child.once("close", (code, signal) => {
      settle();
      clearTimeout(abandon);
      if (failure !== undefined) reject(failure);
      else if (code !== null)
        resolve({ exitCode: code, stdout: output.stdout, stderr: output.stderr });
      else reject(new Error(`${tool} did not finish (${String(signal)})`));
    });
  });
}
