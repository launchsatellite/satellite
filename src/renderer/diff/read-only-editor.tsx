import { editor } from "monaco-editor/editor/editor.api";
import { visibleLines } from "../../shared/visible-text.ts";
import { lookAlikeColumns } from "./look-alikes.ts";

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
const boxedLimit = 1000;
const longLineSentence =
  "A changed line here runs past 10,000 characters, so the diff shows only its start.";
const fewBoxesSentence =
  "This file holds over 1,000 characters beyond ASCII, so look-alike letters are marked only inside words on changed lines.";

export const drawnColumns = 10_000;

export const readOnlyOptions = {
  readOnly: true,
  domReadOnly: true,
  renderLineHighlight: "none",
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  scrollbar: { useShadows: false },
  fontFamily: '"Geist Mono Variable", monospace',
  fontSize: 13,
  renderControlCharacters: true,
  stopRenderingLineAfter: drawnColumns,
  unicodeHighlight: {
    invisibleCharacters: false,
    ambiguousCharacters: false,
    nonBasicASCII: false,
    includeComments: true,
    includeStrings: true,
    allowedLocales: {},
  },
  tabFocusMode: true,
  dropIntoEditor: { enabled: false },
  dragAndDrop: false,
  contextmenu: false,
  links: false,
} satisfies editor.IEditorOptions;

export function plainModel(text: string, language: string): editor.ITextModel {
  const model = editor.createModel(visibleLines(text), language);
  model.updateOptions({ bracketColorizationOptions: noBracketColours });
  return model;
}

export function fewNonAscii(text: string): boolean {
  let found = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7e) found += 1;
    if (found >= boxedLimit) return false;
  }
  return true;
}

export function lookAlikeMarks(model: editor.ITextModel, lines: readonly number[]) {
  return lines.flatMap((line) =>
    lookAlikeColumns(model.getLineContent(line)).map(({ start, end }) => ({
      range: { startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end },
      options: { inlineClassName: "look-alike" },
    })),
  );
}

export function selectedLines(sideEditor: editor.ICodeEditor, side: DiffSide) {
  if (sideEditor.getModel() === null) return null;
  const selection = sideEditor.getSelection();
  if (selection === null) return null;
  const { startLineNumber: start, endLineNumber, endColumn } = selection;
  const end = endLineNumber > start && endColumn === 1 ? endLineNumber - 1 : endLineNumber;
  return { side, start, end };
}

export function EditorNotes({ fewBoxes, cutShort }: { fewBoxes: boolean; cutShort: boolean }) {
  return (
    <>
      {fewBoxes && (
        <p
          data-testid="diff-few-boxes"
          className="flex-none border-b border-line px-3 py-2 text-[12px] text-fg2"
        >
          {fewBoxesSentence}
        </p>
      )}
      {cutShort && (
        <p
          data-testid="diff-cut-short"
          className="flex-none border-b border-line px-3 py-2 text-[12px] text-fg2"
        >
          {longLineSentence}
        </p>
      )}
    </>
  );
}
