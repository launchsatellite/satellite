import { editor, languages, type IDisposable } from "monaco-editor/editor/editor.api";
import type { HighlighterCore } from "shiki/core";
import type { EditorTheme } from "../../shared/themes/theme-look.ts";
import { shownLook } from "../ui/shown-theme.ts";
import { drawnColumns } from "./read-only-options.ts";
import { grammars } from "./syntax-grammars.ts";

interface MonarchModule {
  language: languages.IMonarchLanguage;
}

const curatedThemeName = "satellite-curated";
const lineTimeLimitMs = 50;
const tokenizedAtOnce = 5000;
const monacoFontStyles = new Set(["italic", "bold", "underline", "strikethrough"]);
const plainState: languages.IState = {
  clone: () => plainState,
  equals: (other) => other === plainState,
};
const plainTokens: languages.TokensProvider = {
  getInitialState: () => plainState,
  tokenize: () => ({ tokens: [], endState: plainState }),
};
const borrowed = new Map<string, IDisposable>();
const highlighters = new Map<string, Promise<HighlighterCore>>();
const tokenProviders = new Map<string, Promise<languages.TokensProvider | undefined>>();

let shownTheme: EditorTheme | undefined;
let watching = false;

function monacoFontStyle(fontStyle: string | undefined): string | undefined {
  if (fontStyle === undefined) return undefined;
  return fontStyle
    .split(" ")
    .filter((style) => monacoFontStyles.has(style))
    .join(" ");
}

function monacoTheme(theme: EditorTheme): editor.IStandaloneThemeData {
  const foreground = theme.colors["editor.foreground"] ?? theme.colors["foreground"];
  return {
    base: theme.type === "light" ? "vs" : "vs-dark",
    inherit: false,
    colors: theme.colors,
    rules: [
      ...(foreground === undefined ? [] : [{ token: "", foreground: foreground.slice(1) }]),
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

function highlighterFor(theme: EditorTheme): Promise<HighlighterCore> {
  const key = JSON.stringify(theme);
  let made = highlighters.get(key);
  if (made === undefined) {
    made = Promise.all([import("shiki/core"), import("shiki/engine/javascript")]).then(
      ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
        createHighlighterCore({
          themes: [structuredClone(theme)],
          langs: [],
          engine: createJavaScriptRegexEngine(),
        }),
    );
    highlighters.set(key, made);
  }
  return made;
}

async function shikiTokens(
  theme: EditorTheme,
  language: string,
): Promise<languages.TokensProvider | undefined> {
  const grammar = grammars[language];
  if (grammar === undefined) return undefined;
  const [highlighter, { default: registrations }, { shikiToMonaco }] = await Promise.all([
    highlighterFor(theme),
    grammar(),
    import("@shikijs/monaco"),
  ]);
  const name = registrations.at(-1)?.name;
  if (name === undefined) return undefined;
  await highlighter.loadLanguage(...registrations);
  let made: languages.TokensProvider | undefined;
  shikiToMonaco(
    highlighter,
    {
      editor: { defineTheme: () => undefined, setTheme: () => undefined, create: () => undefined },
      languages: {
        getLanguages: () => [{ id: name }],
        setTokensProvider: (_language: string, provider: languages.TokensProvider) => {
          made = provider;
        },
      },
    },
    { tokenizeMaxLineLength: drawnColumns, tokenizeTimeLimit: lineTimeLimitMs },
  );
  return made;
}

function redrawDiffs(language: string): void {
  for (const diff of editor.getDiffEditors()) {
    const model = diff.getModel();
    if (model?.original.getLanguageId() !== language) continue;
    const lines = Math.min(model.original.getLineCount(), tokenizedAtOnce);
    editor.colorizeModelLine(model.original, lines);
    diff.setModel({ original: model.original, modified: model.modified });
  }
}

function lend(language: string, provider: languages.TokensProvider): void {
  const before = borrowed.get(language);
  languages.registerTokensProviderFactory(language, { create: () => null });
  borrowed.set(language, languages.setTokensProvider(language, provider));
  before?.dispose();
}

function isMonarchModule(value: unknown): value is MonarchModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "language" in value &&
    typeof value.language === "object" &&
    value.language !== null
  );
}

function hasLoader(value: object): value is { loader: () => Promise<unknown> } {
  return "loader" in value && typeof value.loader === "function";
}

function monarchLoader(language: string): (() => Promise<unknown>) | undefined {
  const known = languages.getLanguages().find(({ id }) => id === language);
  return known !== undefined && hasLoader(known) ? known.loader : undefined;
}

async function giveBack(language: string): Promise<void> {
  const lent = borrowed.get(language);
  borrowed.delete(language);
  lent?.dispose();
  const loaded = await monarchLoader(language)?.();
  if (borrowed.has(language) || !isMonarchModule(loaded)) return;
  languages.setMonarchTokensProvider(language, loaded.language);
  redrawDiffs(language);
}

async function colour(theme: EditorTheme, language: string): Promise<void> {
  if (language === "plaintext") return;
  if (!borrowed.has(language)) lend(language, plainTokens);
  const key = `${JSON.stringify(theme)}\n${language}`;
  let provider = tokenProviders.get(key);
  if (provider === undefined) {
    provider = shikiTokens(theme, language).catch((error: unknown) => {
      console.error(`Satellite could not load the ${language} grammar`, error);
      return undefined;
    });
    tokenProviders.set(key, provider);
  }
  const made = await provider;
  if (made === undefined || shownTheme !== theme) return;
  lend(language, made);
  redrawDiffs(language);
}

function watchModels(): void {
  if (watching) return;
  watching = true;
  editor.onDidCreateModel((model) => {
    if (shownTheme !== undefined) void colour(shownTheme, model.getLanguageId());
  });
}

export function showThemeSyntax(): boolean {
  watchModels();
  const theme = shownLook()?.editor;
  if (theme === shownTheme) return theme !== undefined;
  shownTheme = theme;
  if (theme === undefined) {
    for (const language of [...borrowed.keys()]) void giveBack(language);
    return false;
  }
  editor.defineTheme(curatedThemeName, monacoTheme(theme));
  editor.setTheme(curatedThemeName);
  const shown = new Set(editor.getModels().map((model) => model.getLanguageId()));
  for (const language of shown) void colour(theme, language);
  return true;
}
