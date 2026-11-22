import { BridgeFailure } from "../bridge/registry.ts";

export type Lane = "read" | "log";

export interface RunOptions {
  signal?: AbortSignal;
  lane?: Lane;
  asked?: boolean;
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
  asked: boolean;
  start: () => Promise<void>;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

const kinds = ["log", "asked", "background"] as const;
type Kind = (typeof kinds)[number];

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
  const lastStart = new Map<Kind, number>();
  let wake: (() => void) | undefined;
  let pausedUntil: number | undefined;

  const paused = () => pausedUntil !== undefined && now() < pausedUntil;
  const kindOf = (entry: Entry): Kind =>
    entry.lane === "log" ? "log" : entry.asked ? "asked" : "background";

  const waitOf = (entry: Entry): number => {
    const last = lastStart.get(kindOf(entry));
    return last === undefined ? 0 : Math.min(gapMs, last + gapMs - now());
  };

  const pump = async () => {
    if (busy) return;
    busy = true;
    try {
      while (queue.length > 0) {
        const firsts = kinds
          .map((kind) => queue.find((entry) => kindOf(entry) === kind))
          .filter((entry) => entry !== undefined);
        const [entry] = firsts.sort((one, other) => waitOf(one) - waitOf(other));
        if (entry === undefined) continue;
        const early = waitOf(entry);
        if (early > 0) {
          const woken = new Promise<"woken">((resolve) => {
            wake = () => {
              resolve("woken");
            };
          });
          const ended = await Promise.race([after(early).then(() => "slept" as const), woken]);
          wake = undefined;
          if (ended === "woken" || !queue.includes(entry)) continue;
        }
        queue.splice(queue.indexOf(entry), 1);
        lastStart.set(kindOf(entry), now());
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
    async run(work, { signal, lane = "read", owner = "", asked = false } = {}) {
      signal?.throwIfAborted();
      refuseIfFull(lane, owner);
      return new Promise((resolve, reject) => {
        const entry: Entry = {
          lane,
          owner,
          asked,
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
        if (lane === "log" || asked) wake?.();
        void pump();
      });
    },
    pause() {
      if (!paused()) pausedUntil = now() + pauseMs;
    },
    paused,
  };
}
