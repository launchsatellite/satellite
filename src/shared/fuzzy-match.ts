const wordBreaks = new Set([" ", "-", "_", "/", "."]);
const defaultLimit = 50;

function letters(query: string): string {
  return query.replace(/\s+/g, "").toLowerCase();
}

export function fuzzyScore(query: string, text: string): number | undefined {
  const wanted = letters(query);
  const haystack = text.toLowerCase();
  let score = 0;
  let previous = -1;
  let first = -1;
  for (const letter of wanted) {
    const index = haystack.indexOf(letter, previous + 1);
    if (index === -1) return undefined;
    score += 1;
    if (previous !== -1 && index === previous + 1) score += 3;
    if (index === 0 || wordBreaks.has(haystack.charAt(index - 1))) score += 2;
    if (first === -1) first = index;
    previous = index;
  }
  const skipped = first === -1 ? 0 : previous - first + 1 - wanted.length;
  return score - skipped / 10;
}

export function rankMatches<T>(
  query: string,
  items: readonly T[],
  textOf: (item: T) => string,
  limit = defaultLimit,
): T[] {
  if (letters(query) === "") return items.slice(0, limit);
  return items
    .flatMap((item) => {
      const score = fuzzyScore(query, textOf(item));
      return score === undefined ? [] : [{ item, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
