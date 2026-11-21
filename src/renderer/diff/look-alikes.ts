export interface ColumnRange {
  start: number;
  end: number;
}

const word = /[\p{L}\p{M}\p{N}_$]+/gu;
const latin = /\p{sc=Latin}/u;
const otherLetter = /(?!\p{sc=Latin})\p{L}/u;

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
