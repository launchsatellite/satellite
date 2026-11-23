import type { editor } from "monaco-editor/editor/editor.api";
import { codeType } from "../ui/code-type.ts";

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
  fontFamily: codeType.fontFamily,
  fontSize: codeType.fontSize,
  stopRenderingLineAfter: drawnColumns,
  unicodeHighlight: {
    invisibleCharacters: false,
    ambiguousCharacters: false,
    nonBasicASCII: false,
  },
  tabFocusMode: true,
  dropIntoEditor: { enabled: false },
  dragAndDrop: false,
  contextmenu: false,
  links: false,
} satisfies editor.IEditorOptions;
