import type { ChangesView } from "../../shared/bridge-contract.ts";
import { holdsHiddenText } from "../../shared/prompt-text.ts";
import { quotedPath } from "../terminal/dropped-paths.ts";

export type LineReference = { ok: true; text: string } | { ok: false; sentence: string };

interface LineReferenceInput {
  path: string;
  side: "original" | "modified";
  view: ChangesView;
  base: string | null;
  start: number;
  end: number;
}

const referenceLimit = 800;
const hiddenSentence =
  "This file's name holds hidden characters, so Satellite can't point Claude Code at it. Ask in your own words.";
export const noLinesSentence = "Select some lines in the diff first.";
const longSentence = "This file's path is too long to send. Ask in your own words.";

const plainName = /^[^\s"'`]+$/;
const fallbackName = "the base branch";

export function cleanBase(base: string | null): string {
  if (base === null || holdsHiddenText(base) || !plainName.test(base)) return fallbackName;
  return base;
}

export function conflictRequest(base: string | null): string {
  return `Update this branch from ${cleanBase(base)} and resolve the conflicts.`;
}

function whereIs({ side, view, base }: LineReferenceInput): string {
  if (side === "modified") return "in this workspace";
  return view === "uncommitted"
    ? "as of the last commit"
    : `at the merge base with ${cleanBase(base)}`;
}

export function lineReference(input: LineReferenceInput): LineReference {
  const { path, start, end } = input;
  if (path === "" || holdsHiddenText(path)) return { ok: false, sentence: hiddenSentence };
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    return { ok: false, sentence: noLinesSentence };
  }
  const range =
    start === end ? `Line ${String(start)}` : `Lines ${String(start)} to ${String(end)}`;
  const text = `${range} of ${quotedPath(path)} ${whereIs(input)}. `;
  if (text.length > referenceLimit) return { ok: false, sentence: longSentence };
  return { ok: true, text };
}
