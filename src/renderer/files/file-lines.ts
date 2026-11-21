import { lineReference, noLinesSentence } from "../changes/prompt-requests.ts";
import type { DiffSelection } from "../diff/read-only-editor.tsx";
import { noFileLinesSentence } from "./file-words.ts";

type FileLinesRequest = { ok: true; text: string } | { ok: false; sentence: string };

export function fileLinesRequest(
  path: string,
  selection: Pick<DiffSelection, "start" | "end"> | null,
): FileLinesRequest {
  if (selection === null) return { ok: false, sentence: noFileLinesSentence };
  const reference = lineReference({
    path,
    side: "modified",
    view: "uncommitted",
    base: null,
    start: selection.start,
    end: selection.end,
  });
  if (reference.ok) return reference;
  return {
    ok: false,
    sentence: reference.sentence === noLinesSentence ? noFileLinesSentence : reference.sentence,
  };
}
