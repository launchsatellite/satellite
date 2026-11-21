import { lstat, opendir } from "node:fs/promises";
import { join, posix } from "node:path";
import { filesLimits, type FileEntry, type FolderListing } from "../../shared/bridge-contract.ts";
import {
  confinedFolder,
  isChangePath,
  markStuck,
  rootsWithStuckReads,
  sameFolder,
  withinTime,
} from "../changes/file-sides.ts";
import { errorCode, isMissing } from "../platform/file-system.ts";
import { gitReadMs } from "../workspaces/git-command.ts";
import { checkIgnored } from "./ignore-check.ts";

const lstatsAtOnce = 32;
const ignoreCheckMs = 2000;
const ignoreChunk = 5000;
const missing: FolderListing = { state: "missing" };
const unreadable: FolderListing = { state: "unreadable" };
const hung: FolderListing = { state: "hung" };

function isListable(name: string): boolean {
  return name.length <= filesLimits.nameChars && isChangePath(name);
}

async function holdsGit(folder: string): Promise<boolean> {
  return lstat(join(folder, ".git")).then(
    () => true,
    () => false,
  );
}

async function classify(folder: string, name: string): Promise<FileEntry | undefined> {
  const entry = await lstat(join(folder, name)).catch(() => undefined);
  if (entry === undefined) return undefined;
  if (entry.isSymbolicLink()) return { name, kind: "link", ignored: false };
  if (entry.isFile()) return { name, kind: "file", ignored: false };
  if (!entry.isDirectory()) return undefined;
  const kind = (await holdsGit(join(folder, name))) ? "repository" : "folder";
  return { name, kind, ignored: false };
}

async function scan(folder: string): Promise<{ names: string[]; dropped: number } | undefined> {
  const names: string[] = [];
  let seen = 0;
  let dropped = 0;
  for await (const entry of await opendir(folder)) {
    seen += 1;
    if (seen > filesLimits.folderScan) return undefined;
    if (isListable(entry.name)) names.push(entry.name);
    else if (entry.name !== ".git") dropped += 1;
  }
  return { names, dropped };
}

function checkedPath(folder: string, name: string): string {
  const path = folder === "" ? name : `${folder}/${name}`;
  return path.startsWith(":") ? `./${path}` : path;
}

async function classified(folder: string, names: string[]): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  for (let at = 0; at < names.length; at += lstatsAtOnce) {
    const batch = await Promise.all(
      names.slice(at, at + lstatsAtOnce).map((name) => classify(folder, name)),
    );
    for (const entry of batch) if (entry !== undefined) entries.push(entry);
  }
  return entries;
}

function order(a: FileEntry, b: FileEntry): number {
  const group = (entry: FileEntry) =>
    entry.kind === "folder" || entry.kind === "repository" ? 0 : 1;
  if (group(a) !== group(b)) return group(a) - group(b);
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

interface Prepared {
  folder: string;
  real: string;
  entries: FileEntry[];
  paths: string[];
  dropped: number;
}

async function prepare(root: string, folder: string): Promise<FolderListing | Prepared> {
  const parent = folder === "" ? "." : posix.dirname(folder);
  const parentReal = await confinedFolder(root, parent);
  if (typeof parentReal !== "string") {
    return parentReal.kind === "gone" ? missing : unreadable;
  }
  if (folder !== "") {
    const entry = await lstat(join(parentReal, posix.basename(folder))).catch(() => undefined);
    if (entry?.isSymbolicLink() === true) return unreadable;
    if (entry?.isDirectory() !== true) return missing;
  }
  const real = folder === "" ? parentReal : await confinedFolder(root, folder);
  if (typeof real !== "string") return real.kind === "gone" ? missing : unreadable;
  const scanned = await scan(real);
  if (scanned === undefined) return { state: "too-many" };
  const entries = await classified(real, scanned.names);
  const paths = entries.map((entry) => checkedPath(folder, entry.name));
  return { folder, real, entries, paths, dropped: scanned.dropped };
}

async function finish(
  root: string,
  { folder, real, entries, paths, dropped }: Prepared,
  ignored: ReadonlySet<string>,
): Promise<FolderListing> {
  const marked = entries.map((entry, at) => ({
    ...entry,
    ignored: ignored.has(paths[at] ?? ""),
  }));
  const again = await confinedFolder(root, folder === "" ? "." : folder);
  if (typeof again !== "string" || !sameFolder(again, real)) return unreadable;
  marked.sort(order);
  return {
    state: "listed",
    entries: marked.slice(0, filesLimits.folderEntries),
    more: Math.max(0, marked.length - filesLimits.folderEntries) + dropped,
  };
}

async function guarded<T>(root: string, work: () => Promise<T>): Promise<T | FolderListing> {
  const running = work().catch((error: unknown): FolderListing =>
    isMissing(error) || errorCode(error) === "ENOTDIR" ? missing : unreadable,
  );
  const result = await withinTime(running, gitReadMs);
  if (result !== undefined) return result;
  markStuck(root, running);
  return hung;
}

function isListing(result: FolderListing | Prepared): result is FolderListing {
  return "state" in result;
}

async function ignoredRuns(
  root: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<{ ignored: Set<string>; stopped: "failed" | "hung" | undefined }> {
  const ignored = new Set<string>();
  for (let at = 0; at < paths.length; at += ignoreChunk) {
    signal?.throwIfAborted();
    const check = await checkIgnored(
      root,
      paths.slice(at, at + ignoreChunk),
      signal,
      ignoreCheckMs,
    );
    if (check.kind !== "checked") return { ignored, stopped: check.kind };
    for (const path of check.ignored) ignored.add(path);
  }
  return { ignored, stopped: undefined };
}

async function ignoredAmong(
  root: string,
  groups: readonly (readonly string[])[],
  signal?: AbortSignal,
): Promise<Set<string>> {
  const all = await ignoredRuns(root, groups.flat(), signal);
  if (all.stopped !== "failed") return all.ignored;
  const ignored = new Set<string>();
  for (const group of groups) {
    const one = await ignoredRuns(root, group, signal);
    for (const path of one.ignored) ignored.add(path);
    if (one.stopped === "hung") break;
  }
  return ignored;
}

export async function listFolders(
  root: string,
  folders: readonly string[],
  signal?: AbortSignal,
): Promise<FolderListing[]> {
  const prepared: (FolderListing | Prepared)[] = [];
  for (const folder of folders) {
    signal?.throwIfAborted();
    if (folder !== "" && !isChangePath(folder)) prepared.push(unreadable);
    else if (rootsWithStuckReads.has(root)) prepared.push(hung);
    else prepared.push(await guarded(root, () => prepare(root, folder)));
  }
  const ignored = await ignoredAmong(
    root,
    prepared.flatMap((result) => (isListing(result) ? [] : [result.paths])),
    signal,
  );
  const listings: FolderListing[] = [];
  for (const result of prepared) {
    if (isListing(result)) listings.push(result);
    else listings.push(await guarded(root, () => finish(root, result, ignored)));
  }
  return listings;
}
