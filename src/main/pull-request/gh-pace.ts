import { BridgeFailure } from "../bridge/registry.ts";

export interface Pace {
  run<T>(work: () => Promise<T>): Promise<T>;
  pause(): void;
  paused(): boolean;
}

interface PaceOptions {
  now: () => number;
  after: (ms: number) => Promise<void>;
  gapMs?: number;
  pauseMs?: number;
  waiting?: number;
}

const tooMany = "Satellite is reading too many pull requests at once. Try again shortly.";

export function createPace({
  now,
  after,
  gapMs = 2000,
  pauseMs = 900_000,
  waiting = 200,
}: PaceOptions): Pace {
  let tail: Promise<undefined> = Promise.resolve(undefined);
  let queued = 0;
  let lastStart: number | undefined;
  let pausedUntil: number | undefined;
  return {
    async run(work) {
      if (queued >= waiting) throw new BridgeFailure("limit", tooMany);
      queued += 1;
      const previous = tail;
      const turn = Promise.withResolvers<undefined>();
      tail = turn.promise;
      await previous;
      queued -= 1;
      try {
        const early = lastStart === undefined ? 0 : lastStart + gapMs - now();
        if (early > 0) await after(early);
        lastStart = now();
        return await work();
      } finally {
        turn.resolve(undefined);
      }
    },
    pause() {
      pausedUntil = now() + pauseMs;
    },
    paused() {
      return pausedUntil !== undefined && now() < pausedUntil;
    },
  };
}
