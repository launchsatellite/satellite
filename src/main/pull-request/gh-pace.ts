import { BridgeFailure } from "../bridge/registry.ts";

export type Lane = "read" | "log";

export interface RunOptions {
  signal?: AbortSignal;
  lane?: Lane;
  owner?: string;
}

export interface Pace {
  run<T>(work: () => Promise<T>, options?: RunOptions): Promise<T>;
  pause(): void;
  paused(): boolean;
}

interface PaceOptions {
  now: () => number;
  after: (ms: number) => Promise<void>;
  gapMs?: number;
  pauseMs?: number;
  waiting?: number;
  logsWaiting?: number;
  logsPerOwner?: number;
}

interface Entry {
  lane: Lane;
  owner: string;
  start: () => Promise<void>;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

const tooMany = "Satellite is reading too many pull requests at once. Try again shortly.";

export function createPace({
  now,
  after,
  gapMs = 2000,
  pauseMs = 900_000,
  waiting = 200,
  logsWaiting = 4,
  logsPerOwner = 2,
}: PaceOptions): Pace {
  const queue: Entry[] = [];
  let busy = false;
  let lastStart: number | undefined;
  let pausedUntil: number | undefined;

  const paused = () => pausedUntil !== undefined && now() < pausedUntil;

  const pick = (): Entry | undefined => {
    const entry = queue.find((one) => one.lane === "read") ?? queue[0];
    if (entry !== undefined) queue.splice(queue.indexOf(entry), 1);
    return entry;
  };

  const pump = async () => {
    if (busy) return;
    busy = true;
    try {
      while (queue.length > 0) {
        const early = lastStart === undefined ? 0 : Math.min(gapMs, lastStart + gapMs - now());
        if (early > 0) await after(early);
        const entry = pick();
        if (entry === undefined) continue;
        lastStart = now();
        await entry.start();
      }
    } finally {
      busy = false;
    }
  };

  const refuseIfFull = (lane: Lane, owner: string) => {
    const same = queue.filter((entry) => entry.lane === lane);
    const full =
      lane === "read"
        ? same.length >= waiting
        : same.length >= logsWaiting ||
          same.filter((entry) => entry.owner === owner).length >= logsPerOwner;
    if (full) throw new BridgeFailure("limit", tooMany);
  };

  return {
    async run(work, { signal, lane = "read", owner = "" } = {}) {
      signal?.throwIfAborted();
      refuseIfFull(lane, owner);
      return new Promise((resolve, reject) => {
        const entry: Entry = {
          lane,
          owner,
          start: async () => {
            try {
              resolve(await work());
            } catch (error) {
              reject(asError(error));
            }
          },
        };
        queue.push(entry);
        signal?.addEventListener(
          "abort",
          () => {
            const at = queue.indexOf(entry);
            if (at === -1) return;
            queue.splice(at, 1);
            reject(asError(signal.reason));
          },
          { once: true },
        );
        void pump();
      });
    },
    pause() {
      if (!paused()) pausedUntil = now() + pauseMs;
    },
    paused,
  };
}
