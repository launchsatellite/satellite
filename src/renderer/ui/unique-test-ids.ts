export function withUniqueTestIds<T extends { testId: string }>(items: readonly T[]): T[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const count = (seen.get(item.testId) ?? 0) + 1;
    seen.set(item.testId, count);
    return count === 1 ? item : { ...item, testId: `${item.testId}-${String(count)}` };
  });
}
