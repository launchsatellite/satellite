import { editor } from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

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
  const styles = getComputedStyle(document.documentElement);
  const paint = document.createElement("canvas").getContext("2d");
  if (paint === null) throw new Error("A canvas is needed to read the theme colours");
  const token = (name: string) => hexToken(styles, paint, name);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  editor.defineTheme("satellite", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": token("bg"),
      "editor.foreground": token("fg"),
      "editorLineNumber.foreground": token("dim"),
      "editorLineNumber.activeForeground": token("dim"),
      "editorGutter.background": token("bg"),
      "scrollbarSlider.background": token("ctl"),
      "scrollbarSlider.hoverBackground": token("ctl"),
      "scrollbarSlider.activeBackground": token("dim"),
      "diffEditor.insertedLineBackground": token("add"),
      "diffEditor.removedLineBackground": token("del"),
      "diffEditor.insertedTextBackground": token("addfg") + lowAlpha,
      "diffEditor.removedTextBackground": token("delfg") + lowAlpha,
    },
  });
  editor.setTheme("satellite");
}
