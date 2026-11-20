import { editor } from "monaco-editor/editor/editor.api";
import "monaco-editor/features/codicon/register";
import { useEffect, useRef } from "react";
import { applyMonacoTheme } from "./monaco-environment.ts";

export function DiffView({
  original,
  modified,
  language,
}: {
  original: string;
  modified: string;
  language?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const diffEditor = useRef<editor.IStandaloneDiffEditor>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    applyMonacoTheme();
    const created = editor.createDiffEditor(element, {
      readOnly: true,
      originalEditable: false,
      domReadOnly: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderGutterMenu: false,
      renderLineHighlight: "none",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      fontFamily: '"Geist Mono Variable", monospace',
      fontSize: 13,
    });
    diffEditor.current = created;

    const darkScheme = matchMedia("(prefers-color-scheme: dark)");
    darkScheme.addEventListener("change", applyMonacoTheme);

    return () => {
      darkScheme.removeEventListener("change", applyMonacoTheme);
      const model = created.getModel();
      created.dispose();
      model?.original.dispose();
      model?.modified.dispose();
      diffEditor.current = null;
    };
  }, []);

  useEffect(() => {
    const created = diffEditor.current;
    if (created === null) return;
    const previous = created.getModel();
    const languageId = language ?? "plaintext";
    created.setModel({
      original: editor.createModel(original, languageId),
      modified: editor.createModel(modified, languageId),
    });
    previous?.original.dispose();
    previous?.modified.dispose();
  }, [original, modified, language]);

  return <div ref={host} data-testid="diff" className="h-full min-h-0" />;
}
