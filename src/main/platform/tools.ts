import { execFile, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { findExecutable } from "./executable-search.ts";
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

const forceKillGraceMs = 2000;
const overrideSchema = z.tuple([z.string().min(1)], z.string().min(1));

function stopChild(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    const taskkill = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
    execFile(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => undefined);
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, forceKillGraceMs).unref();
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
  const override =
    variable === undefined ? undefined : parseToolOverride(variable, process.env[variable]);
  if (override !== undefined) return override;
  const file = await findExecutable(tool, await userEnvironment());
  return file === undefined ? undefined : { file, args: [] };
}

export async function childEnvironment(): Promise<Record<string, string>> {
  const environment = await userEnvironment();
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith("ELECTRON_")),
  );
}

export async function runTool(
  tool: Tool,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ToolRun | undefined> {
  const command = await resolveTool(tool);
  if (command === undefined) return undefined;
  const env = await childEnvironment();
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const child = execFile(
      command.file,
      [...command.args, ...args],
      {
        cwd: options.cwd,
        env,
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        clearTimeout(timer);
        if (timedOut) reject(new Error(`${tool} did not finish in time`));
        else if (error === null) resolve({ exitCode: 0, stdout, stderr });
        else if (typeof error.code === "number") resolve({ exitCode: error.code, stdout, stderr });
        else if (error.code === "ENOENT") resolve(undefined);
        else reject(new Error(`${tool} did not finish (${String(error.code ?? error.signal)})`));
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      stopChild(child);
    }, options.timeoutMs ?? 30_000);
  });
}
