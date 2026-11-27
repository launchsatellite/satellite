import { existsSync } from "node:fs";
import watcher, { type AsyncSubscription, type BackendType } from "@parcel/watcher";
import { z } from "zod";
import { forcedBackend, retryDelay, steadyMs, type WatcherNews } from "./watch-plan.ts";

interface Watched {
  key: string;
  root: string;
  made: Promise<AsyncSubscription | undefined>;
  over: boolean;
}

const plan = z
  .array(
    z.strictObject({
      root: z.string().min(1).max(4096),
      ignore: z.array(z.string().min(1).max(4096)).max(200),
    }),
  )
  .max(12_000);
const parent = process.parentPort;
const backend: BackendType | undefined = forcedBackend(process.platform);
const live = new Map<string, Watched>();
const failures = new Map<string, number>();
const waiting = new Set<string>();
let wanted = new Map<string, string[]>();

function tell(news: WatcherNews): void {
  parent.postMessage(news);
}

function end(watched: Watched): void {
  watched.over = true;
  if (live.get(watched.root) === watched) live.delete(watched.root);
  void watched.made.then((made) => made?.unsubscribe()).catch(() => undefined);
}

function startWanted(root: string): void {
  const ignore = wanted.get(root);
  if (ignore !== undefined && !live.has(root) && !waiting.has(root)) start(root, ignore);
}

function failed(watched: Watched): void {
  if (watched.over) return;
  end(watched);
  tell({ kind: "error", root: watched.root });
  const count = (failures.get(watched.root) ?? 0) + 1;
  failures.set(watched.root, count);
  waiting.add(watched.root);
  setTimeout(() => {
    waiting.delete(watched.root);
    startWanted(watched.root);
  }, retryDelay(count));
}

function start(root: string, ignore: string[]): void {
  const watched: Watched = {
    key: JSON.stringify(ignore),
    root,
    made: Promise.resolve(undefined),
    over: false,
  };
  live.set(root, watched);
  watched.made = watcher
    .subscribe(
      root,
      (error, events) => {
        try {
          if (error !== null || events.some((event) => event.path === root)) failed(watched);
          else if (events.length > 0 && !watched.over) tell({ kind: "changed", root });
        } catch {
          failed(watched);
        }
      },
      { backend, ignore },
    )
    .then(
      (made) => {
        if (watched.over) {
          void made.unsubscribe().catch(() => undefined);
          return undefined;
        }
        tell({ kind: "watching", root });
        setTimeout(() => {
          if (!watched.over) failures.delete(root);
        }, steadyMs);
        return made;
      },
      () => {
        failed(watched);
        return undefined;
      },
    );
}

setInterval(() => {
  for (const watched of [...live.values()]) if (!existsSync(watched.root)) failed(watched);
}, steadyMs);

parent.on("message", ({ data }: { data: unknown }) => {
  if (backend === undefined) return;
  const parsed = plan.safeParse(data);
  if (!parsed.success) return;
  wanted = new Map(parsed.data.map(({ root, ignore }) => [root, ignore]));
  for (const watched of [...live.values()]) {
    const ignore = wanted.get(watched.root);
    if (ignore === undefined || JSON.stringify(ignore) !== watched.key) end(watched);
  }
  for (const root of wanted.keys()) startWanted(root);
});
