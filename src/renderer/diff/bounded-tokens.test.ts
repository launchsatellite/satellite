import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { EncodedTokenMetadata, INITIAL, type StateStack } from "shiki/textmate";
import dracula from "shiki/themes/dracula.mjs";
import { describe, expect, it } from "vitest";
import { fileTokenizer, tokenBounds, type LineTokenizer } from "./bounded-tokens.ts";
import { grammars } from "./syntax-grammars.ts";

function fakeGrammar(scanMs: number, stopsEarly: (line: string) => boolean) {
  const seen: { line: string; stack: StateStack | null }[] = [];
  const grammar: LineTokenizer = {
    tokenizeLine2(line, stack) {
      seen.push({ line, stack });
      const started = performance.now();
      while (performance.now() - started < scanMs) continue;
      return {
        tokens: new Uint32Array([0, 0]),
        ruleStack: INITIAL,
        stoppedEarly: stopsEarly(line),
      };
    },
  };
  return { grammar, seen };
}

describe("fileTokenizer", () => {
  it("gives every grammar a longest line and shows a longer line plain without scanning it", () => {
    for (const [language, grammar] of Object.entries(grammars)) {
      expect(Number.isInteger(grammar?.longestLine), language).toBe(true);
      const longestLine = grammar?.longestLine ?? 0;
      expect(longestLine, language).toBeGreaterThan(0);
      const { grammar: fake, seen } = fakeGrammar(0, () => false);
      const next = fileTokenizer(fake, [], () => "", longestLine);
      expect(next("_".repeat(longestLine + 1))).toBeNull();
      expect(next("_".repeat(longestLine))).not.toBeNull();
      expect(seen.map(({ line }) => line.length)).toEqual([longestLine]);
    }
  });

  it("shows the rest of a file plain once its budget is spent", () => {
    const { grammar, seen } = fakeGrammar(10, () => false);
    const next = fileTokenizer(grammar, [], () => "", 100);
    const lines = Array.from({ length: 1000 }, () => next("x"));
    const firstPlain = lines.indexOf(null);
    expect(firstPlain).toBeGreaterThan(0);
    expect(lines.slice(firstPlain).every((tokens) => tokens === null)).toBe(true);
    expect(seen).toHaveLength(firstPlain);
    expect(firstPlain * 10).toBeGreaterThanOrEqual(tokenBounds.fileMs);
  });

  it("keeps the last full line's state after a line that stops between scans", () => {
    const { grammar, seen } = fakeGrammar(0, (line) => line === "slow");
    const next = fileTokenizer(grammar, [], () => "", 100);
    next("a");
    next("slow");
    next("b");
    expect(seen.map(({ stack }) => stack)).toEqual([INITIAL, INITIAL, INITIAL]);
  });

  it.each(["typescriptreact", "javascriptreact"])(
    "colours JSX tags and attributes in %s as the theme's own editor does",
    async (language) => {
      const highlighter = await createHighlighterCore({
        themes: [dracula],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
      const grammar = grammars[language];
      if (grammar === undefined) throw new Error(language);
      const { default: registrations } = await grammar.load();
      await highlighter.loadLanguage(...registrations);
      const name = registrations.at(-1)?.name ?? language;
      const { colorMap } = highlighter.setTheme("dracula");
      const loaded = highlighter.getLanguage(name);
      const line = 'return <div className="row">{name}</div>;';
      const whole = loaded.tokenizeLine2(line, INITIAL);
      expect(whole.stoppedEarly).toBe(false);
      const tokens: [number, string][] = [];
      for (let at = 0; at < whole.tokens.length; at += 2) {
        const metadata = whole.tokens[at + 1] ?? 0;
        tokens.push([
          whole.tokens[at] ?? 0,
          colorMap[EncodedTokenMetadata.getForeground(metadata)] ?? "",
        ]);
      }
      const colourAt = (text: string) =>
        tokens.findLast(([start]) => start <= line.indexOf(text))?.[1].toLowerCase();
      expect([colourAt("div"), colourAt("className")]).toEqual(["#ff79c6", "#50fa7b"]);
      highlighter.dispose();
    },
  );
});
