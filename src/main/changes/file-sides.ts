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
  | { kind: "not-local" }
  | { kind: "unreadable" }
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
const promisorKeys = "^(extensions\\.partialclone|remote\\..+\\.promisor)$";
const falseValues = new Set(["", "false", "no", "off", "0"]);

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

async function withinTime(work: Promise<SideRead>, ms: number): Promise<SideRead | undefined> {
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

async function gitOutput(folder: string, args: string[], signal?: AbortSignal, bytes = false) {
  const run = await runGit(folder, args, gitReadMs, signal, {
    gitVariables: { GIT_NO_LAZY_FETCH: "1" },
    bytes,
  });
  return run?.exitCode === 0 ? run.stdout : undefined;
}

async function objectLength(folder: string, signal?: AbortSignal) {
  const known = objectLengths.get(folder);
  if (known !== undefined) return known;
  const format = await gitOutput(folder, ["rev-parse", "--show-object-format"], signal);
  const length = format === undefined ? undefined : objectFormatLengths.get(format);
  if (length !== undefined) objectLengths.set(folder, length);
  return length;
}

function namesPromisor(entry: string): boolean {
  const [, value] = entry.split("\n");
  return value === undefined || !falseValues.has(value.toLowerCase());
}

async function missingBlob(folder: string, signal?: AbortSignal): Promise<SideRead> {
  const args = ["config", "-z", "--get-regexp", promisorKeys];
  const entries = (await gitOutput(folder, args, signal)) ?? "";
  return entries.split("\0").some((entry) => entry !== "" && namesPromisor(entry))
    ? notLocal
    : gone;
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
  if (rootsWithStuckReads.has(root)) return changing;
  const work = confinedSide(root, path, bytes).catch((error: unknown) =>
    isMissing(error) ? gone : refused,
  );
  const read = await withinTime(work, gitReadMs);
  if (read !== undefined) return read;
  rootsWithStuckReads.add(root);
  const release = () => {
    rootsWithStuckReads.delete(root);
  };
  void work.then(release, release);
  return changing;
}

export async function readBlobSide(
  folder: string,
  oid: string,
  signal?: AbortSignal,
): Promise<SideRead> {
  if (!oidPattern.test(oid) || allZeros.test(oid)) return refused;
  if ((await objectLength(folder, signal)) !== oid.length) return refused;
  const size = sizeOutput.exec((await gitOutput(folder, ["cat-file", "-s", oid], signal)) ?? "");
  if (size?.[1] === undefined) return missingBlob(folder, signal);
  if (Number(size[1]) > changesLimits.sideBytes) return large;
  const content = await gitOutput(folder, ["cat-file", "blob", oid], signal, true);
  if (content === undefined) return missingBlob(folder, signal);
  if (content.length > changesLimits.sideBytes) return large;
  return decodedText(Buffer.from(content, "latin1"));
}
