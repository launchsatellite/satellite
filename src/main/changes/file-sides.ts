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
import { gitReadMs, runGit } from "../workspaces/git-command.ts";

export type SideRead =
  | { kind: "text"; text: string }
  | { kind: "binary" }
  | { kind: "large" }
  | { kind: "changing" }
  | { kind: "gone" }
  | { kind: "refused" };

export const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

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
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;
}

function decodedText(bytes: Uint8Array): SideRead {
  if (looksBinary(bytes)) return binary;
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return lineCount(text) > changesLimits.sideLines ? large : { kind: "text", text };
}

async function confinedFolder(root: string, parent: string): Promise<string | SideRead> {
  const realRoot = await realpathOrUndefined(root);
  if (realRoot === undefined) return gone;
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

async function withinTime(work: Promise<SideRead>, ms: number): Promise<SideRead> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<SideRead>((settle) => {
    timer = setTimeout(() => {
      settle(changing);
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
  const read = await withinTime(openedSide(file, entry), gitReadMs);
  const recheck = await confinedFolder(root, parent);
  if (typeof recheck !== "string") return recheck;
  return sameFolder(recheck, folder) ? read : refused;
}

async function gitOutput(folder: string, args: string[], signal?: AbortSignal) {
  const run = await runGit(folder, args, gitReadMs, signal);
  return run?.exitCode === 0 ? run.stdout : undefined;
}

export function isChangePath(path: string, platform: NodeJS.Platform = process.platform): boolean {
  if (path.length === 0 || path.length > changesLimits.pathChars) return false;
  if (path.includes("\0") || drivePrefix.test(path)) return false;
  if (posix.isAbsolute(path) || win32.isAbsolute(path)) return false;
  return path.split("/").every((segment) => isChangeSegment(segment, platform));
}

export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, changesLimits.binaryProbe).includes(0);
}

export function lineCount(text: string): number {
  let lines = 0;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) lines += 1;
  return text !== "" && !text.endsWith("\n") ? lines + 1 : lines;
}

export async function readWorktreeSide(
  root: string,
  path: string,
  bytes: number = changesLimits.sideBytes,
): Promise<SideRead> {
  if (!isChangePath(path)) return refused;
  try {
    return await confinedSide(root, path, bytes);
  } catch (error) {
    return isMissing(error) ? gone : refused;
  }
}

export async function readBlobSide(
  folder: string,
  oid: string,
  signal?: AbortSignal,
): Promise<SideRead> {
  if (!oidPattern.test(oid) || allZeros.test(oid)) return refused;
  const size = sizeOutput.exec((await gitOutput(folder, ["cat-file", "-s", oid], signal)) ?? "");
  if (size?.[1] === undefined) return gone;
  if (Number(size[1]) > changesLimits.sideBytes) return large;
  const text = await gitOutput(folder, ["cat-file", "blob", oid], signal);
  if (text === undefined) return gone;
  if (text.slice(0, changesLimits.binaryProbe).includes("\0")) return binary;
  if (text.length > changesLimits.sideBytes) return large;
  return lineCount(text) > changesLimits.sideLines ? large : { kind: "text", text };
}
