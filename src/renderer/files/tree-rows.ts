import { filesLimits, type FileEntry, type FolderListing } from "../../shared/bridge-contract.ts";
import {
  emptyFolderSentence,
  folderSentence,
  moreEntries,
  openingFolderSentence,
} from "./file-words.ts";

export interface ItemRow {
  type: "item";
  path: string;
  name: string;
  kind: FileEntry["kind"];
  ignored: boolean;
  level: number;
  setSize: number;
  position: number;
  open: boolean;
}

interface NoteRow {
  type: "note";
  folder: string;
  level: number;
  sentence: string;
}

type TreeRow = ItemRow | NoteRow;

function childPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

export function parentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function isFolderKind(kind: FileEntry["kind"]): boolean {
  return kind === "folder" || kind === "repository";
}

export function openedFolder(open: readonly string[], path: string): string[] {
  if (open.includes(path)) return [...open];
  const next = [...open, path];
  if (next.length <= filesLimits.folders) return next;
  const leaf = open.find(
    (folder) => folder !== "" && !next.some((other) => other.startsWith(`${folder}/`)),
  );
  return leaf === undefined ? [...open] : next.filter((folder) => folder !== leaf);
}

export function closedFolders(open: readonly string[], paths: readonly string[]): string[] {
  return open.filter(
    (folder) => !paths.some((path) => folder === path || folder.startsWith(`${path}/`)),
  );
}

export function nearestRow(
  before: readonly string[],
  after: readonly string[],
  lost: string,
): string | undefined {
  const kept = new Set(after);
  for (let parent = parentPath(lost); parent !== ""; parent = parentPath(parent)) {
    if (kept.has(parent)) return parent;
  }
  const at = before.indexOf(lost);
  const later = before.slice(at + 1).find((path) => kept.has(path));
  return (
    later ??
    before
      .slice(0, Math.max(at, 0))
      .reverse()
      .find((path) => kept.has(path))
  );
}

function noteFor(folder: string, level: number, listing: FolderListing | undefined) {
  const sentence =
    listing === undefined
      ? openingFolderSentence
      : listing.state === "listed"
        ? emptyFolderSentence
        : folderSentence(listing.state);
  return { type: "note", folder, level, sentence } satisfies NoteRow;
}

export function treeRows(
  open: readonly string[],
  listings: ReadonlyMap<string, FolderListing>,
): TreeRow[] {
  const opened = new Set(open);
  const rows: TreeRow[] = [];
  const walk = (folder: string, level: number) => {
    const listing = listings.get(folder);
    if (listing?.state !== "listed" || (listing.entries.length === 0 && listing.more === 0)) {
      rows.push(noteFor(folder, level, listing));
      return;
    }
    listing.entries.forEach((entry, at) => {
      const path = childPath(folder, entry.name);
      const expanded = isFolderKind(entry.kind) && opened.has(path);
      rows.push({
        type: "item",
        path,
        name: entry.name,
        kind: entry.kind,
        ignored: entry.ignored,
        level,
        setSize: listing.entries.length,
        position: at + 1,
        open: expanded,
      });
      if (expanded) walk(path, level + 1);
    });
    if (listing.more > 0) {
      rows.push({ type: "note", folder, level, sentence: moreEntries(listing.more) });
    }
  };
  walk("", 1);
  return rows;
}

export function matchTyped(items: readonly ItemRow[], from: number, typed: string): number {
  const lowered = typed.toLowerCase();
  const repeated = lowered.length > 1 && lowered.replaceAll(lowered.slice(0, 1), "") === "";
  const wanted = repeated ? lowered.slice(0, 1) : lowered;
  const start = wanted.length === 1 ? from + 1 : from;
  for (let step = 0; step < items.length; step += 1) {
    const at = (start + step) % items.length;
    if (items[at]?.name.toLowerCase().startsWith(wanted)) return at;
  }
  return -1;
}
