import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import dracula from "shiki/themes/dracula.mjs";
import { fileTokenizer, warmUp } from "../src/renderer/diff/bounded-tokens.ts";
import { grammars } from "../src/renderer/diff/syntax-grammars.ts";

const units = ["_", "$", "a", "1", " ", "\t", "<", "~", "a.", "#", "(", "{", "\\", "-"];
const prefixes = ["", "x = ", "# ", "/* ", '"', "`"];
const ends = ["!", "x", "e", '"'];
const runs = 3;

const highlighter = await createHighlighterCore({
  themes: [dracula],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});
const { colorMap } = highlighter.setTheme("dracula");

for (const [language, grammar] of Object.entries(grammars)) {
  if (grammar === undefined) continue;
  const { default: registrations } = await grammar.load();
  await highlighter.loadLanguage(...registrations);
  const loaded = highlighter.getLanguage(registrations.at(-1)?.name ?? language);
  warmUp(loaded);
  let worst = { ms: 0, line: "" };
  for (const prefix of prefixes)
    for (const unit of units)
      for (const end of ends) {
        const body = (prefix + unit.repeat(grammar.longestLine)).slice(
          0,
          grammar.longestLine - end.length,
        );
        const line = body + end;
        let fastest = Number.POSITIVE_INFINITY;
        for (let run = 0; run < runs; run++) {
          const next = fileTokenizer(loaded, colorMap, () => "", grammar.longestLine);
          const started = performance.now();
          next(line);
          fastest = Math.min(fastest, performance.now() - started);
        }
        if (fastest > worst.ms) worst = { ms: fastest, line };
      }
  console.log(
    `${language} longest ${String(grammar.longestLine)} worst ${worst.ms.toFixed(1)} ms ${JSON.stringify(worst.line.slice(0, 12))}`,
  );
}
