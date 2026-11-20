import type { BigIntStats } from "node:fs";
import { lstat, opendir, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { errorCode, isLinkedFolder } from "../platform/file-system.ts";

export interface LinkBounds {
  entries: number;
  depth: number;
  deadline: number;
}
export type Unchecked = "unreadable" | "limits";
export interface FoundLinks {
  links: string[];
  mount: string | null;
  unchecked: Unchecked | null;
}
export type ReadEntry = (path: string) => Promise<BigIntStats>;
type Kind = "link" | "folder" | "mount" | "other" | "gone" | "unreadable";

export const linkWalkLimits = { entries: 1_000_000, depth: 256, ms: 60_000 };

function readEntry(path: string): Promise<BigIntStats> {
  return lstat(path, { bigint: true });
}

async function kindOf(path: string, device: bigint | null, read: ReadEntry): Promise<Kind> {
  try {
    const entry = await read(path);
    if (entry.isSymbolicLink()) return "link";
    if (!entry.isDirectory()) return "other";
    if (await isLinkedFolder(path)) return "link";
    return device !== null && entry.dev !== device ? "mount" : "folder";
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "gone" : "unreadable";
  }
}

export async function findLinks(
  root: string,
  bounds: LinkBounds,
  read: ReadEntry = readEntry,
): Promise<FoundLinks> {
  const links: string[] = [];
  let device: bigint;
  try {
    device = (await read(root)).dev;
  } catch {
    return { links, mount: null, unchecked: "unreadable" };
  }
  const folders = [{ path: root, depth: 0 }];
  let entries = 0;
  let unchecked: Unchecked | null = null;
  let mount: string | null = null;
  walk: for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    try {
      for await (const entry of await opendir(folder.path)) {
        entries += 1;
        if (entries > bounds.entries || Date.now() > bounds.deadline) {
          unchecked = "limits";
          break walk;
        }
        if (entry.isFile()) continue;
        const path = join(folder.path, entry.name);
        const kind = entry.isSymbolicLink() ? "link" : await kindOf(path, device, read);
        if (kind === "link") links.push(path);
        else if (kind === "mount") {
          mount = path;
          break walk;
        } else if (kind === "unreadable") unchecked ??= "unreadable";
        else if (kind === "folder" && folder.depth + 1 > bounds.depth) unchecked = "limits";
        else if (kind === "folder") folders.push({ path, depth: folder.depth + 1 });
      }
    } catch {
      unchecked ??= "unreadable";
    }
  }
  return { links, mount, unchecked };
}

export async function removeLink(path: string): Promise<boolean> {
  const kind = await kindOf(path, null, readEntry);
  if (kind !== "link") return kind === "gone" || kind === "other";
  try {
    await unlink(path);
  } catch {
    await rmdir(path).catch(() => undefined);
  }
  return (await kindOf(path, null, readEntry)) === "gone";
}
