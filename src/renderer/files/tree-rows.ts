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

export interface NoteRow {
  type: "note";
  folder: string;
  level: number;
  sentence: string;
}

export type TreeRow = ItemRow | NoteRow;

export function childPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

export function parentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function isFolderKind(kind: FileEntry["kind"]): boolean {
  return kind === "folder" || kind === "repository";
}

export function ancestors(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, at) => parts.slice(0, at + 1).join("/"));
}

export function openedWith(open: readonly string[], more: readonly string[]): string[] {
  const merged = [...open, ...more.filter((path) => !open.includes(path))];
  const room = filesLimits.folders;
  return merged.length <= room
    ? merged
    : ["", ...merged.filter((path) => path !== "").slice(-(room - 1))];
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
  const wanted = typed.toLowerCase();
  const start = wanted.length === 1 ? from + 1 : from;
  for (let step = 0; step < items.length; step += 1) {
    const at = (start + step) % items.length;
    if (items[at]?.name.toLowerCase().startsWith(wanted)) return at;
  }
  return -1;
}
