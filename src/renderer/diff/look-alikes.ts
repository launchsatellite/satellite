export interface ColumnRange {
  start: number;
  end: number;
}

const word = /[\p{L}\p{M}\p{N}_$]+/gu;
const latin = /\p{sc=Latin}/u;
const otherLetter = /(?!\p{sc=Latin})\p{L}/u;
const token = /[\p{L}\p{M}\p{N}_$]+|[^\s\p{L}\p{M}\p{N}_$]/gu;
const basicAscii = /[\t\x20-\x7e]/;
const beyondAscii = /[^\t\x20-\x7e]/;

export function lookAlikeColumns(line: string): ColumnRange[] {
  const ranges: ColumnRange[] = [];
  for (const found of line.matchAll(word)) {
    const text = found[0];
    if (!latin.test(text) || !otherLetter.test(text)) continue;
    let offset = found.index;
    for (const character of text) {
      if (otherLetter.test(character)) {
        ranges.push({ start: offset + 1, end: offset + 1 + character.length });
      }
      offset += character.length;
    }
  }
  return ranges;
}

export function confusableColumns(
  line: string,
  isAmbiguous: (codePoint: number) => boolean,
): ColumnRange[] {
  const ranges: ColumnRange[] = [];
  for (const found of line.matchAll(token)) {
    const text = found[0];
    if (!beyondAscii.test(text)) continue;
    const characters = Array.from(text);
    const ambiguous = (character: string) => isAmbiguous(character.codePointAt(0) ?? 0);
    const foreignWord =
      !basicAscii.test(text) &&
      characters.some((character) => beyondAscii.test(character) && !ambiguous(character));
    if (foreignWord) continue;
    let offset = found.index;
    for (const character of characters) {
      if (ambiguous(character)) {
        ranges.push({ start: offset + 1, end: offset + 1 + character.length });
      }
      offset += character.length;
    }
  }
  return ranges;
}
