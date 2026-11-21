import { editor } from "monaco-editor/editor/editor.api";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/languages/definitions/register.all";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { diffLanguage } from "./diff-language.ts";
import { applyMonacoTheme } from "./monaco-environment.ts";
import {
  CutShort,
  lineMarks,
  markClick,
  plainModel,
  gitLineCount,
  revealLine,
  selectedLines,
  threadDecorations,
  type DiffHandle,
  type DiffSide,
  type MarkProps,
} from "./read-only-editor.tsx";
import { drawnColumns, readOnlyOptions } from "./read-only-options.ts";

interface SideViewProps extends MarkProps {
  text: string;
  side: DiffSide | null;
  path: string;
  label: string;
  handle?: Ref<DiffHandle>;
}

const sideLook = {
  original: {
    className: "line-delete",
    marginClassName: "gutter-delete",
    linesDecorationsClassName: "delete-sign codicon codicon-diff-remove",
  },
  modified: {
    className: "line-insert",
    marginClassName: "gutter-insert",
    linesDecorationsClassName: "insert-sign codicon codicon-diff-insert",
  },
};

function gitLines(model: editor.ITextModel): number[] {
  return Array.from({ length: gitLineCount(model) }, (_, index) => index + 1);
}

export function SideView({
  text,
  side,
  path,
  label,
  handle,
  marks: threadMarks,
  onMark,
}: SideViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const created = useRef<editor.IStandaloneCodeEditor>(null);
  const shownPath = useRef<string>(null);
  const [cutShort, setCutShort] = useState(false);
  const threadLine = useRef<editor.IEditorDecorationsCollection>(null);
  const threadMarksNow = useRef(threadMarks);
  const onMarkNow = useRef(onMark);
  const marked = threadMarks !== undefined;

  useEffect(() => {
    threadMarksNow.current = threadMarks;
    onMarkNow.current = onMark;
  }, [threadMarks, onMark]);

  useImperativeHandle(
    handle,
    () => ({
      selection: () =>
        created.current === null ? null : selectedLines(created.current, side ?? "modified"),
      reveal: (line) => created.current !== null && revealLine(created.current, line),
    }),
    [side],
  );

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    applyMonacoTheme();
    const made = editor.create(element, {
      ...readOnlyOptions,
      lineDecorationsWidth: 20,
      glyphMargin: threadMarksNow.current !== undefined,
    });
    created.current = made;
    threadLine.current = made.createDecorationsCollection();
    const unclick = markClick(made, (line) => {
      onMarkNow.current?.(line);
    });
    const darkScheme = matchMedia("(prefers-color-scheme: dark)");
    darkScheme.addEventListener("change", applyMonacoTheme);
    return () => {
      unclick.dispose();
      threadLine.current = null;
      darkScheme.removeEventListener("change", applyMonacoTheme);
      const model = made.getModel();
      made.dispose();
      model?.dispose();
      created.current = null;
      shownPath.current = null;
    };
  }, []);

  useEffect(() => {
    created.current?.updateOptions({ ariaLabel: label, glyphMargin: marked });
  }, [label, marked]);

  useEffect(() => {
    const made = created.current;
    if (made === null) return;
    const previous = made.getModel();
    const viewState = shownPath.current === path ? made.saveViewState() : null;
    const { model, revealed } = plainModel(text, diffLanguage(path));
    made.setModel(model);
    if (viewState !== null) made.restoreViewState(viewState);
    shownPath.current = path;
    previous?.dispose();
    const lines = gitLines(model);
    const last = lines.length;
    const sideMark =
      side === null || last === 0
        ? []
        : [
            {
              range: { startLineNumber: 1, startColumn: 1, endLineNumber: last, endColumn: 1 },
              options: { isWholeLine: true, ...sideLook[side] },
            },
          ];
    made.createDecorationsCollection([...sideMark, ...lineMarks(model, lines, revealed)]);
    setCutShort(lines.some((line) => model.getLineMaxColumn(line) > drawnColumns));
    threadLine.current?.set(threadDecorations(threadMarksNow.current ?? [], model.getLineCount()));
  }, [text, side, path]);

  useEffect(() => {
    const lines = created.current?.getModel()?.getLineCount() ?? 0;
    threadLine.current?.set(threadDecorations(threadMarks ?? [], lines));
  }, [threadMarks]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CutShort shown={cutShort} plain={side === null} />
      <div
        ref={host}
        data-testid={side === null ? "file-text" : "diff"}
        data-side={side ?? undefined}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
