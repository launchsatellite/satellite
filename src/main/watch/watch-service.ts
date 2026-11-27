import type { BridgeHandlers, BridgeOwner } from "../bridge/registry.ts";
import type { StoredProject } from "../projects/projects-file.ts";
import {
  plannedRoots,
  retryDelay,
  steadyMs,
  type PlannedRoot,
  type WatcherNews,
} from "./watch-plan.ts";

export interface WatcherChild {
  post(plan: { root: string; ignore: string[] }[]): void;
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
  let roots = new Map<string, PlannedRoot>();
  const watching = new Set<string>();
  const pending = new Set<string>();
  let child: WatcherChild | undefined;
  let restarts = 0;
  let stopped = false;
  let lastFlush = Number.NEGATIVE_INFINITY;
  let cancelFlush: (() => void) | undefined;
  let told = "";

  const liveProjects = (): string[] => {
    const all = new Set([...roots.values()].flatMap(({ ids }) => [...ids]));
    for (const [root, { ids }] of roots) {
      if (!watching.has(root)) for (const id of ids) all.delete(id);
    }
    return [...all].sort();
  };

  const flush = () => {
    cancelFlush = undefined;
    lastFlush = now();
    const planned = new Set([...roots.values()].flatMap(({ ids }) => [...ids]));
    const changed = [...pending].filter((id) => planned.has(id)).sort();
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

  const plan = () => [...roots].map(([root, { ignore }]) => ({ root, ignore }));

  const lose = (root: string) => {
    if (!watching.delete(root)) return;
    for (const id of roots.get(root)?.ids ?? []) pending.add(id);
  };

  const onNews = (news: WatcherNews, from: WatcherChild) => {
    const planned = roots.get(news.root);
    if (planned === undefined) return;
    if (news.kind === "watching") {
      watching.add(news.root);
      after(steadyMs, () => {
        if (child === from) restarts = 0;
      });
    } else if (news.kind === "error") lose(news.root);
    for (const id of planned.ids) pending.add(id);
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
      if (child === made) onNews(news, made);
    });
    made.onExit(() => {
      if (child !== made) return;
      child = undefined;
      for (const root of [...watching]) lose(root);
      schedule();
      restart();
    });
    made.post(plan());
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
      const before = roots;
      roots = plannedRoots(projects);
      for (const root of [...watching]) {
        const was = before.get(root);
        const now = roots.get(root);
        if (now === undefined) {
          for (const id of was?.ids ?? []) pending.add(id);
          watching.delete(root);
        } else if (JSON.stringify(now.ignore) !== JSON.stringify(was?.ignore)) lose(root);
      }
      if (child === undefined && restarts === 0) start();
      else child?.post(plan());
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
