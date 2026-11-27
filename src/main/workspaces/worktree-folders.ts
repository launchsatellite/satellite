import { realpathSync } from "node:fs";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { reservedWorkspaceNames, workspaceNameProblem } from "../../shared/workspace-name.ts";
import { errorCode, isTooLongForCheckouts } from "../platform/file-system.ts";
import {
  isFullyQualified,
  isInsidePath,
  realpathOrUndefined,
  samePath,
} from "../platform/paths.ts";

type PreparedFolder = { ok: true; path: string; segment: string } | { ok: false; refusal: string };

const segmentLimit = 48;
const plainFolderRefusal =
  "Satellite's worktrees folder isn't a plain folder, so it won't make a workspace there.";

function trimEdges(segment: string): string {
  return segment.replace(/^[.-]+/, "").replace(/[.-]+$/, "");
}

async function isPlainFolder(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

async function makePlainFolder(path: string): Promise<boolean> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  return isPlainFolder(path);
}

export function worktreesRoot(home: string): string {
  return join(home, "worktrees");
}

export function projectSegment(projectRoot: string): string {
  const safe = trimEdges(
    basename(projectRoot)
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/-+/g, "-"),
  );
  const segment = trimEdges(safe.slice(0, segmentLimit)) || "project";
  const stem = segment.split(".")[0] ?? segment;
  if (!reservedWorkspaceNames.has(stem.toLowerCase())) return segment;
  return `${stem}-project${segment.slice(stem.length)}`;
}

export async function prepareWorktreeFolder(
  home: string,
  projectRoot: string,
  name: string,
): Promise<PreparedFolder> {
  const problem = workspaceNameProblem(name);
  if (problem !== null) return { ok: false, refusal: problem };
  const segment = projectSegment(projectRoot);
  const root = worktreesRoot(home);
  const segmentFolder = join(root, segment);
  if (!(await makePlainFolder(root)) || !(await makePlainFolder(segmentFolder))) {
    return { ok: false, refusal: plainFolderRefusal };
  }
  const realHome = await realpath(home);
  const realSegment = await realpathOrUndefined(segmentFolder);
  if (realSegment === undefined || !samePath(realSegment, join(worktreesRoot(realHome), segment))) {
    return { ok: false, refusal: plainFolderRefusal };
  }
  const path = join(realSegment, name);
  const entries = await readdir(realSegment);
  if (entries.some((entry) => samePath(join(realSegment, entry), path))) {
    return {
      ok: false,
      refusal: `A folder named ${name} is already in Satellite's worktrees for ${segment}. Pick another name.`,
    };
  }
  if (isTooLongForCheckouts(path)) {
    return {
      ok: false,
      refusal: "That workspace's folder would be too long for Windows. Pick a shorter name.",
    };
  }
  return { ok: true, path, segment };
}

export async function isWorktreeFolder(home: string, path: string): Promise<boolean> {
  if (!isFullyQualified(path) || !(await isPlainFolder(path))) return false;
  const realHome = await realpathOrUndefined(home);
  const realFolder = await realpathOrUndefined(path);
  if (realHome === undefined || realFolder === undefined) return false;
  const realRoot = worktreesRoot(realHome);
  return (
    samePath(realFolder, path) &&
    samePath(dirname(dirname(realFolder)), realRoot) &&
    isInsidePath(realRoot, realFolder)
  );
}

export async function isOutsideFolder(home: string, path: string): Promise<boolean> {
  if (!isFullyQualified(path) || !(await isPlainFolder(path))) return false;
  const realHome = await realpathOrUndefined(home);
  const realFolder = await realpathOrUndefined(path);
  if (realHome === undefined || realFolder === undefined) return false;
  const root = worktreesRoot(realHome);
  const grandparent = dirname(dirname(realFolder));
  const insideWorkspace = isInsidePath(root, grandparent) && !samePath(root, grandparent);
  return (
    samePath(realFolder, path) &&
    !samePath(realHome, realFolder) &&
    !isInsidePath(realFolder, realHome) &&
    (!isInsidePath(realHome, realFolder) || insideWorkspace)
  );
}

export function isOwnShaped(root: string, path: string): boolean {
  return samePath(dirname(dirname(path)), root);
}

export function isOutsidePath(home: string, path: string): boolean {
  let realHome: string;
  try {
    realHome = realpathSync.native(home);
  } catch {
    realHome = home;
  }
  return [home, realHome].every((form) => !isOwnShaped(worktreesRoot(form), path));
}

export function ownCount(home: string, workspaces: readonly { path: string }[]): number {
  return workspaces.filter((workspace) => !isOutsidePath(home, workspace.path)).length;
}
