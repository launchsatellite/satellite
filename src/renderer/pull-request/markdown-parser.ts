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
const kept = 64;

export function createMarkdownParser(
  spawn: (handlers: WorkerHandlers) => ParseWorker,
  deadlineMs: number,
) {
  const parsed = new Map<string, Parsed>();
  const wants = new Map<string, string>();
  const listeners = new Set<() => void>();
  let idle: ParseWorker | null = null;
  let running: Running | null = null;

  const settle = (text: string, answer: Parsed) => {
    parsed.delete(text);
    parsed.set(text, answer);
    for (const oldest of parsed.keys()) {
      if (parsed.size <= kept) break;
      parsed.delete(oldest);
    }
    for (const listener of listeners) listener();
  };

  const pump = (): void => {
    if (running !== null) return;
    const text = [...wants.values()].find((want) => !parsed.has(want));
    if (text === undefined) return;
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
          settle(current.text, plain);
          pump();
        },
      });
    idle = null;
    const timer = setTimeout(() => {
      worker.stop();
      running = null;
      settle(text, plain);
      pump();
    }, deadlineMs);
    running = { text, worker, timer };
    worker.post(text);
  };

  return {
    read: (text: string): Parsed | undefined => {
      return text.length > longestDrawn ? plain : parsed.get(text);
    },
    want: (owner: string, text: string): void => {
      wants.set(owner, text);
      pump();
    },
    drop: (owner: string): void => {
      wants.delete(owner);
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
