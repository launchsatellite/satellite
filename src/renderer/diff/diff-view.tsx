import { editor } from "monaco-editor/editor/editor.api";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/languages/definitions/register.all";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { RevealedRange } from "../../shared/visible-text.ts";
import { diffLanguage } from "./diff-language.ts";
import { applyMonacoTheme } from "./monaco-environment.ts";
import {
  CutShort,
  lineMarks,
  plainModel,
  selectedLines,
  type DiffHandle,
  type DiffSide,
} from "./read-only-editor.tsx";
import { drawnColumns, readOnlyOptions } from "./read-only-options.ts";

interface DiffViewProps {
  original: string;
  modified: string;
  path: string;
  inline: boolean;
  labels: { original: string; modified: string };
  handle?: Ref<DiffHandle>;
}

function changedLines(created: editor.IStandaloneDiffEditor, side: DiffSide): number[] {
  const lines: number[] = [];
  for (const change of created.getLineChanges() ?? []) {
    const start =
      side === "original" ? change.originalStartLineNumber : change.modifiedStartLineNumber;
    const end = side === "original" ? change.originalEndLineNumber : change.modifiedEndLineNumber;
    for (let line = Math.max(start, 1); line <= end; line += 1) lines.push(line);
  }
  return lines;
}

export function DiffView({ original, modified, path, inline, labels, handle }: DiffViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const diffEditor = useRef<editor.IStandaloneDiffEditor>(null);
  const shownPath = useRef<string>(null);
  const focusedSide = useRef<DiffSide>("modified");
  const pendingView = useRef<editor.IDiffEditorViewState>(null);
  const revealed = useRef<Record<DiffSide, RevealedRange[]>>({ original: [], modified: [] });
  const [cutShort, setCutShort] = useState(false);

  useImperativeHandle(
    handle,
    () => ({
      selection: () => {
        const created = diffEditor.current;
        if (created === null) return null;
        const side = inline ? "modified" : focusedSide.current;
        return selectedLines(
          side === "original" ? created.getOriginalEditor() : created.getModifiedEditor(),
          side,
        );
      },
    }),
    [inline],
  );

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    applyMonacoTheme();
    const created = editor.createDiffEditor(element, {
      ...readOnlyOptions,
      originalEditable: false,
      useInlineViewWhenSpaceIsLimited: false,
      renderGutterMenu: false,
      renderOverviewRuler: false,
      renderIndicators: true,
      hideUnchangedRegions: {
        enabled: true,
        contextLineCount: 3,
        minimumLineCount: 3,
        revealLineCount: 20,
      },
      maxComputationTime: 5000,
      diffAlgorithm: "advanced",
      ignoreTrimWhitespace: false,
    });
    diffEditor.current = created;
    created.getOriginalEditor().onDidFocusEditorText(() => {
      focusedSide.current = "original";
    });
    created.getModifiedEditor().onDidFocusEditorText(() => {
      focusedSide.current = "modified";
    });
    const sides = {
      original: created.getOriginalEditor(),
      modified: created.getModifiedEditor(),
    };
    const marks = {
      original: sides.original.createDecorationsCollection(),
      modified: sides.modified.createDecorationsCollection(),
    };
    created.onDidUpdateDiff(() => {
      const viewState = pendingView.current;
      pendingView.current = null;
      if (viewState !== null) created.restoreViewState(viewState);
      let long = false;
      for (const side of ["original", "modified"] as const) {
        const model = sides[side].getModel();
        if (model === null) continue;
        const lines = changedLines(created, side);
        long ||= lines.some((line) => model.getLineMaxColumn(line) > drawnColumns);
        marks[side].set(lineMarks(model, lines, revealed.current[side]));
      }
      setCutShort(long);
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
    const shown = {
      original: plainModel(original, language),
      modified: plainModel(modified, language),
    };
    revealed.current = { original: shown.original.revealed, modified: shown.modified.revealed };
    created.setModel({ original: shown.original.model, modified: shown.modified.model });
    shownPath.current = path;
    previous?.original.dispose();
    previous?.modified.dispose();
  }, [original, modified, path]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CutShort shown={cutShort} />
      <div ref={host} data-testid="diff" className="min-h-0 flex-1" />
    </div>
  );
}
