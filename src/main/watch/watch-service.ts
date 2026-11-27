import type { BridgeHandlers, BridgeOwner } from "../bridge/registry.ts";
import type { StoredProject } from "../projects/projects-file.ts";
import { plannedRoots, retryDelay, type WatcherNews } from "./watch-plan.ts";

export interface WatcherChild {
  post(roots: string[]): void;
  onNews(listener: (news: WatcherNews) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

interface WatchOptions {
  fork: () => WatcherChild;
  after?: (ms: number, run: () => void) => () => void;
  now?: () => number;
}

export interface Watch {
  handlers: Pick<BridgeHandlers, "watch.start">;
  watchProjects(projects: readonly StoredProject[]): void;
  stop(): void;
}

const gapMs = 1000;
const settleMs = 150;

function timer(ms: number, run: () => void): () => void {
  const handle = setTimeout(run, ms);
  return () => {
    clearTimeout(handle);
  };
}

export function createWatch({ fork, after = timer, now = Date.now }: WatchOptions): Watch {
  const pages = new Set<BridgeOwner>();
  let roots = new Map<string, Set<string>>();
  const watching = new Set<string>();
  const pending = new Set<string>();
  let child: WatcherChild | undefined;
  let restarts = 0;
  let stopped = false;
  let lastFlush = Number.NEGATIVE_INFINITY;
  let cancelFlush: (() => void) | undefined;
  let told = "";

  const liveProjects = (): string[] => {
    const all = new Set([...roots.values()].flatMap((ids) => [...ids]));
    for (const [root, ids] of roots) {
      if (!watching.has(root)) for (const id of ids) all.delete(id);
    }
    return [...all].sort();
  };

  const flush = () => {
    cancelFlush = undefined;
    lastFlush = now();
    const changed = [...pending].sort();
    pending.clear();
    const live = liveProjects();
    const signature = JSON.stringify(live);
    if (changed.length === 0 && signature === told) return;
    told = signature;
    for (const page of pages) page.emit("watch.changed", { changed, live });
  };

  const schedule = () => {
    if (cancelFlush !== undefined) return;
    cancelFlush = after(Math.max(settleMs, lastFlush + gapMs - now()), flush);
  };

  const onNews = (news: WatcherNews) => {
    const ids = roots.get(news.root);
    if (ids === undefined) return;
    if (news.kind === "watching") {
      watching.add(news.root);
      restarts = 0;
    } else if (news.kind === "error") watching.delete(news.root);
    for (const id of ids) pending.add(id);
    schedule();
  };

  const start = () => {
    if (stopped) return;
    let made: WatcherChild;
    try {
      made = fork();
    } catch {
      restart();
      return;
    }
    child = made;
    made.onNews((news) => {
      if (child === made) onNews(news);
    });
    made.onExit(() => {
      if (child !== made) return;
      child = undefined;
      watching.clear();
      schedule();
      restart();
    });
    made.post([...roots.keys()]);
  };

  const restart = () => {
    restarts += 1;
    after(retryDelay(restarts), start);
  };

  return {
    handlers: {
      "watch.start": (_request, owner) => {
        if (!pages.has(owner)) {
          pages.add(owner);
          owner.onGone(() => {
            pages.delete(owner);
          });
        }
        return Promise.resolve({ live: liveProjects() });
      },
    },
    watchProjects(projects) {
      roots = plannedRoots(projects);
      for (const root of [...watching]) if (!roots.has(root)) watching.delete(root);
      if (child === undefined && restarts === 0) start();
      else child?.post([...roots.keys()]);
      schedule();
    },
    stop() {
      stopped = true;
      cancelFlush?.();
      const ending = child;
      child = undefined;
      ending?.kill();
    },
  };
}
