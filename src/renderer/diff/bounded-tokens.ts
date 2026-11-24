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
  lineLimitMs: 4,
  sliceMs: 25,
  fileMs: 1000,
  compileMs: 1500,
};

export interface CompileAllowance {
  ms: number;
}

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

export function fileTokenizer(
  grammar: LineTokenizer,
  colourMap: readonly string[],
  scopeOf: (colour: string, fontStyle: string) => string,
  longestLine: number,
  allowance: CompileAllowance,
): (line: string) => LineTokens {
  let stack: StateStack = INITIAL;
  let spentMs = 0;
  return (line) => {
    if (line.length > longestLine || spentMs >= tokenBounds.fileMs) return null;
    const started = performance.now();
    let result = grammar.tokenizeLine2(line, stack, tokenBounds.lineLimitMs);
    while (result.stoppedEarly && allowance.ms > 0) {
      const retried = performance.now();
      result = grammar.tokenizeLine2(line, stack, tokenBounds.lineLimitMs);
      allowance.ms -= performance.now() - retried;
    }
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
