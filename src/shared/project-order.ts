export function movedBefore<T extends { id: string }>(
  items: readonly T[],
  id: string,
  before: string | null,
): T[] | undefined {
  const moved = items.find((item) => item.id === id);
  if (moved === undefined) return undefined;
  const rest = items.filter((item) => item.id !== id);
  if (before === null) return [...rest, moved];
  const at = rest.findIndex((item) => item.id === before);
  if (at === -1) return undefined;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}
