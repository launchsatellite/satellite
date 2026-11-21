import type {
  ChangedFile,
  ChangeLetter,
  ChangesList,
  ChangesView,
  FileSides,
} from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";

type UnavailableReason = Extract<ChangesList["changes"], { kind: "unavailable" }>["reason"];
type SideSentenceKind = Exclude<FileSides, { kind: "text" }>;

const letterStates: Record<Exclude<ChangeLetter, "A" | "R" | "C">, string> = {
  M: "modified",
  D: "deleted",
  T: "changed type",
  U: "in a merge",
};

function baseName(base: string | null): string {
  return base === null ? "the base branch" : visibleText(base);
}

function rowState(file: ChangedFile): string {
  const from = visibleText(file.from ?? file.path);
  switch (file.letter) {
    case "A":
      return file.tracked ? "added" : "added, not tracked yet";
    case "R":
      return `renamed from ${from}`;
    case "C":
      return `copied from ${from}`;
    default:
      return letterStates[file.letter];
  }
}

function rowCounts(file: ChangedFile): string {
  if (file.added !== null && file.removed !== null) {
    return `, ${String(file.added)} added, ${String(file.removed)} removed`;
  }
  return file.kind === "binary" ? ", binary" : "";
}

function submoduleSentence(from: string | null, to: string | null): string {
  if (from !== null && to !== null) return `This submodule moved from ${from} to ${to}.`;
  if (to !== null) return `This submodule was added at ${to}.`;
  if (from !== null) return `This submodule was removed. It was at ${from}.`;
  return "This submodule changed.";
}

export function rowName(file: ChangedFile): string {
  return `${visibleText(file.path)}, ${rowState(file)}${rowCounts(file)}`;
}

export function diffLabels(file: ChangedFile): { original: string; modified: string } {
  return {
    original: `Before, ${visibleText(file.from ?? file.path)}`,
    modified: `After, ${visibleText(file.path)}`,
  };
}

export function sideSentence(sides: SideSentenceKind): string {
  switch (sides.kind) {
    case "binary":
      return "This is a binary file, so there is no diff to show.";
    case "large":
      return "This file is too large to show here, over 1 MB or 20,000 lines.";
    case "repository":
      return "This folder is a repository of its own, so Satellite shows no diff for it.";
    case "unmerged":
      return "This file is in the middle of a merge. Claude Code can resolve it.";
    case "changing":
      return "This file changed while Satellite read it. It shows again on the next refresh.";
    case "hung":
      return "Reading this file took too long. It tries again on the next refresh.";
    case "not-local":
      return "This clone never downloaded the earlier version of this file, so there is no diff to show.";
    case "unreadable":
      return "This file's name isn't valid text, so Satellite can't read it.";
    case "not-utf8":
      return "This file isn't UTF-8 text, so there is no diff to show.";
    case "submodule":
      return submoduleSentence(sides.from, sides.to);
  }
}

export function emptySentence(view: ChangesView, base: string | null): string {
  return view === "uncommitted"
    ? "Nothing changed since the last commit."
    : `Nothing changed against ${baseName(base)}.`;
}

export function unavailableSentence(reason: UnavailableReason, base: string | null): string {
  switch (reason) {
    case "no-commits":
      return "This branch has no commits yet, so there is nothing to compare.";
    case "no-base":
      return "Satellite found no base branch to compare with. Uncommitted shows the work here.";
    case "unrelated":
      return `This branch shares no history with ${baseName(base)}, so Branch has nothing to compare.`;
    case "not-local":
      return "This clone never downloaded some of the files these changes need, so Satellite can't list them.";
    case "too-many":
      return "Too many files changed here for Satellite to list.";
    case "hung":
      return "Reading the changes here took too long. It tries again in a moment.";
    case "failed":
      return "Satellite couldn't read the changes here. It tries again in a moment.";
  }
}

export function conflictNote(kind: "old-git" | "slow", base: string | null): string {
  return kind === "old-git"
    ? `Satellite needs git 2.38 or newer to check for conflicts with ${baseName(base)}.`
    : `Checking for conflicts with ${baseName(base)} took too long, so Satellite did not.`;
}

export function conflictCount(files: number): string {
  return files === 1 ? "1 file conflicts" : `${String(files)} files conflict`;
}

export function moreSentence(more: number): string {
  return more === 1 ? "1 more file is not listed." : `${String(more)} more files are not listed.`;
}

export function longPathsSentence(longPaths: number): string {
  return longPaths === 1
    ? "1 file has a path too long to show."
    : `${String(longPaths)} files have paths too long to show.`;
}

export function trackingWords(ahead: number | null, behind: number | null): string {
  return [
    ahead === null ? undefined : `${String(ahead)} ahead`,
    behind === null ? undefined : `${String(behind)} behind`,
  ]
    .filter((part) => part !== undefined)
    .join(", ");
}
