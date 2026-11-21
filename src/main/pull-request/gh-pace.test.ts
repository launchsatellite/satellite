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
});
