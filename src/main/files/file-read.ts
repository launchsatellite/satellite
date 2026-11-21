import type { BigIntStats } from "node:fs";
import { lstat } from "node:fs/promises";
import { join, posix } from "node:path";
import { changesLimits, filesLimits, type FileRead } from "../../shared/bridge-contract.ts";
import {
  confinedFolder,
  decodedText,
  isChangePath,
  linkSide,
  markStuck,
  openedBytes,
  rootsWithStuckReads,
  sameFolder,
  stampOf,
  withinTime,
  type SideRead,
} from "../changes/file-sides.ts";
import { isMissing } from "../platform/file-system.ts";
import { gitReadMs } from "../workspaces/git-command.ts";
import { hasImageSignature, readImageHeader, type ImageKind } from "./image-size.ts";

const headBytes = 65_536;
const gone: FileRead = { kind: "gone" };
const hung: FileRead = { kind: "hung" };
const unreadable: FileRead = { kind: "unreadable" };

function viewed(read: SideRead, stamp: string): FileRead {
  switch (read.kind) {
    case "text":
      return { kind: "text", text: read.text, stamp };
    case "binary":
    case "large":
    case "not-utf8":
      return { kind: read.kind, stamp };
    case "changing":
      return { kind: "changing" };
    case "gone":
      return gone;
    case "hung":
      return hung;
    default:
      return unreadable;
  }
}

async function readEntry(
  file: string,
  entry: BigIntStats,
  stamp: string,
  signal?: AbortSignal,
): Promise<FileRead> {
  if (entry.isSymbolicLink()) {
    const link = await linkSide(file);
    return link.kind === "text" ? { kind: "link", text: link.text, stamp } : viewed(link, stamp);
  }
  if (entry.isDirectory()) return gone;
  if (!entry.isFile()) return { kind: "binary", stamp };
  if (entry.size > BigInt(filesLimits.imageBytes)) return { kind: "large", stamp };
  signal?.throwIfAborted();
  const sniffed: { image: ImageKind | undefined; signed: boolean } = {
    image: undefined,
    signed: false,
  };
  const read = await openedBytes(file, entry, {
    probe: headBytes,
    limitFor: (head) => {
      sniffed.image = readImageHeader(head);
      sniffed.signed = hasImageSignature(head);
      if (sniffed.image === undefined) return changesLimits.sideBytes;
      return sniffed.image.width * sniffed.image.height > filesLimits.imagePixels
        ? 0
        : filesLimits.imageBytes;
    },
  });
  if (!(read instanceof Uint8Array)) return viewed(read, stamp);
  if (sniffed.image !== undefined) {
    return {
      kind: "image",
      type: sniffed.image.type,
      data: Buffer.from(read).toString("base64"),
      stamp,
    };
  }
  return sniffed.signed ? { kind: "binary", stamp } : viewed(decodedText(read), stamp);
}

async function readConfined(
  root: string,
  path: string,
  known: string | null,
  signal?: AbortSignal,
): Promise<FileRead> {
  const parent = posix.dirname(path);
  const folder = await confinedFolder(root, parent);
  if (typeof folder !== "string") {
    return folder.kind === "gone" ? gone : unreadable;
  }
  const file = join(folder, posix.basename(path));
  const entry = await lstat(file, { bigint: true });
  const stamp = stampOf(entry);
  if (known === stamp) return { kind: "same" };
  signal?.throwIfAborted();
  const read = await readEntry(file, entry, stamp, signal);
  const recheck = await confinedFolder(root, parent);
  return typeof recheck === "string" && sameFolder(recheck, folder) ? read : unreadable;
}

export async function readFileForViewing(
  root: string,
  path: string,
  known: string | null,
  signal?: AbortSignal,
): Promise<FileRead> {
  if (!isChangePath(path)) return unreadable;
  if (rootsWithStuckReads.has(root)) return hung;
  const work = readConfined(root, path, known, signal).catch((error: unknown): FileRead =>
    isMissing(error) ? gone : unreadable,
  );
  const read = await withinTime(work, gitReadMs);
  if (read !== undefined) return read;
  markStuck(root, work);
  return hung;
}
