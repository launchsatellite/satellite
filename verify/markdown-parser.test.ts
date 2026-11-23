import type { Element, Root } from "hast";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMarkdownParser,
  type Parsed,
  type ParseWorker,
  type WorkerHandlers,
} from "../src/renderer/pull-request/markdown-parser.ts";

const deadlineMs = 500;
const patientMs = 5000;
const thread = new URL("./markdown-test-thread.ts", import.meta.url);
const parsers: ReturnType<typeof createMarkdownParser>[] = [];
const started: Worker[] = [];

function spawnThread({ reply, fail }: WorkerHandlers): ParseWorker {
  const worker = new Worker(thread);
  started.push(worker);
  worker.on("message", reply);
  worker.on("error", fail);
  return {
    post: (text) => {
      worker.postMessage(text);
    },
    stop: () => {
      void worker.terminate();
    },
  };
}

function parserOver(spawn = spawnThread, deadline = deadlineMs) {
  const parser = createMarkdownParser(spawn, deadline);
  parsers.push(parser);
  return parser;
}

function answer(parser: ReturnType<typeof createMarkdownParser>, text: string, owner = "view") {
  return new Promise<Parsed>((resolve) => {
    const settled = () => {
      const parsed = parser.read(text);
      if (parsed !== undefined) resolve(parsed);
    };
    parser.subscribe(settled);
    parser.want(owner, text);
    settled();
  });
}

async function beating<T>(work: Promise<T>): Promise<{ value: T; longestGap: number }> {
  let longestGap = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    longestGap = Math.max(longestGap, now - last);
    last = now;
  }, 10);
  try {
    return { value: await work, longestGap };
  } finally {
    clearInterval(timer);
  }
}

afterEach(async () => {
  for (const parser of parsers.splice(0)) parser.stop();
  await Promise.all(started.splice(0).map((worker) => worker.terminate()));
});

describe("the Markdown parser", { timeout: 60_000 }, () => {
  it("draws a hostile body as plain text by the deadline and never blocks the page", async () => {
    const shapes = [
      "- -\n",
      "+ +\n",
      "+ + + a\n",
      "1. 1. a\n",
      "*_",
      "*a_",
      "a\n---\n",
      "[a](",
      "> ",
    ];
    for (const shape of shapes) {
      const text = shape.repeat(Math.ceil(20_000 / shape.length)).slice(0, 20_000);
      const parser = parserOver();
      const began = performance.now();
      const { value, longestGap } = await beating(answer(parser, text));
      const took = performance.now() - began;
      expect(took, shape).toBeLessThan(deadlineMs + 700);
      expect(longestGap, shape).toBeLessThan(250);
      if (value.kind === "tree") expect(took, shape).toBeLessThan(deadlineMs);
    }
  });

  it("gives up on a worker that never answers and tries the next body with a fresh one", async () => {
    let spawned = 0;
    const silent = (handlers: WorkerHandlers): ParseWorker =>
      spawned++ === 0 ? { post: () => undefined, stop: () => undefined } : spawnThread(handlers);
    const parser = parserOver(silent);
    const first = answer(parser, "# one", "first");
    const second = answer(parser, "# two", "second");
    expect(await first).toEqual({ kind: "plain", why: "slow" });
    expect((await second).kind).toBe("tree");
    expect(spawned).toBe(2);
  });

  it("draws ordinary long documents as Markdown inside the deadline", async () => {
    const tasks = Array.from({ length: 100 }, (_, at) => `- [ ] **task ${String(at)}** \`code\``);
    const changelog = Array.from(
      { length: 150 },
      (_, at) =>
        `* **fix(scope_${String(at)}):** a change ([#${String(at)}](https://example.invalid/${String(at)}))`,
    );
    const rows = Array.from(
      { length: 300 },
      (_, at) => `| **${String(at)}** | \`x\` | [l](https://example.invalid/${String(at)}) |`,
    );
    const table = ["| a | b | c |", "| - | - | - |", ...rows];
    const parser = parserOver();
    for (const lines of [tasks, changelog, table]) {
      const text = lines.join("\n");
      expect(text.length).toBeLessThan(20_000);
      expect((await answer(parser, text)).kind).toBe("tree");
    }
  });

  it("keeps the newest body of a view and skips the one it replaced", async () => {
    const asked: string[] = [];
    const parser = parserOver((handlers) => {
      const real = spawnThread(handlers);
      return {
        post: (text) => {
          asked.push(text);
          real.post(text);
        },
        stop: real.stop,
      };
    });
    const busy = answer(parser, "# busy", "other");
    void answer(parser, "# old", "view");
    const newest = answer(parser, "# new", "view");
    await busy;
    await newest;
    expect(asked).toEqual(["# busy", "# new"]);
  });

  it("answers plain for a body past the size guard without starting a worker", () => {
    let spawned = 0;
    const parser = parserOver(() => {
      spawned += 1;
      return { post: () => undefined, stop: () => undefined };
    });
    expect(parser.read("x".repeat(20_001))).toEqual({ kind: "plain", why: "large" });
    expect(spawned).toBe(0);
  });

  it("refuses a tree that is too big or too deep", async () => {
    let reply: WorkerHandlers["reply"] = () => undefined;
    const parser = parserOver((handlers) => {
      reply = handlers.reply;
      return { post: () => undefined, stop: () => undefined };
    });
    const waiting = answer(parser, "x");
    let deep: Element = { type: "element", tagName: "div", properties: {}, children: [] };
    for (let at = 0; at < 100; at += 1) {
      deep = { type: "element", tagName: "div", properties: {}, children: [deep] };
    }
    const tree: Root = { type: "root", children: [deep] };
    reply(tree);
    expect(await waiting).toEqual({ kind: "plain", why: "large" });
  });

  it("parses each of a hundred mounted bodies once and then goes idle", async () => {
    const posts: string[] = [];
    const parser = parserOver((handlers) => {
      const real = spawnThread(handlers);
      return {
        post: (text) => {
          posts.push(text);
          real.post(text);
        },
        stop: real.stop,
      };
    }, patientMs);
    const texts = Array.from({ length: 100 }, (_, at) => `# body ${String(at)}`);
    await Promise.all(texts.map((text, at) => answer(parser, text, `owner-${String(at)}`)));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(posts).toHaveLength(100);
    for (const text of texts) expect(parser.read(text)?.kind).toBe("tree");
  });

  it("skips the rest while bodies keep missing the deadline and parses them once the burst is over", async () => {
    const hostile = Array.from({ length: 10 }, (_, at) =>
      `${"*_".repeat(9000)}${String(at)}`.slice(0, 19_000),
    );
    const ordinary = Array.from({ length: 5 }, (_, at) => `# fine ${String(at)}`);
    const posts: string[] = [];
    const parser = parserOver((handlers) => {
      const real = spawnThread(handlers);
      return {
        post: (text) => {
          posts.push(text);
          real.post(text);
        },
        stop: real.stop,
      };
    });
    const seen: string[] = [];
    parser.subscribe(() => {
      const shown = parser.read(ordinary[0] ?? "");
      if (shown?.kind === "plain") seen.push(shown.why);
    });
    const began = performance.now();
    await Promise.all(
      [...hostile, ...ordinary].map((text, at) => answer(parser, text, `owner-${String(at)}`)),
    );
    expect(performance.now() - began).toBeLessThan(3 * (deadlineMs + 700) + 1000);
    expect(seen).toContain("skipped");
    const until = performance.now() + 30_000;
    while (
      !ordinary.every((text) => parser.read(text)?.kind === "tree") &&
      performance.now() < until
    ) {
      ordinary.forEach((text, at) => {
        if (parser.read(text)?.kind !== "plain") return;
        const owner = `owner-${String(hostile.length + at)}`;
        parser.drop(owner);
        parser.want(owner, text);
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (const text of ordinary) expect(parser.read(text)?.kind).toBe("tree");
    for (const text of hostile) expect(parser.read(text)).toMatchObject({ kind: "plain" });
  });

  it("tries a small body that missed the deadline again when it is opened again", async () => {
    const posts: string[] = [];
    const parser = parserOver(() => ({
      post: (text) => posts.push(text),
      stop: () => undefined,
    }));
    expect(await answer(parser, "# one", "view")).toEqual({ kind: "plain", why: "slow" });
    parser.drop("view");
    expect(parser.read("# one")).toBeUndefined();
    void answer(parser, "# one", "view");
    expect(posts).toEqual(["# one", "# one"]);
  });
});
