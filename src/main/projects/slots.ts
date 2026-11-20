export type Slot = <T>(work: () => Promise<T>) => Promise<T>;

export function createSlots(size: number): Slot {
  let free = size;
  const waiting: (() => void)[] = [];
  return async (work) => {
    if (free > 0) free -= 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next === undefined) free += 1;
      else next();
    }
  };
}
