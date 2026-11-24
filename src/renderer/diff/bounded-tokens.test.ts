import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import dracula from "shiki/themes/dracula.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { fileTokenizer, tokenBounds, type LineTokens } from "./bounded-tokens.ts";
import { grammars } from "./syntax-grammars.ts";

const frameMs = 16;
const units = ["_", "$", "a", "1", " ", "\t", "<", "~", "a.", "#", "(", "{", "\\", "-"];
const prefixes = ["", "x = ", "# ", "/* ", '"', "`"];
const ends = ["!", "x", "e", '"'];
const warmUp = [
  "x = 1;",
  'int main(void) { return f(a, "s") + 2; } // c',
  "const x = `a ${b}`; /* c */",
];

let highlighter: HighlighterCore;

beforeAll(async () => {
  highlighter = await createHighlighterCore({
    themes: [dracula],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
});

function hostile(prefix: string, unit: string, end: string, length: number): string {
  const body = unit.repeat(Math.ceil(length / unit.length));
  return (prefix + body).slice(0, length - end.length) + end;
}

async function tokenizerFor(language: string) {
  const grammar = grammars[language];
  if (grammar === undefined) throw new Error(language);
  const { default: registrations } = await grammar.load();
  await highlighter.loadLanguage(...registrations);
  const name = registrations.at(-1)?.name ?? language;
  const { colorMap } = highlighter.setTheme("dracula");
  const fresh = () =>
    fileTokenizer(highlighter.getLanguage(name), colorMap, () => "", grammar.longestLine, {
      ms: 0,
    });
  const warm = fresh();
  for (const line of [...warmUp, ...units.map((unit) => unit.repeat(40))]) warm(line);
  return { fresh, longestLine: grammar.longestLine };
}

function lineMs(fresh: () => (line: string) => LineTokens, line: string): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 10 && fastest > frameMs; run++) {
    const next = fresh();
    const started = performance.now();
    next(line);
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

describe("fileTokenizer", () => {
  it.each(Object.keys(grammars))(
    "keeps every hostile line of %s within a frame",
    async (language) => {
      const { fresh, longestLine } = await tokenizerFor(language);
      const slow: string[] = [];
      for (const prefix of prefixes)
        for (const unit of units)
          for (const end of ends) {
            const line = hostile(prefix, unit, end, longestLine);
            const ms = lineMs(fresh, line);
            if (ms > frameMs) slow.push(`${JSON.stringify(line.slice(0, 12))} ${ms.toFixed(1)} ms`);
          }
      expect(slow).toEqual([]);
    },
    120_000,
  );

  it("shows a line past the longest as plain text without scanning it", async () => {
    const { fresh, longestLine } = await tokenizerFor("typescript");
    expect(fresh()("_".repeat(longestLine + 1))).toBeNull();
  });

  it("stops colouring a file once its budget is spent", async () => {
    const { fresh, longestLine } = await tokenizerFor("markdown");
    const next = fresh();
    const line = hostile('"', "~", "!", longestLine);
    const started = performance.now();
    let plain = 0;
    for (let at = 0; at < 20_000; at++) if (next(line) === null) plain++;
    expect(performance.now() - started).toBeLessThan(tokenBounds.fileMs + 1000);
    expect(plain).toBeGreaterThan(0);
  });
});
