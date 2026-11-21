import { describe, expect, it } from "vitest";
import { BridgeFailure } from "../bridge/registry.ts";
import { createReadQueue } from "./read-queue.ts";

function held() {
  const { promise, resolve } = Promise.withResolvers<string>();
  let started = false;
  return {
    work: () => {
      started = true;
      return promise;
    },
    started: () => started,
    finish: resolve,
  };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createReadQueue", () => {
  it("runs no more reads than its slots and starts the next when one ends", async () => {
    const queue = createReadQueue(2, 4);
    const reads = [held(), held(), held()];
    const answers = reads.map((read) => queue(new AbortController().signal, read.work));
    await settled();
    expect(reads.map((read) => read.started())).toEqual([true, true, false]);
    reads[0]?.finish("first");
    expect(await answers[0]).toBe("first");
    await settled();
    expect(reads[2]?.started()).toBe(true);
    reads[1]?.finish("second");
    reads[2]?.finish("third");
    expect(await Promise.all(answers)).toEqual(["first", "second", "third"]);
  });

  it("drops an aborted read from the queue without it ever taking a slot", async () => {
    const queue = createReadQueue(1, 4);
    const running = held();
    const waiting = held();
    const after = held();
    const first = queue(new AbortController().signal, running.work);
    const controller = new AbortController();
    const dropped = queue(controller.signal, waiting.work);
    const third = queue(new AbortController().signal, after.work);
    const moved = new BridgeFailure("refused", "Satellite moved on to a newer read.");
    controller.abort(moved);
    await expect(dropped).rejects.toBe(moved);
    running.finish("running");
    await first;
    await settled();
    expect(waiting.started()).toBe(false);
    expect(after.started()).toBe(true);
    after.finish("after");
    expect(await third).toBe("after");
    const aborted = new AbortController();
    aborted.abort(moved);
    await expect(queue(aborted.signal, waiting.work)).rejects.toBe(moved);
    expect(waiting.started()).toBe(false);
  });

  it("refuses a read once its queue is full, and frees the slot of a read that failed", async () => {
    const queue = createReadQueue(1, 1);
    const running = held();
    const first = queue(new AbortController().signal, running.work);
    const second = queue(new AbortController().signal, () => Promise.reject(new Error("broke")));
    await expect(queue(new AbortController().signal, held().work)).rejects.toMatchObject({
      code: "limit",
    });
    running.finish("done");
    expect(await first).toBe("done");
    await expect(second).rejects.toThrow("broke");
    expect(await queue(new AbortController().signal, () => Promise.resolve("free"))).toBe("free");
  });
});
