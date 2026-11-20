import { constants } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { reservedWorkspaceNames } from "../../shared/workspace-name.ts";
import { samePath } from "./paths.ts";

export interface FolderIdentity {
  dev: bigint;
  ino: bigint;
}

const windowsPathLimit = 150;

export const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
export const nonBlocking = "O_NONBLOCK" in constants ? constants.O_NONBLOCK : 0;
export const noTerminal = "O_NOCTTY" in constants ? constants.O_NOCTTY : 0;

export function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

export function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

export async function folderIdentity(path: string): Promise<FolderIdentity | undefined> {
  try {
    const entry = await lstat(path, { bigint: true });
    return entry.isDirectory() ? { dev: entry.dev, ino: entry.ino } : undefined;
  } catch {
    return undefined;
  }
}

export function sameIdentity(a: FolderIdentity | undefined, b: FolderIdentity): boolean {
  return a?.dev === b.dev && a.ino === b.ino;
}

export function isSafeFileName(name: string, platform: NodeJS.Platform = process.platform) {
  if (name === "" || name === "." || name === "..") return false;
  if (name.includes("\\") || name.includes("\0")) return false;
  if (platform !== "win32") return true;
  const stem = (name.split(".")[0] ?? "").toLowerCase();
  return !name.includes(":") && !/[. ]$/.test(name) && !reservedWorkspaceNames.has(stem);
}

export function isTooLongForCheckouts(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && path.length > windowsPathLimit;
}

export async function isLinkedFolder(path: string): Promise<boolean> {
  return process.platform === "win32" && !samePath(await realpath(path), path);
}
