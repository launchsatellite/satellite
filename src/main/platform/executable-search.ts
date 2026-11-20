import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";

function windowsPathValue(env: Record<string, string | undefined>): string | undefined {
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path");
  return key === undefined ? undefined : env[key];
}

async function isRunnableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function executableCandidates(
  name: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  const windows = platform === "win32";
  const paths = windows ? win32 : posix;
  const searchPath = (windows ? windowsPathValue(env) : env["PATH"]) ?? "";
  const fileNames = windows ? [`${name}.exe`, `${name}.com`] : [name];
  return searchPath
    .split(windows ? ";" : ":")
    .filter((folder) => folder !== "" && paths.isAbsolute(folder))
    .flatMap((folder) => fileNames.map((fileName) => paths.join(folder, fileName)));
}

export async function findExecutable(
  name: string,
  env: Record<string, string | undefined>,
): Promise<string | undefined> {
  for (const candidate of executableCandidates(name, process.platform, env)) {
    if (await isRunnableFile(candidate)) return candidate;
  }
  return undefined;
}
