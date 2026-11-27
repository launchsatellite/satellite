import { invoke, subscribe } from "./bridge-client.ts";

type Listener = (changed: ReadonlySet<string>) => void;

const listeners = new Set<Listener>();
let live = new Set<string>();
let started = false;

function start(): void {
  if (started) return;
  started = true;
  subscribe("watch.changed", ({ changed, live: watched }) => {
    live = new Set(watched);
    const ids = new Set(changed);
    for (const listener of listeners) listener(ids);
  });
  void invoke("watch.start", {}).then((result) => {
    if (result.ok) live = new Set(result.value.live);
  });
}

export function isWatched(projectIds: readonly string[]): boolean {
  return projectIds.length > 0 && projectIds.every((id) => live.has(id));
}

export function onWatchedChange(listener: Listener): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
