import { describe, expect, it } from "vitest";
import { createPace } from "./gh-pace.ts";

function clock() {
  let time = 0;
  const sleeping: { until: number; wake: () => void }[] = [];
  return {
    now: () => time,
    after: (ms: number) =>
      new Promise<void>((wake) => {
        sleeping.push({ until: time + ms, wake });
      }),
    advance(ms: number) {
      time += ms;
      for (const sleeper of sleeping.splice(0)) {
        if (sleeper.until <= time) sleeper.wake();
        else sleeping.push(sleeper);
      }
    },
  };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createPace", () => {
  it("runs one at a time and starts two seconds apart", async () => {
    const time = clock();
    const pace = createPace(time);
    const starts: number[] = [];
    const finish: (() => void)[] = [];
    const job = () => {
      starts.push(time.now());
      return new Promise<void>((resolve) => finish.push(resolve));
    };
    const answers = [pace.run(job), pace.run(job), pace.run(job)];
    await settled();
    expect(starts).toEqual([0]);
    finish[0]?.();
    await settled();
    expect(starts).toEqual([0]);
    time.advance(1999);
    await settled();
    expect(starts).toEqual([0]);
    time.advance(1);
    await settled();
    expect(starts).toEqual([0, 2000]);
    time.advance(5000);
    finish[1]?.();
    await settled();
    expect(starts).toEqual([0, 2000, 7000]);
    finish[2]?.();
    await Promise.all(answers);
  });

  it("refuses the 201st waiting read", async () => {
    const time = clock();
    const pace = createPace(time);
    const hold = Promise.withResolvers<undefined>();
    const first = pace.run(() => hold.promise);
    await settled();
    const waiting = Array.from({ length: 200 }, () => pace.run(() => Promise.resolve()));
    await expect(pace.run(() => Promise.resolve())).rejects.toMatchObject({ code: "limit" });
    hold.resolve(undefined);
    await first;
    for (let step = 0; step < 200; step += 1) {
      await settled();
      time.advance(2000);
    }
    await Promise.all(waiting);
    const again = pace.run(() => Promise.resolve());
    await settled();
    time.advance(2000);
    await expect(again).resolves.toBeUndefined();
  });

  it("pauses for fifteen minutes and then runs again", () => {
    const time = clock();
    const pace = createPace(time);
    expect(pace.paused()).toBe(false);
    pace.pause();
    expect(pace.paused()).toBe(true);
    time.advance(899_999);
    expect(pace.paused()).toBe(true);
    time.advance(1);
    expect(pace.paused()).toBe(false);
  });

  it("lets an aborted waiting run leave at once without costing a gap", async () => {
    const time = clock();
    const pace = createPace(time);
    const starts: string[] = [];
    const named = (name: string) => () => {
      starts.push(`${name}@${String(time.now())}`);
      return Promise.resolve();
    };
    const hold = Promise.withResolvers<undefined>();
    const first = pace.run(() => hold.promise);
    await settled();
    const controller = new AbortController();
    const aborted = pace.run(named("aborted"), { signal: controller.signal });
    const third = pace.run(named("third"));
    controller.abort(new Error("archived"));
    await expect(aborted).rejects.toThrow("archived");
    hold.resolve(undefined);
    await first;
    await settled();
    time.advance(2000);
    await third;
    expect(starts).toEqual(["third@2000"]);
    const already = new AbortController();
    already.abort(new Error("late"));
    await expect(pace.run(named("never"), { signal: already.signal })).rejects.toThrow("late");
  });

  it("keeps logs to a small bound and serves every read before them", async () => {
    const time = clock();
    const pace = createPace(time);
    const order: string[] = [];
    const hold = Promise.withResolvers<undefined>();
    const running = pace.run(() => hold.promise, { lane: "log", owner: "a" });
    await settled();
    const log = (name: string, owner: string) =>
      pace.run(
        () => {
          order.push(`${name}@${String(time.now())}`);
          return Promise.resolve();
        },
        { lane: "log", owner },
      );
    const queuedLogs = [log("a1", "a"), log("a2", "a"), log("b1", "b"), log("b2", "b")];
    await expect(log("a3", "a")).rejects.toMatchObject({ code: "limit" });
    await expect(log("c1", "c")).rejects.toMatchObject({ code: "limit" });
    const read = pace.run(
      () => {
        order.push(`read@${String(time.now())}`);
        return Promise.resolve();
      },
      { lane: "read" },
    );
    hold.resolve(undefined);
    await running;
    for (let step = 0; step < 6; step += 1) {
      await settled();
      time.advance(2000);
    }
    await Promise.all([read, ...queuedLogs]);
    expect(order).toEqual(["read@2000", "a1@4000", "a2@6000", "b1@8000", "b2@10000"]);
  });

  it("never waits more than one gap when the clock steps back", async () => {
    const time = clock();
    let shown = 100_000;
    const pace = createPace({ now: () => shown + time.now(), after: time.after });
    await pace.run(() => Promise.resolve());
    shown = 0;
    const next = pace.run(() => Promise.resolve());
    await settled();
    time.advance(2000);
    await expect(next).resolves.toBeUndefined();
  });

  it("keeps the first pause when a second one is asked", () => {
    const time = clock();
    const pace = createPace(time);
    pace.pause();
    time.advance(600_000);
    pace.pause();
    time.advance(300_000);
    expect(pace.paused()).toBe(false);
  });
});
