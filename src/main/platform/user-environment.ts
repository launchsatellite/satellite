import { execFile } from "node:child_process";
import { userInfo } from "node:os";

const marker = "__SATELLITE_ENV__";
const droppedKeys = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

let loginEnvironment: Promise<Record<string, string>> | undefined;

function definedEntries(env: Record<string, string | undefined>): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) entries[key] = value;
  }
  return entries;
}

function loginShell(): string {
  const fromEnvironment = process.env["SHELL"];
  if (fromEnvironment !== undefined && fromEnvironment !== "") return fromEnvironment;
  try {
    return userInfo().shell ?? "/bin/sh";
  } catch {
    return "/bin/sh";
  }
}

function readLoginEnvironment(): Promise<Record<string, string>> {
  const inherited = definedEntries(process.env);
  return new Promise((resolve) => {
    const shell = execFile(
      loginShell(),
      ["-i", "-l", "-c", `printf ${marker}; command env -0; printf ${marker}`],
      { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const parsed = error === null ? parseEnvironmentBlock(stdout) : undefined;
        resolve(parsed === undefined ? inherited : { ...inherited, ...parsed });
      },
    );
    shell.stdin?.end();
  });
}

export function parseEnvironmentBlock(output: string): Record<string, string> | undefined {
  const start = output.indexOf(marker);
  const end = output.lastIndexOf(marker);
  if (start === -1 || end <= start) return undefined;
  const environment: Record<string, string> = {};
  for (const entry of output.slice(start + marker.length, end).split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator);
    if (!droppedKeys.has(key)) environment[key] = entry.slice(separator + 1);
  }
  return environment;
}

export function userEnvironment(): Promise<Record<string, string>> {
  if (process.platform === "win32") return Promise.resolve(definedEntries(process.env));
  loginEnvironment ??= readLoginEnvironment();
  return loginEnvironment;
}
