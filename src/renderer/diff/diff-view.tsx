import { editor } from "monaco-editor/editor/editor.api";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/features/unicodeHighlighter/register";
import "monaco-editor/languages/definitions/register.all";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
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

function plainModel(text: string, language: string): editor.ITextModel {
  const model = editor.createModel(text, language);
  model.updateOptions({ bracketColorizationOptions: noBracketColours });
  return model;
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
      unicodeHighlight: {
        invisibleCharacters: true,
        ambiguousCharacters: true,
        nonBasicASCII: false,
        includeComments: true,
        includeStrings: true,
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
    const viewState = shownPath.current === path ? created.saveViewState() : null;
    const language = diffLanguage(path);
    created.setModel({
      original: plainModel(original, language),
      modified: plainModel(modified, language),
    });
    if (viewState !== null) created.restoreViewState(viewState);
    shownPath.current = path;
    previous?.original.dispose();
    previous?.modified.dispose();
  }, [original, modified, path]);

  return <div ref={host} data-testid="diff" className="h-full min-h-0" />;
}
