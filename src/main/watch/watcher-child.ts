import { join } from "node:path";
import { app, utilityProcess } from "electron";
import { z } from "zod";
import { forcedBackend } from "./watch-plan.ts";
import type { WatcherChild } from "./watch-service.ts";

const news = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("watching"), root: z.string().min(1).max(4096) }),
  z.strictObject({ kind: z.literal("changed"), root: z.string().min(1).max(4096) }),
  z.strictObject({ kind: z.literal("error"), root: z.string().min(1).max(4096) }),
]);

export function forkWatcher(): WatcherChild {
  if (!app.isReady()) throw new Error("Satellite isn't ready to watch folders yet.");
  if (forcedBackend(process.platform) === undefined) throw new Error("No folder watcher here.");
  const child = utilityProcess.fork(join(import.meta.dirname, "watcher-process.js"), [], {
    serviceName: "Satellite folder watcher",
    stdio: "ignore",
  });
  let spawned = false;
  let waiting: { root: string; ignore: string[] }[] | undefined;
  child.once("spawn", () => {
    spawned = true;
    if (waiting !== undefined) child.postMessage(waiting);
    waiting = undefined;
  });
  return {
    post: (plan) => {
      if (spawned) child.postMessage(plan);
      else waiting = plan;
    },
    onNews: (listener) => {
      child.on("message", (message: unknown) => {
        const parsed = news.safeParse(message);
        if (parsed.success) listener(parsed.data);
      });
    },
    onExit: (listener) => {
      child.on("exit", listener);
    },
    kill: () => {
      child.kill();
    },
  };
}
