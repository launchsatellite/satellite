import watcher, { type AsyncSubscription, type BackendType } from "@parcel/watcher";
import { z } from "zod";
import { forcedBackend, ignoredInRoot, retryDelay, type WatcherNews } from "./watch-plan.ts";

const roots = z.array(z.string().min(1).max(4096)).max(1000);
const parent = process.parentPort;
const backend: BackendType | undefined = forcedBackend(process.platform);
const live = new Map<string, Promise<AsyncSubscription | undefined>>();
const failures = new Map<string, number>();
let wanted = new Set<string>();

function tell(news: WatcherNews): void {
  parent.postMessage(news);
}

async function drop(root: string): Promise<void> {
  const subscription = live.get(root);
  live.delete(root);
  await (await subscription)?.unsubscribe().catch(() => undefined);
}

function failed(root: string): void {
  tell({ kind: "error", root });
  const count = (failures.get(root) ?? 0) + 1;
  failures.set(root, count);
  void drop(root).then(() => {
    setTimeout(() => {
      if (wanted.has(root) && !live.has(root)) start(root);
    }, retryDelay(count));
  });
}

function start(root: string): void {
  const subscription = watcher
    .subscribe(
      root,
      (error, events) => {
        try {
          if (error !== null || events.some((event) => event.path === root)) failed(root);
          else if (events.length > 0) tell({ kind: "changed", root });
        } catch {
          failed(root);
        }
      },
      { backend, ignore: ignoredInRoot },
    )
    .then(
      (made) => {
        failures.delete(root);
        tell({ kind: "watching", root });
        return made;
      },
      () => {
        failed(root);
        return undefined;
      },
    );
  live.set(root, subscription);
}

parent.on("message", ({ data }: { data: unknown }) => {
  if (backend === undefined) return;
  const parsed = roots.safeParse(data);
  if (!parsed.success) return;
  wanted = new Set(parsed.data);
  for (const root of [...live.keys()]) if (!wanted.has(root)) void drop(root);
  for (const root of wanted) if (!live.has(root)) start(root);
});
