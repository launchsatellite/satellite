import { execFile } from "node:child_process";
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

const overrideSchema = z.tuple([z.string().min(1)], z.string().min(1));

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
    execFile(
      command.file,
      [...command.args, ...args],
      {
        cwd: options.cwd,
        env,
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error === null) resolve({ exitCode: 0, stdout, stderr });
        else if (typeof error.code === "number") resolve({ exitCode: error.code, stdout, stderr });
        else if (error.code === "ENOENT") resolve(undefined);
        else reject(new Error(`${tool} did not finish`, { cause: error }));
      },
    );
  });
}
