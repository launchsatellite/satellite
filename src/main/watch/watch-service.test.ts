import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BridgeOwner } from "../bridge/registry.ts";
import type { WatcherNews } from "./watch-plan.ts";
import { createWatch, type WatcherChild } from "./watch-service.ts";

function fakeChild() {
  let news: (each: WatcherNews) => void = () => undefined;
  let exit: () => void = () => undefined;
  const posted: string[][] = [];
  const child: WatcherChild = {
    post: (roots) => posted.push(roots),
    onNews: (listener) => {
      news = listener;
    },
    onExit: (listener) => {
      exit = listener;
    },
    kill: () => undefined,
  };
  return {
    child,
    posted,
    tell: (each: WatcherNews) => {
      news(each);
    },
    exit: () => {
      exit();
    },
  };
}

function clock() {
  let at = 0;
  const timers: { due: number; run: () => void }[] = [];
  return {
    now: () => at,
    after: (ms: number, run: () => void) => {
      const timer = { due: at + ms, run };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
    advance(ms: number) {
      at += ms;
      for (const timer of timers.filter((each) => each.due <= at)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
    },
  };
}

function page() {
  const emitted: unknown[] = [];
  const owner: BridgeOwner = {
    id: 1,
    emit: (_event, payload) => {
      emitted.push(payload);
    },
    onGone: () => undefined,
  };
  return { owner, emitted };
}

const a = randomUUID();
const b = randomUUID();
const projects = [
  { id: a, path: "/code/a", workspaces: [] },
  { id: b, path: "/code/b", workspaces: [] },
];

describe("createWatch", () => {
  it("tells pages which projects changed, at most once a second, and which are live", async () => {
    const time = clock();
    const first = fakeChild();
    const watch = createWatch({ fork: () => first.child, ...time });
    const { owner, emitted } = page();
    expect(await watch.handlers["watch.start"]({}, owner)).toEqual({ live: [] });
    watch.watchProjects(projects);
    expect(first.posted).toEqual([["/code/a", "/code/b"]]);
    first.tell({ kind: "watching", root: "/code/a" });
    first.tell({ kind: "watching", root: "/code/b" });
    time.advance(150);
    expect(emitted.at(-1)).toEqual({ changed: [a, b].sort(), live: [a, b].sort() });
    first.tell({ kind: "changed", root: "/code/a" });
    time.advance(150);
    expect(emitted).toHaveLength(1);
    time.advance(850);
    expect(emitted.at(-1)).toEqual({ changed: [a], live: [a, b].sort() });
    first.tell({ kind: "error", root: "/code/b" });
    time.advance(1000);
    expect(emitted.at(-1)).toEqual({ changed: [b], live: [a] });
  });

  it("starts the watcher again after it dies, with nothing live meanwhile", () => {
    const time = clock();
    const first = fakeChild();
    const second = fakeChild();
    let made = 0;
    const watch = createWatch({
      fork: () => {
        made += 1;
        return made === 1 ? first.child : second.child;
      },
      ...time,
    });
    const { owner, emitted } = page();
    void watch.handlers["watch.start"]({}, owner);
    watch.watchProjects(projects.slice(0, 1));
    first.tell({ kind: "watching", root: "/code/a" });
    time.advance(1000);
    first.exit();
    time.advance(1000);
    expect(emitted.at(-1)).toEqual({ changed: [], live: [] });
    time.advance(5000);
    expect(made).toBe(2);
    expect(second.posted).toEqual([["/code/a"]]);
    first.tell({ kind: "watching", root: "/code/a" });
    time.advance(1000);
    expect(emitted.at(-1)).toEqual({ changed: [], live: [] });
  });
});
