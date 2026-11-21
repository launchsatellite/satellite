import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { changesLimits } from "../../shared/bridge-contract.ts";
import {
  isMissing,
  isSafeFileName,
  noFollow,
  nonBlocking,
  noTerminal,
} from "../platform/file-system.ts";
import { realpathOrUndefined, samePath } from "../platform/paths.ts";
import { gitReadMs, readGit, type GitStop } from "../workspaces/git-command.ts";

export type SideRead =
  | { kind: "text"; text: string }
  | { kind: "binary" }
  | { kind: "large" }
  | { kind: "changing" }
  | { kind: "hung" }
  | { kind: "gone" }
  | { kind: "not-local" }
  | { kind: "unreadable" }
  | { kind: "refused" };
type FolderKind = "plain" | "missing" | "other";

export const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const noLazyFetch = { GIT_NO_LAZY_FETCH: "1" };

const readFlags = constants.O_RDONLY | noFollow | nonBlocking | noTerminal;
const drivePrefix = /^[A-Za-z]:/;
const ignorableInNames = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g;
const windowsShortName = /~\d/;
const allZeros = /^0+$/;
const sizeOutput = /^(\d{1,16})\n$/;
const gone: SideRead = { kind: "gone" };
const refused: SideRead = { kind: "refused" };
const large: SideRead = { kind: "large" };
const binary: SideRead = { kind: "binary" };
const changing: SideRead = { kind: "changing" };
const hung: SideRead = { kind: "hung" };
const notLocal: SideRead = { kind: "not-local" };
const unreadable: SideRead = { kind: "unreadable" };
const lineFeed = 10;
const carriageReturn = 13;
const rootsWithStuckReads = new Set<string>();
const objectLengths = new Map<string, number>();
const objectFormatLengths = new Map([
  ["sha1\n", 40],
  ["sha256\n", 64],
]);

function isChangeSegment(segment: string, platform: NodeJS.Platform): boolean {
  if (!isSafeFileName(segment, platform)) return false;
  if (segment.replace(ignorableInNames, "").toLowerCase() === ".git") return false;
  return platform !== "win32" || !windowsShortName.test(segment);
}

function sameFolder(a: string, b: string): boolean {
  if (process.platform !== "darwin") return samePath(a, b);
  return samePath(a.normalize("NFC"), b.normalize("NFC"));
}

function sameVersion(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

function decodedText(bytes: Uint8Array): SideRead {
  if (looksBinary(bytes)) return binary;
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return lineCount(text) > changesLimits.sideLines ? large : { kind: "text", text };
}

async function folderPathKind(
  realRoot: string,
  parent: string,
  checked: Map<string, FolderKind>,
): Promise<FolderKind> {
  if (parent === ".") return "plain";
  let folder = "";
  for (const segment of parent.split("/")) {
    folder = folder === "" ? segment : `${folder}/${segment}`;
    const known = checked.get(folder);
    if (known === "plain") continue;
    if (known !== undefined) return known;
    const kind = await lstat(join(realRoot, folder)).then(
      (entry) => (entry.isDirectory() ? "plain" : "other"),
      (error: unknown) => (isMissing(error) ? "missing" : "other"),
    );
    checked.set(folder, kind);
    if (kind !== "plain") return kind;
  }
  return "plain";
}

async function confinedFolder(root: string, parent: string): Promise<string | SideRead> {
  const realRoot = await realpathOrUndefined(root);
  if (realRoot === undefined) return gone;
  const kind = await folderPathKind(realRoot, parent, new Map());
  if (kind !== "plain") return kind === "missing" ? gone : refused;
  const expected = join(realRoot, parent);
  const realParent = await realpathOrUndefined(expected);
  if (realParent === undefined) return gone;
  return sameFolder(realParent, expected) ? realParent : refused;
}

async function linkSide(file: string): Promise<SideRead> {
  const target = await readlink(file);
  return target.length > changesLimits.linkChars ? large : { kind: "text", text: target };
}

async function openedSide(file: string, entry: BigIntStats): Promise<SideRead> {
  const handle = await open(file, readFlags);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameVersion(opened, entry)) return changing;
    const size = Number(entry.size);
    const buffer = new Uint8Array(size + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (filled !== size || !sameVersion(after, entry)) return changing;
    return decodedText(buffer.subarray(0, size));
  } finally {
    await handle.close();
  }
}

async function withinTime<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((settle) => {
    timer = setTimeout(() => {
      settle(undefined);
    }, ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function confinedSide(root: string, path: string, bytes: number): Promise<SideRead> {
  const parent = posix.dirname(path);
  const folder = await confinedFolder(root, parent);
  if (typeof folder !== "string") return folder;
  const file = join(folder, posix.basename(path));
  const entry = await lstat(file, { bigint: true });
  if (entry.isSymbolicLink()) return linkSide(file);
  if (!entry.isFile()) return binary;
  if (entry.size > BigInt(bytes)) return large;
  const read = await openedSide(file, entry);
  const recheck = await confinedFolder(root, parent);
  if (typeof recheck !== "string") return recheck;
  return sameFolder(recheck, folder) ? read : refused;
}

async function fileStamp(
  realRoot: string | undefined,
  path: string,
  checked: Map<string, FolderKind>,
): Promise<string> {
  if (realRoot === undefined || !isChangePath(path)) return "gone";
  if ((await folderPathKind(realRoot, posix.dirname(path), checked)) !== "plain") return "gone";
  try {
    const entry = await lstat(join(realRoot, path), { bigint: true });
    return `${String(entry.size)}:${String(entry.mtimeNs)}`;
  } catch {
    return "gone";
  }
}

function markStuck(root: string, work: Promise<unknown>): void {
  rootsWithStuckReads.add(root);
  const release = () => {
    rootsWithStuckReads.delete(root);
  };
  void work.then(release, release);
}

async function gitOutput(
  folder: string,
  args: string[],
  signal?: AbortSignal,
  bytes = false,
): Promise<{ stdout: string } | GitStop | undefined> {
  const run = await readGit(folder, args, gitReadMs, signal, { gitVariables: noLazyFetch, bytes });
  if (typeof run === "string") return run;
  return run.exitCode === 0 ? run : undefined;
}

function isHung(output: Awaited<ReturnType<typeof gitOutput>>): boolean {
  return output === "time" || output === "stuck";
}

function stdoutOf(output: Awaited<ReturnType<typeof gitOutput>>): string | undefined {
  return typeof output === "object" ? output.stdout : undefined;
}

async function objectLength(folder: string, signal?: AbortSignal) {
  const known = objectLengths.get(folder);
  if (known !== undefined) return known;
  const format = stdoutOf(await gitOutput(folder, ["rev-parse", "--show-object-format"], signal));
  const length = format === undefined ? undefined : objectFormatLengths.get(format);
  if (length !== undefined) objectLengths.set(folder, length);
  return length;
}

export function isChangePath(path: string, platform: NodeJS.Platform = process.platform): boolean {
  if (path.length === 0 || path.length > changesLimits.pathChars) return false;
  if (path.includes("\0") || path.includes("\ufffd") || drivePrefix.test(path)) return false;
  if (posix.isAbsolute(path) || win32.isAbsolute(path)) return false;
  return path.split("/").every((segment) => isChangeSegment(segment, platform));
}

export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, changesLimits.binaryProbe).includes(0);
}

export function lineCount(text: string): number {
  let lines = 0;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code === lineFeed || (code === carriageReturn && text.charCodeAt(at + 1) !== lineFeed)) {
      lines += 1;
    }
  }
  const last = text.charCodeAt(text.length - 1);
  return text !== "" && last !== lineFeed && last !== carriageReturn ? lines + 1 : lines;
}

export async function readWorktreeSide(
  root: string,
  path: string,
  bytes: number = changesLimits.sideBytes,
): Promise<SideRead> {
  if (!isChangePath(path)) return unreadable;
  if (rootsWithStuckReads.has(root)) return hung;
  const work = confinedSide(root, path, bytes).catch((error: unknown) =>
    isMissing(error) ? gone : refused,
  );
  const read = await withinTime(work, gitReadMs);
  if (read !== undefined) return read;
  markStuck(root, work);
  return hung;
}

export async function worktreeStamps(
  root: string,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const stamps = new Map<string, string>();
  if (rootsWithStuckReads.has(root)) return stamps;
  const work = (async () => {
    const realRoot = await realpathOrUndefined(root);
    const checked = new Map<string, FolderKind>();
    for (const path of paths) {
      if (signal.aborted) return;
      stamps.set(path, await fileStamp(realRoot, path, checked));
    }
  })();
  const finished = await withinTime(
    work.then(() => true),
    gitReadMs,
  );
  if (finished === undefined) markStuck(root, work);
  return new Map(stamps);
}

export async function readBlobSide(
  folder: string,
  oid: string,
  signal?: AbortSignal,
): Promise<SideRead> {
  if (!oidPattern.test(oid) || allZeros.test(oid)) return refused;
  if ((await objectLength(folder, signal)) !== oid.length) return refused;
  const sized = await gitOutput(folder, ["cat-file", "-s", oid], signal);
  if (isHung(sized)) return hung;
  const size = sizeOutput.exec(stdoutOf(sized) ?? "");
  if (size?.[1] === undefined) return notLocal;
  if (Number(size[1]) > changesLimits.sideBytes) return large;
  const read = await gitOutput(folder, ["cat-file", "blob", oid], signal, true);
  if (isHung(read)) return hung;
  const content = stdoutOf(read);
  if (content === undefined) return gone;
  if (content.length > changesLimits.sideBytes) return large;
  return decodedText(Buffer.from(content, "latin1"));
}
