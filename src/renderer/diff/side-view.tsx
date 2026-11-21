import { editor } from "monaco-editor/editor/editor.api";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/languages/definitions/register.all";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { diffLanguage } from "./diff-language.ts";
import { applyMonacoTheme } from "./monaco-environment.ts";
import {
  drawnColumns,
  CutShort,
  lookAlikeMarks,
  plainModel,
  readOnlyOptions,
  selectedLines,
  type DiffHandle,
  type DiffSide,
} from "./read-only-editor.tsx";

interface SideViewProps {
  text: string;
  side: DiffSide;
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

function gitLines(text: string, model: editor.ITextModel): number[] {
  const count = model.getLineCount() - (text === "" || text.endsWith("\n") ? 1 : 0);
  return Array.from({ length: count }, (_, index) => index + 1);
}

export function SideView({ text, side, path, label, handle }: SideViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const created = useRef<editor.IStandaloneCodeEditor>(null);
  const shownPath = useRef<string>(null);
  const [cutShort, setCutShort] = useState(false);

  useImperativeHandle(
    handle,
    () => ({
      selection: () => (created.current === null ? null : selectedLines(created.current, side)),
    }),
    [side],
  );

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    applyMonacoTheme();
    const made = editor.create(element, { ...readOnlyOptions, lineDecorationsWidth: 20 });
    created.current = made;
    const darkScheme = matchMedia("(prefers-color-scheme: dark)");
    darkScheme.addEventListener("change", applyMonacoTheme);
    return () => {
      darkScheme.removeEventListener("change", applyMonacoTheme);
      const model = made.getModel();
      made.dispose();
      model?.dispose();
      created.current = null;
      shownPath.current = null;
    };
  }, []);

  useEffect(() => {
    created.current?.updateOptions({ ariaLabel: label });
  }, [label]);

  useEffect(() => {
    const made = created.current;
    if (made === null) return;
    const previous = made.getModel();
    const viewState = shownPath.current === path ? made.saveViewState() : null;
    const model = plainModel(text, diffLanguage(path));
    made.setModel(model);
    if (viewState !== null) made.restoreViewState(viewState);
    shownPath.current = path;
    previous?.dispose();
    const lines = gitLines(text, model);
    const last = lines.length;
    const sideMark = {
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: last, endColumn: 1 },
      options: { isWholeLine: true, ...sideLook[side] },
    };
    made.createDecorationsCollection([
      ...(last === 0 ? [] : [sideMark]),
      ...lookAlikeMarks(model, lines),
    ]);
    setCutShort(lines.some((line) => model.getLineMaxColumn(line) > drawnColumns));
  }, [text, side, path]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CutShort shown={cutShort} />
      <div ref={host} data-testid="diff" data-side={side} className="min-h-0 flex-1" />
    </div>
  );
}
