import { BridgeFailure } from "../bridge/registry.ts";

type ReadQueue = <T>(signal: AbortSignal, work: () => Promise<T>) => Promise<T>;

const queueFull = "Satellite is reading a lot of changes at once. It tries again in a moment.";

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error("The read was stopped");
}

export function createReadQueue(
  size: number,
  waitLimit: number,
  fullSentence: string = queueFull,
): ReadQueue {
  let free = size;
  const waiting: (() => void)[] = [];
  const turn = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", leave);
        resolve();
      };
      const leave = () => {
        const at = waiting.indexOf(start);
        if (at === -1) return;
        waiting.splice(at, 1);
        reject(abortReason(signal));
      };
      waiting.push(start);
      signal.addEventListener("abort", leave, { once: true });
    });
  return async (signal, work) => {
    signal.throwIfAborted();
    if (free > 0) free -= 1;
    else if (waiting.length >= waitLimit) throw new BridgeFailure("limit", fullSentence);
    else await turn(signal);
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      const next = waiting.shift();
      if (next === undefined) free += 1;
      else next();
    }
  };
}
