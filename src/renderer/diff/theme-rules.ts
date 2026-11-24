import type { editor } from "monaco-editor/editor/editor.api";
import type { EditorTheme } from "../../shared/themes/theme-look.ts";

const monacoFontStyles = ["italic", "bold", "underline", "strikethrough"];

function monacoFontStyle(fontStyle: string | undefined): string | undefined {
  if (fontStyle === undefined) return undefined;
  return fontStyle
    .split(" ")
    .filter((style) => monacoFontStyles.includes(style))
    .join(" ");
}

function styleKey(colour: string, fontStyle: string): string {
  return fontStyle === "" ? colour.toLowerCase() : `${colour.toLowerCase()}|${fontStyle}`;
}

export function monacoTheme(theme: EditorTheme): editor.IStandaloneThemeData {
  const foreground = theme.colors["editor.foreground"] ?? theme.colors["foreground"];
  return {
    base: theme.type === "light" ? "vs" : "vs-dark",
    inherit: false,
    colors: theme.colors,
    rules: [
      ...(foreground === undefined ? [] : [{ token: "", foreground: foreground.slice(1, 7) }]),
      ...theme.tokenColors.flatMap(({ scope, settings }) =>
        scope.map((token) => {
          const fontStyle = monacoFontStyle(settings.fontStyle);
          return {
            token,
            ...(settings.foreground === undefined
              ? {}
              : { foreground: settings.foreground.slice(1, 7) }),
            ...(fontStyle === undefined ? {} : { fontStyle }),
          };
        }),
      ),
    ],
  };
}

export function scopeOfStyle(theme: EditorTheme): (colour: string, fontStyle: string) => string {
  const scopes = new Map<string, string>();
  for (const { token, foreground, fontStyle } of monacoTheme(theme).rules) {
    if (foreground === undefined) continue;
    const key = styleKey(foreground, fontStyle ?? "");
    if (!scopes.has(key)) scopes.set(key, token);
  }
  return (colour, fontStyle) => scopes.get(styleKey(colour.slice(1, 7), fontStyle)) ?? "";
}
