import { realpath } from "node:fs/promises";
import { isAbsolute, join, posix, relative, sep, win32 } from "node:path";

const windowsFullyQualified = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}[^\\/])/;
const windowsDevicePath = /^[\\/]{2}[?.](?:[\\/]|$)/;
const windowsNetworkPath = /^[\\/]{2}/;

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
  if (platform !== "win32") return posix.isAbsolute(path);
  return windowsFullyQualified.test(path) && !isDevicePath(path, platform);
}

export function isDevicePath(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && windowsDevicePath.test(path);
}

export function isNetworkPath(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && windowsNetworkPath.test(path);
}

export function comparablePath(path: string, platform: NodeJS.Platform = process.platform): string {
  const full = platform === "win32" ? win32.resolve(path) : posix.resolve(path);
  return platform === "win32" || platform === "darwin" ? full.toLowerCase() : full;
}

export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return comparablePath(a, platform) === comparablePath(b, platform);
}

export function isInsidePath(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const paths = platform === "win32" ? win32 : posix;
  const fromParent = paths.relative(
    comparablePath(parent, platform),
    comparablePath(child, platform),
  );
  return (
    fromParent !== ".." && !fromParent.startsWith(`..${paths.sep}`) && !paths.isAbsolute(fromParent)
  );
}
