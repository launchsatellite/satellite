import type { Root } from "hast";
import { boundedTree, longestDrawn } from "./markdown-tree.ts";

export type PlainWhy = "large" | "slow" | "skipped";
export type Parsed = { kind: "tree"; tree: Root } | { kind: "plain"; why: PlainWhy };

export interface ParseWorker {
  post: (text: string) => void;
  stop: () => void;
}
export interface WorkerHandlers {
  reply: (tree: Root | null) => void;
  fail: () => void;
}
interface Running {
  text: string;
  worker: ParseWorker;
  timer: ReturnType<typeof setTimeout>;
}

const large: Parsed = { kind: "plain", why: "large" };
const slow: Parsed = { kind: "plain", why: "slow" };
const skippedAnswer: Parsed = { kind: "plain", why: "skipped" };
const reserve = 64;
const smallBody = 4000;
const missBudget = 3;

export function createMarkdownParser(
  spawn: (handlers: WorkerHandlers) => ParseWorker,
  deadlineMs: number,
) {
  const parsed = new Map<string, Parsed>();
  const missed = new Map<string, Parsed>();
  const skipped = new Set<string>();
  let misses = 0;
  const wants = new Map<string, string>();
  const listeners = new Set<() => void>();
  let idle: ParseWorker | null = null;
  let running: Running | null = null;

  const settle = (text: string, answer: Parsed, retry: "no" | "miss" | "skip" = "no") => {
    if (retry === "skip") {
      skipped.add(text);
    } else if (retry === "miss" && text.length <= smallBody) {
      missed.set(text, answer);
    } else {
      parsed.delete(text);
      parsed.set(text, answer);
      const wanted = new Set(wants.values());
      for (const oldest of parsed.keys()) {
        if (parsed.size <= reserve) break;
        if (!wanted.has(oldest)) parsed.delete(oldest);
      }
    }
    for (const listener of listeners) listener();
  };

  const pump = (): void => {
    if (running !== null) return;
    const text = [...wants.values()].find(
      (want) => !parsed.has(want) && !missed.has(want) && !skipped.has(want),
    );
    if (text === undefined) {
      misses = 0;
      if (skipped.size > 0) {
        skipped.clear();
        for (const listener of listeners) listener();
        pump();
      }
      return;
    }
    if (misses >= missBudget) {
      settle(text, skippedAnswer, "skip");
      pump();
      return;
    }
    const worker =
      idle ??
      spawn({
        reply: (tree) => {
          const current = running;
          if (current?.worker !== worker) return;
          clearTimeout(current.timer);
          running = null;
          idle = current.worker;
          settle(current.text, tree !== null && boundedTree(tree) ? { kind: "tree", tree } : large);
          pump();
        },
        fail: () => {
          const current = running;
          if (current?.worker !== worker) return;
          clearTimeout(current.timer);
          current.worker.stop();
          running = null;
          idle = null;
          settle(current.text, slow, "miss");
          pump();
        },
      });
    idle = null;
    const timer = setTimeout(() => {
      worker.stop();
      running = null;
      misses += 1;
      settle(text, slow, "miss");
      pump();
    }, deadlineMs);
    running = { text, worker, timer };
    worker.post(text);
  };

  return {
    read: (text: string): Parsed | undefined => {
      if (text.length > longestDrawn) return large;
      return (
        parsed.get(text) ?? missed.get(text) ?? (skipped.has(text) ? skippedAnswer : undefined)
      );
    },
    want: (owner: string, text: string): void => {
      wants.set(owner, text);
      pump();
    },
    drop: (owner: string): void => {
      wants.delete(owner);
      const wanted = new Set(wants.values());
      for (const text of missed.keys()) if (!wanted.has(text)) missed.delete(text);
      for (const text of skipped) if (!wanted.has(text)) skipped.delete(text);
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop: (): void => {
      if (running !== null) clearTimeout(running.timer);
      running?.worker.stop();
      idle?.stop();
      running = null;
      idle = null;
    },
  };
}
