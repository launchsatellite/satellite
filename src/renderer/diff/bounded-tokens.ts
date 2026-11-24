import { EncodedTokenMetadata, INITIAL, type StateStack } from "shiki/textmate";

export interface LineTokenizer {
  tokenizeLine2(
    line: string,
    stack: StateStack | null,
    limitMs?: number,
  ): { tokens: Uint32Array; ruleStack: StateStack; stoppedEarly: boolean };
}

export type LineTokens = [startIndex: number, scope: string][] | null;

export const tokenBounds = {
  stopBetweenScansMs: 4,
  sliceMs: 25,
  fileMs: 1000,
};

const warmUpLines = [
  "import x from 'y'; // comment",
  'export const a = { b: [1, 2.5, "s", `t ${u}`], c: (d) => d * 2 }; /* block */',
  "def f(self, *args, **kw): return None  # note",
  "#include <stdio.h>",
  "int main(void) { if (a < b && c > d) { return 0; } else { x->y = z::w; } }",
  "<div class=\"row\" id='x'>text &amp; more</div>",
  "@media (max-width: 10px) { .a > b:hover { color: #fff; } }",
  "# Title",
  "- item **bold** _em_ [link](http://x) `code`",
  "SELECT a, b FROM t WHERE c = 'd' AND e > 1;",
  "$var = @(1, 2); function F { param($p) }",
  "let x: Vec<i32> = vec![1]; fn g<'a>(s: &'a str) -> Option<&'a str> { None }",
];

const fontStyleBits: [number, string][] = [
  [1, "italic"],
  [2, "bold"],
  [4, "underline"],
  [8, "strikethrough"],
];

function fontStyleOf(bits: number): string {
  return fontStyleBits
    .filter(([bit]) => (bits & bit) !== 0)
    .map(([, style]) => style)
    .join(" ");
}

export function warmUp(grammar: LineTokenizer): void {
  let stack: StateStack = INITIAL;
  for (const line of warmUpLines) stack = grammar.tokenizeLine2(line, stack).ruleStack;
}

export function fileTokenizer(
  grammar: LineTokenizer,
  colourMap: readonly string[],
  scopeOf: (colour: string, fontStyle: string) => string,
  longestLine: number,
): (line: string) => LineTokens {
  let stack: StateStack = INITIAL;
  let spentMs = 0;
  return (line) => {
    if (line.length > longestLine || spentMs >= tokenBounds.fileMs) return null;
    const started = performance.now();
    const result = grammar.tokenizeLine2(line, stack, tokenBounds.stopBetweenScansMs);
    spentMs += performance.now() - started;
    if (!result.stoppedEarly) stack = result.ruleStack;
    const tokens: [number, string][] = [];
    for (let at = 0; at < result.tokens.length; at += 2) {
      const metadata = result.tokens[at + 1] ?? 0;
      const colour = colourMap[EncodedTokenMetadata.getForeground(metadata)] ?? "";
      const fontStyle = fontStyleOf(EncodedTokenMetadata.getFontStyle(metadata));
      tokens.push([result.tokens[at] ?? 0, colour === "" ? "" : scopeOf(colour, fontStyle)]);
    }
    return tokens;
  };
}
