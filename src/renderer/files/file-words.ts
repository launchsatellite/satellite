import type {
  ChangeLetter,
  FileEntry,
  FileRead,
  FolderListing,
} from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";

type SentenceKind = Exclude<FileRead["kind"], "text" | "link" | "image" | "same">;
type FolderProblem = Exclude<FolderListing["state"], "listed">;

export const openingFolderSentence = "Opening the folder…";
export const emptyFolderSentence = "Empty";
export const emptyWorkspaceSentence = "This workspace has no files yet.";
export const pickFileSentence = "Pick a file from the tree, or find one by name.";
export const openingFileSentence = "Opening the file…";
export const viewerFailedSentence =
  "Satellite couldn't load the file viewer, so there is nothing to show.";
export const linkNoteSentence = "This is a link, so the file shows where it points.";

export const typeAFileNameSentence = "Folders count too. Files git ignores are left out.";
export const imageBrokenSentence =
  "Satellite couldn't draw this image, so there is nothing to show.";
export const noFileLinesSentence = "Select some lines in the file first.";
export const notTextSentence = "This file isn't shown as text, so there are no lines to send.";

const findSentences = {
  "too-many": "This workspace has too many files to search by name. Open files from the tree.",
  hung: "Searching took too long. Try again in a moment.",
  failed: "Satellite couldn't list the files here. Try again in a moment.",
};

const fileSentences: Record<SentenceKind, string> = {
  binary: "This is a binary file, so there is nothing to read here.",
  large:
    "This file is too large to show here. Text opens up to 1 MB and 20,000 lines, images up to 5 MB and 50 megapixels.",
  "not-utf8": "This file isn't UTF-8 text, so Satellite doesn't show it.",
  gone: "This file isn't there anymore.",
  changing: "This file changed while Satellite read it. It shows again on the next refresh.",
  hung: "Reading this file took too long. It tries again in a moment.",
  unreadable: "Satellite can't open this file.",
};
const folderSentences: Record<FolderProblem, string> = {
  missing: "This folder is gone.",
  unreadable: "Satellite can't open this folder.",
  "too-many": "This folder holds too many entries to list. Find files in it by name.",
  hung: "Reading this folder took too long. It tries again in a moment.",
  failed: "Satellite couldn't read this folder. It tries again in a moment.",
};
const letterStates: Record<ChangeLetter, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "changed type",
  U: "in a merge",
};

export function fileSentence(read: FileRead): string | undefined {
  switch (read.kind) {
    case "text":
    case "link":
    case "image":
    case "same":
      return undefined;
    default:
      return fileSentences[read.kind];
  }
}

export function findSentence(state: keyof typeof findSentences): string {
  return findSentences[state];
}

export function folderSentence(state: FolderProblem): string {
  return folderSentences[state];
}

export function moreEntries(count: number): string {
  return count === 1
    ? "1 more entry is not listed."
    : `${count.toLocaleString("en-US")} more entries are not listed.`;
}

export function rowLabel(
  path: string,
  kind: FileEntry["kind"],
  letter: ChangeLetter | undefined,
  tracked: boolean,
  ignored: boolean,
): string {
  const states = [
    letter === "A" && !tracked ? "added, not tracked yet" : letter && letterStates[letter],
    kind === "repository" ? "repository of its own" : undefined,
    kind === "link" ? "link" : undefined,
    ignored ? "ignored by git" : undefined,
  ].filter((state) => typeof state === "string");
  const shown =
    letter === undefined || ignored ? visibleText(path) : `${visibleText(path)} ${letter}`;
  return [shown, ...states].join(", ");
}
