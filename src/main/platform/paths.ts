import { realpath } from "node:fs/promises";
import { isAbsolute, join, posix, relative, sep, win32 } from "node:path";

const windowsFullyQualified = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}[^\\/])/;

async function realpathOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

export async function resolveInside(root: string, requested: string): Promise<string | undefined> {
  const realRoot = await realpathOrUndefined(root);
  const realCandidate = await realpathOrUndefined(join(root, requested));
  if (realRoot === undefined || realCandidate === undefined) return undefined;
  const fromRoot = relative(realRoot, realCandidate);
  const climbsOut = fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
  return climbsOut ? undefined : realCandidate;
}

export function isFullyQualified(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" ? windowsFullyQualified.test(path) : posix.isAbsolute(path);
}

export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const resolved = (path: string) => {
    const full = platform === "win32" ? win32.resolve(path) : posix.resolve(path);
    return platform === "win32" || platform === "darwin" ? full.toLowerCase() : full;
  };
  return resolved(a) === resolved(b);
}
