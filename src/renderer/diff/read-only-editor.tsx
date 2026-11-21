import { editor } from "monaco-editor/editor/editor.api";
import { revealLines, type RevealedRange } from "../../shared/visible-text.ts";
import { AmbiguousCharacters } from "monaco-editor/base/common/strings";
import { drawnColumns } from "./read-only-options.ts";
import { lineRange } from "./line-range.ts";
import { confusableColumns, lookAlikeColumns, type ColumnRange } from "./look-alikes.ts";

export interface DiffSelection {
  side: "original" | "modified";
  start: number;
  end: number;
}

export interface DiffHandle {
  selection(): DiffSelection | null;
}

export type DiffSide = DiffSelection["side"];

const noBracketColours = { enabled: false, independentColorPoolPerBracketType: false };
const longLineSentence =
  "A changed line here runs past 10,000 characters, so the diff shows only its start.";
const longFileLineSentence =
  "A line here runs past 10,000 characters, so the file shows only its start.";
const confusables = AmbiguousCharacters.getInstance(new Set());
const revealedMarks = 10_000;

export function plainModel(text: string, language: string) {
  const { text: shown, revealed } = revealLines(text);
  const model = editor.createModel(shown, language);
  model.updateOptions({ bracketColorizationOptions: noBracketColours });
  return { model, revealed };
}

function markedColumns(line: string): ColumnRange[] {
  const marked = new Map<number, ColumnRange>();
  const found = [
    ...lookAlikeColumns(line),
    ...confusableColumns(line, (point) => confusables.isAmbiguous(point)),
  ];
  for (const range of found) if (range.start <= drawnColumns) marked.set(range.start, range);
  return [...marked.values()];
}

function columnMark(line: number, { start, end }: ColumnRange, inlineClassName: string) {
  return {
    range: { startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end },
    options: { inlineClassName },
  };
}

export function lineMarks(
  model: editor.ITextModel,
  lines: readonly number[],
  revealed: readonly RevealedRange[],
) {
  const marked = new Set(lines);
  const shownRevealed = revealed
    .filter((range) => marked.has(range.line))
    .slice(0, revealedMarks)
    .map((range) => columnMark(range.line, range, "revealed"));
  const lookAlikes = lines.flatMap((line) =>
    markedColumns(model.getLineContent(line)).map((range) => columnMark(line, range, "look-alike")),
  );
  return [...shownRevealed, ...lookAlikes];
}

export function gitLineCount(model: editor.ITextModel): number {
  const last = model.getLineCount();
  return last - (model.getLineLength(last) === 0 ? 1 : 0);
}

export function selectedLines(sideEditor: editor.ICodeEditor, side: DiffSide) {
  const model = sideEditor.getModel();
  const selection = sideEditor.getSelection();
  if (model === null || selection === null) return null;
  const range = lineRange(
    {
      startLine: selection.startLineNumber,
      endLine: selection.endLineNumber,
      endColumn: selection.endColumn,
      empty: selection.isEmpty(),
    },
    gitLineCount(model),
  );
  return range === null ? null : { side, ...range };
}

export function CutShort({ shown, plain = false }: { shown: boolean; plain?: boolean }) {
  if (!shown) return null;
  return (
    <p
      data-testid="diff-cut-short"
      className="flex-none border-b border-line px-3 py-2 text-[12px] text-fg2"
    >
      {plain ? longFileLineSentence : longLineSentence}
    </p>
  );
}
