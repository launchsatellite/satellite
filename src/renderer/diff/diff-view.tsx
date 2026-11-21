import { editor } from "monaco-editor/editor/editor.api";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/features/unicodeHighlighter/register";
import "monaco-editor/languages/definitions/register.all";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { visibleLines } from "../../shared/visible-text.ts";
import { diffLanguage } from "./diff-language.ts";
import { applyMonacoTheme } from "./monaco-environment.ts";

export interface DiffSelection {
  side: "original" | "modified";
  start: number;
  end: number;
}

export interface DiffHandle {
  selection(): DiffSelection | null;
}

interface DiffViewProps {
  original: string;
  modified: string;
  path: string;
  inline: boolean;
  labels: { original: string; modified: string };
  handle?: Ref<DiffHandle>;
}

type DiffSide = DiffSelection["side"];

const noBracketColours = { enabled: false, independentColorPoolPerBracketType: false };
const drawnColumns = 10_000;
const boxedLimit = 1000;
const longLineSentence =
  "A changed line here runs past 10,000 characters, so the diff shows only its start.";

function plainModel(text: string, language: string): editor.ITextModel {
  const model = editor.createModel(visibleLines(text), language);
  model.updateOptions({ bracketColorizationOptions: noBracketColours });
  return model;
}

function fewNonAscii(text: string): boolean {
  let found = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7e) found += 1;
    if (found >= boxedLimit) return false;
  }
  return true;
}

function changeRunsLong(created: editor.IStandaloneDiffEditor): boolean {
  const model = created.getModel();
  if (model === null) return false;
  const long = (side: editor.ITextModel, start: number, end: number) => {
    for (let line = start; line <= end && line >= 1; line += 1) {
      if (side.getLineMaxColumn(line) > drawnColumns) return true;
    }
    return false;
  };
  return (created.getLineChanges() ?? []).some(
    (change) =>
      long(model.original, change.originalStartLineNumber, change.originalEndLineNumber) ||
      long(model.modified, change.modifiedStartLineNumber, change.modifiedEndLineNumber),
  );
}

function selectedLines(created: editor.IStandaloneDiffEditor, side: DiffSide) {
  if (created.getModel() === null) return null;
  const sideEditor =
    side === "original" ? created.getOriginalEditor() : created.getModifiedEditor();
  const selection = sideEditor.getSelection();
  if (selection === null) return null;
  const { startLineNumber: start, endLineNumber, endColumn } = selection;
  const end = endLineNumber > start && endColumn === 1 ? endLineNumber - 1 : endLineNumber;
  return { side, start, end };
}

export function DiffView({ original, modified, path, inline, labels, handle }: DiffViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const diffEditor = useRef<editor.IStandaloneDiffEditor>(null);
  const shownPath = useRef<string>(null);
  const focusedSide = useRef<DiffSide>("modified");
  const pendingView = useRef<editor.IDiffEditorViewState>(null);
  const [cutShort, setCutShort] = useState(false);

  useImperativeHandle(
    handle,
    () => ({
      selection: () => {
        const created = diffEditor.current;
        if (created === null) return null;
        return selectedLines(created, inline ? "modified" : focusedSide.current);
      },
    }),
    [inline],
  );

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    applyMonacoTheme();
    const created = editor.createDiffEditor(element, {
      readOnly: true,
      originalEditable: false,
      domReadOnly: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderGutterMenu: false,
      renderLineHighlight: "none",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      scrollbar: { useShadows: false },
      fontFamily: '"Geist Mono Variable", monospace',
      fontSize: 13,
      renderIndicators: true,
      hideUnchangedRegions: {
        enabled: true,
        contextLineCount: 3,
        minimumLineCount: 3,
        revealLineCount: 20,
      },
      maxComputationTime: 5000,
      maxFileSize: 2,
      diffAlgorithm: "advanced",
      ignoreTrimWhitespace: false,
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
    });
    diffEditor.current = created;
    created.getOriginalEditor().onDidFocusEditorText(() => {
      focusedSide.current = "original";
    });
    created.getModifiedEditor().onDidFocusEditorText(() => {
      focusedSide.current = "modified";
    });
    created.onDidUpdateDiff(() => {
      const viewState = pendingView.current;
      pendingView.current = null;
      if (viewState !== null) created.restoreViewState(viewState);
      setCutShort(changeRunsLong(created));
    });

    const darkScheme = matchMedia("(prefers-color-scheme: dark)");
    darkScheme.addEventListener("change", applyMonacoTheme);

    return () => {
      darkScheme.removeEventListener("change", applyMonacoTheme);
      const model = created.getModel();
      created.dispose();
      model?.original.dispose();
      model?.modified.dispose();
      diffEditor.current = null;
      shownPath.current = null;
    };
  }, []);

  useEffect(() => {
    const created = diffEditor.current;
    if (created === null) return;
    created.updateOptions({ renderSideBySide: !inline });
    created.getOriginalEditor().updateOptions({ ariaLabel: labels.original });
    created.getModifiedEditor().updateOptions({ ariaLabel: labels.modified });
  }, [inline, labels.original, labels.modified]);

  useEffect(() => {
    const created = diffEditor.current;
    if (created === null) return;
    const previous = created.getModel();
    pendingView.current = shownPath.current === path ? created.saveViewState() : null;
    const language = diffLanguage(path);
    const boxed = fewNonAscii(original) && fewNonAscii(modified);
    for (const side of [created.getOriginalEditor(), created.getModifiedEditor()]) {
      side.updateOptions({ unicodeHighlight: { ambiguousCharacters: boxed } });
    }
    created.setModel({
      original: plainModel(original, language),
      modified: plainModel(modified, language),
    });
    shownPath.current = path;
    previous?.original.dispose();
    previous?.modified.dispose();
  }, [original, modified, path]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {cutShort && (
        <p
          data-testid="diff-cut-short"
          className="flex-none border-b border-line px-3 py-2 text-[12px] text-fg2"
        >
          {longLineSentence}
        </p>
      )}
      <div ref={host} data-testid="diff" className="min-h-0 flex-1" />
    </div>
  );
}
