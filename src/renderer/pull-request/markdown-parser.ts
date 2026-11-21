import type { Root } from "hast";
import { boundedTree, longestDrawn } from "./markdown-tree.ts";

export type Parsed = { kind: "tree"; tree: Root } | { kind: "plain" };

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

const plain: Parsed = { kind: "plain" };
const reserve = 64;
const smallBody = 4000;
const missBudget = 3;

export function createMarkdownParser(
  spawn: (handlers: WorkerHandlers) => ParseWorker,
  deadlineMs: number,
) {
  const parsed = new Map<string, Parsed>();
  const missed = new Map<string, Parsed>();
  let misses = 0;
  const wants = new Map<string, string>();
  const listeners = new Set<() => void>();
  let idle: ParseWorker | null = null;
  let running: Running | null = null;

  const settle = (text: string, answer: Parsed, retry: "no" | "miss" | "skip" = "no") => {
    if (retry === "skip" || (retry === "miss" && text.length <= smallBody)) {
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
    const text = [...wants.values()].find((want) => !parsed.has(want) && !missed.has(want));
    if (text === undefined) {
      misses = 0;
      return;
    }
    if (misses >= missBudget) {
      settle(text, plain, "skip");
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
          settle(current.text, tree !== null && boundedTree(tree) ? { kind: "tree", tree } : plain);
          pump();
        },
        fail: () => {
          const current = running;
          if (current?.worker !== worker) return;
          clearTimeout(current.timer);
          current.worker.stop();
          running = null;
          idle = null;
          settle(current.text, plain, "miss");
          pump();
        },
      });
    idle = null;
    const timer = setTimeout(() => {
      worker.stop();
      running = null;
      misses += 1;
      settle(text, plain, "miss");
      pump();
    }, deadlineMs);
    running = { text, worker, timer };
    worker.post(text);
  };

  return {
    read: (text: string): Parsed | undefined => {
      return text.length > longestDrawn ? plain : (parsed.get(text) ?? missed.get(text));
    },
    want: (owner: string, text: string): void => {
      wants.set(owner, text);
      pump();
    },
    drop: (owner: string): void => {
      wants.delete(owner);
      const wanted = new Set(wants.values());
      for (const text of missed.keys()) if (!wanted.has(text)) missed.delete(text);
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
