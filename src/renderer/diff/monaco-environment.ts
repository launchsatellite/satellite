import { editor } from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { monacoScrollbarColours } from "../ui/scrollbar-look.ts";
import { showThemeSyntax } from "./theme-syntax.ts";

const lowAlpha = "33";
const sixDigitHex = /^#[0-9a-f]{6}$/;

function readColour(paint: CanvasRenderingContext2D, sentinel: string, value: string): string {
  paint.fillStyle = sentinel;
  paint.fillStyle = value;
  return paint.fillStyle;
}

function hexToken(styles: CSSStyleDeclaration, paint: CanvasRenderingContext2D, name: string) {
  const value = styles.getPropertyValue(`--${name}`).trim();
  const hex = readColour(paint, "#000000", value);
  const valid = hex === readColour(paint, "#ffffff", value) && sixDigitHex.test(hex);
  if (!valid) throw new Error(`The theme token --${name} is not an opaque colour`);
  return hex;
}

export function applyMonacoTheme(): void {
  self.MonacoEnvironment ??= { getWorker: () => new EditorWorker() };
  if (showThemeSyntax()) return;
  const styles = getComputedStyle(document.documentElement);
  const paint = document.createElement("canvas").getContext("2d");
  if (paint === null) throw new Error("A canvas is needed to read the theme colours");
  const token = (name: string) => hexToken(styles, paint, name);
  const rule = (name: string) => token(name).slice(1);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  editor.defineTheme("satellite", {
    base: dark ? "vs-dark" : "vs",
    inherit: false,
    rules: [
      { token: "", foreground: rule("fg") },
      { token: "comment", foreground: rule("dim"), fontStyle: "italic" },
      { token: "keyword", foreground: rule("fg"), fontStyle: "bold" },
      { token: "type", foreground: rule("fg") },
      { token: "string", foreground: rule("fg2") },
      { token: "number", foreground: rule("fg2") },
      { token: "regexp", foreground: rule("fg2") },
    ],
    colors: {
      "editor.background": token("bg"),
      "editor.foreground": token("fg"),
      "editorLineNumber.foreground": token("dim"),
      "editorLineNumber.activeForeground": token("dim"),
      "editorGutter.background": token("bg"),
      ...monacoScrollbarColours(token("fg")),
      "diffEditor.insertedLineBackground": token("add"),
      "diffEditor.removedLineBackground": token("del"),
      "diffEditor.insertedTextBackground": token("addfg") + lowAlpha,
      "diffEditor.removedTextBackground": token("delfg") + lowAlpha,
      "diffEditor.diagonalFill": token("line"),
      "editor.selectionBackground": token("sel"),
      "editor.inactiveSelectionBackground": token("sel"),
      focusBorder: token("accent"),
    },
  });
  editor.setTheme("satellite");
}
