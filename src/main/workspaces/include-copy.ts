import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { type FileHandle, lstat, mkdir, open, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isSafeFileName, noFollow, nonBlocking, noTerminal } from "../platform/file-system.ts";
import { isInsidePath } from "../platform/paths.ts";
import type { IncludeMatcher } from "./worktree-include.ts";

export interface IncludeSelection {
  files: string[];
  links: number;
}

export interface CopyLimit {
  deadline: number;
  signal: AbortSignal;
}

type Overflow = "too-many" | "too-large" | "too-slow";

interface Collection {
  limit: CopyLimit;
  visited: number;
  files: string[];
  bytes: number;
  links: number;
}

const entryLimit = 100_000;
const fileLimit = 10_000;
const byteLimit = 1_073_741_824;
const chunkBytes = 1_048_576;
const changedUnderfootCodes = new Set([
  "EEXIST",
  "ELOOP",
  "EMLINK",
  "ENAMETOOLONG",
  "ENOENT",
  "ENOTDIR",
]);
const unreadableCodes = new Set([...changedUnderfootCodes, "EACCES", "EPERM"]);
const readFlags = constants.O_RDONLY | noFollow | nonBlocking | noTerminal;
const createFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow;

async function unless<T>(
  codes: ReadonlySet<string>,
  work: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && "code" in error && codes.has(String(error.code))) {
      return undefined;
    }
    throw error;
  }
}

async function unlessChanged<T>(work: () => Promise<T>): Promise<T | undefined> {
  return unless(changedUnderfootCodes, work);
}

async function unlessUnreadable<T>(work: () => Promise<T>): Promise<T | undefined> {
  return unless(unreadableCodes, work);
}

function isStopped(limit: CopyLimit): boolean {
  return limit.signal.aborted || Date.now() > limit.deadline;
}

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function safeSegments(path: string): string[] | undefined {
  const segments = path.split("/");
  return segments.every((segment) => isSafeFileName(segment)) ? segments : undefined;
}

async function keepFile(
  root: string,
  relative: string,
  collection: Collection,
): Promise<Overflow | undefined> {
  const entry = await unlessUnreadable(() => lstat(join(root, relative)));
  if (entry === undefined) return undefined;
  if (entry.isSymbolicLink()) collection.links += 1;
  if (!entry.isFile()) return undefined;
  collection.files.push(relative);
  collection.bytes += entry.size;
  if (collection.files.length > fileLimit) return "too-many";
  return collection.bytes > byteLimit ? "too-large" : undefined;
}

async function walkFolder(
  root: string,
  start: string,
  whole: boolean,
  matcher: IncludeMatcher,
  collection: Collection,
): Promise<Overflow | undefined> {
  const pending = [{ folder: start, whole }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { folder } = next;
    const folderWhole = next.whole;
    const entries = await unlessUnreadable(() => opendir(join(root, folder)));
    if (entries === undefined) continue;
    for await (const entry of entries) {
      collection.visited += 1;
      if (collection.visited > entryLimit) return "too-many";
      if (isStopped(collection.limit)) return "too-slow";
      if (!isSafeFileName(entry.name)) continue;
      const child = `${folder}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        collection.links += 1;
      } else if (entry.isDirectory()) {
        const childWhole = folderWhole || matcher.matches(child, true);
        if (childWhole || matcher.reaches(child))
          pending.push({ folder: child, whole: childWhole });
      } else if (entry.isFile() && (folderWhole || matcher.matches(child, false))) {
        const overflow = await keepFile(root, child, collection);
        if (overflow !== undefined) return overflow;
      }
    }
  }
  return undefined;
}

async function collectFolder(
  root: string,
  relative: string,
  matcher: IncludeMatcher,
  collection: Collection,
): Promise<Overflow | undefined> {
  const whole = matcher.matches(relative, true);
  if (!whole && !matcher.reaches(relative)) return undefined;
  const entry = await unlessUnreadable(() => lstat(join(root, relative)));
  if (entry?.isSymbolicLink() === true) collection.links += 1;
  if (entry?.isDirectory() !== true) return undefined;
  return walkFolder(root, relative, whole, matcher, collection);
}

async function isPlainFolder(path: string): Promise<boolean> {
  const entry = await unlessChanged(() => lstat(path));
  return entry !== undefined && entry.isDirectory() && !entry.isSymbolicLink();
}

async function parentsArePlain(base: string, segments: readonly string[]): Promise<boolean> {
  for (let length = 1; length < segments.length; length += 1) {
    if (!(await isPlainFolder(join(base, ...segments.slice(0, length))))) return false;
  }
  return true;
}

async function makePlainParents(base: string, segments: readonly string[]): Promise<boolean> {
  for (let length = 1; length < segments.length; length += 1) {
    const folder = join(base, ...segments.slice(0, length));
    await unlessChanged(() => mkdir(folder));
    if (!(await isPlainFolder(folder))) return false;
  }
  return true;
}

async function copyBytes(
  source: FileHandle,
  destination: FileHandle,
  size: number,
  limit: CopyLimit,
): Promise<boolean> {
  const buffer = Buffer.alloc(Math.min(size, chunkBytes));
  let position = 0;
  while (position < size) {
    if (isStopped(limit)) return false;
    const { bytesRead } = await source.read(
      buffer,
      0,
      Math.min(buffer.length, size - position),
      position,
    );
    if (bytesRead === 0)
      throw new Error("a file .worktreeinclude names shrank while it was copied");
    let written = 0;
    while (written < bytesRead) {
      written += (await destination.write(buffer, written, bytesRead - written)).bytesWritten;
    }
    position += bytesRead;
  }
  return true;
}

async function opensWhatWasChecked(
  source: FileHandle,
  sourcePath: string,
  realRoot: string,
  checked: BigIntStats,
): Promise<BigIntStats | undefined> {
  const opened = await source.stat({ bigint: true });
  if (!opened.isFile() || !sameFile(opened, checked)) return undefined;
  const resolved = await unlessChanged(() => realpath(sourcePath));
  if (resolved === undefined || !isInsidePath(realRoot, resolved)) return undefined;
  const now = await unlessChanged(() => lstat(resolved, { bigint: true }));
  return now?.isFile() === true && sameFile(now, opened) ? opened : undefined;
}

async function copyOne(
  paths: { root: string; realRoot: string; worktree: string },
  relative: string,
  room: number,
  limit: CopyLimit,
): Promise<number | undefined | "too-slow"> {
  const segments = safeSegments(relative);
  if (segments === undefined || !(await parentsArePlain(paths.root, segments))) return undefined;
  const sourcePath = join(paths.root, ...segments);
  const checked = await unlessChanged(() => lstat(sourcePath, { bigint: true }));
  if (checked?.isFile() !== true) return undefined;
  const source = await unlessChanged(() => open(sourcePath, readFlags));
  if (source === undefined) return undefined;
  try {
    const opened = await opensWhatWasChecked(source, sourcePath, paths.realRoot, checked);
    if (opened === undefined || opened.size > BigInt(room)) return undefined;
    const size = Number(opened.size);
    if (!(await makePlainParents(paths.worktree, segments))) return undefined;
    const destinationPath = join(paths.worktree, ...segments);
    const destination = await unlessChanged(() =>
      open(destinationPath, createFlags, Number(opened.mode) & 0o777),
    );
    if (destination === undefined) return undefined;
    try {
      if (!(await copyBytes(source, destination, size, limit))) return "too-slow";
    } finally {
      await destination.close();
    }
    return size;
  } finally {
    await source.close();
  }
}

export async function collectIncludedFiles(
  root: string,
  ignored: readonly string[],
  matcher: IncludeMatcher,
  limit: CopyLimit,
): Promise<IncludeSelection | Overflow> {
  const collection: Collection = { limit, visited: 0, files: [], bytes: 0, links: 0 };
  for (const entry of ignored) {
    collection.visited += 1;
    if (collection.visited > entryLimit) return "too-many";
    if (isStopped(limit)) return "too-slow";
    const isFolder = entry.endsWith("/");
    const relative = isFolder ? entry.slice(0, -1) : entry;
    if (safeSegments(relative) === undefined) continue;
    const overflow = isFolder
      ? await collectFolder(root, relative, matcher, collection)
      : matcher.matches(relative, false)
        ? await keepFile(root, relative, collection)
        : undefined;
    if (overflow !== undefined) return overflow;
  }
  return { files: collection.files, links: collection.links };
}

export async function copyIncludedFiles(
  root: string,
  worktree: string,
  files: readonly string[],
  limit: CopyLimit,
): Promise<{ copied: number; skipped: number } | "too-slow"> {
  const paths = { root, realRoot: await realpath(root), worktree };
  let copied = 0;
  let bytes = 0;
  for (const relative of files) {
    if (isStopped(limit)) return "too-slow";
    const size = await copyOne(paths, relative, byteLimit - bytes, limit);
    if (size === "too-slow") return size;
    if (size === undefined) continue;
    copied += 1;
    bytes += size;
  }
  return { copied, skipped: files.length - copied };
}
