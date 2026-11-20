import { lstat, opendir, realpath, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { samePath } from "../platform/paths.ts";

export interface LinkBounds {
  entries: number;
  depth: number;
  deadline: number;
}
export interface FoundLinks {
  links: string[];
  complete: boolean;
}
type Kind = "link" | "folder" | "other" | "gone" | "unreadable";

export const linkWalkLimits = { entries: 1_000_000, depth: 256, ms: 60_000 };

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

async function kindOf(path: string): Promise<Kind> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) return "link";
    if (!entry.isDirectory()) return "other";
    if (process.platform === "win32" && !samePath(await realpath(path), path)) return "link";
    return "folder";
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "gone" : "unreadable";
  }
}

export async function findLinks(root: string, bounds: LinkBounds): Promise<FoundLinks> {
  const links: string[] = [];
  const folders = [{ path: root, depth: 0 }];
  let entries = 0;
  let complete = true;
  while (complete) {
    const folder = folders.pop();
    if (folder === undefined) break;
    let dir;
    try {
      dir = await opendir(folder.path);
    } catch {
      complete = false;
      break;
    }
    for await (const entry of dir) {
      entries += 1;
      if (entries > bounds.entries || Date.now() > bounds.deadline) {
        complete = false;
        break;
      }
      if (entry.isFile()) continue;
      const path = join(folder.path, entry.name);
      const kind = entry.isSymbolicLink() ? "link" : await kindOf(path);
      if (kind === "link") links.push(path);
      else if (kind === "unreadable") complete = false;
      else if (kind === "folder" && folder.depth + 1 > bounds.depth) complete = false;
      else if (kind === "folder") folders.push({ path, depth: folder.depth + 1 });
      if (!complete) break;
    }
  }
  return { links, complete };
}

export async function removeLink(path: string): Promise<boolean> {
  const kind = await kindOf(path);
  if (kind !== "link") return kind === "gone" || kind === "other";
  try {
    await unlink(path);
  } catch {
    await rmdir(path).catch(() => undefined);
  }
  return (await kindOf(path)) === "gone";
}
