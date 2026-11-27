import { describe, expect, it } from "vitest";
import { createSchedule, nextSteps, pollDelay, type ScheduleAnswer } from "./refresh-schedule.ts";

describe("refresh delay", () => {
  it("waits 2 seconds after a quick list", () => {
    expect(pollDelay(0, 0)).toBe(2000);
    expect(pollDelay(120, 0)).toBe(2000);
    expect(pollDelay(500, 0)).toBe(2000);
  });

  it("waits four times as long as a slow list took, up to 30 seconds", () => {
    expect(pollDelay(1500, 0)).toBe(6000);
    expect(pollDelay(7500, 0)).toBe(30_000);
    expect(pollDelay(15_000, 0)).toBe(30_000);
    expect(pollDelay(Number.MAX_VALUE, 0)).toBe(30_000);
  });

  it("doubles the wait for each list in a row that failed, up to 30 seconds", () => {
    expect([1, 2, 3, 4, 5, 1100].map((failures) => pollDelay(10, failures))).toEqual([
      4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
    expect(pollDelay(3000, 1)).toBe(12_000);
  });

  it("doubles the wait for each list in a row that came back the same, and resets on a change", () => {
    let steps = 0;
    const waits: number[] = [];
    for (let list = 0; list < 6; list += 1) {
      waits.push(pollDelay(10, steps));
      steps = nextSteps(steps, true, false);
    }
    expect(waits).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000]);
    expect(nextSteps(steps, true, true)).toBe(0);
    expect(nextSteps(3, false, true)).toBe(4);
  });
});

describe("refresh pace", () => {
  it("takes a pace and keeps the default", () => {
    const slow = { firstMs: 30_000, maxMs: 300_000, factor: 4 };
    expect(pollDelay(100, 0, slow)).toBe(30_000);
    expect(pollDelay(100, 2, slow)).toBe(120_000);
    expect(pollDelay(100, 9, slow)).toBe(300_000);
    expect(pollDelay(20_000, 0, slow)).toBe(80_000);
    expect(pollDelay(100, 0)).toBe(2000);
    expect(pollDelay(100, 9)).toBe(30_000);
  });

  it("waits the pace's first delay after a calm", async () => {
    const waits: number[] = [];
    const schedule = createSchedule(
      {
        visible: () => true,
        now: () => 0,
        read: () => Promise.resolve({ files: true, key: "a" }),
        after: (ms) => {
          waits.push(ms);
          return () => undefined;
        },
      },
      { firstMs: 30_000, maxMs: 300_000, factor: 4 },
    );
    schedule.start();
    await Promise.resolve();
    await Promise.resolve();
    schedule.calm();
    expect(waits).toEqual([30_000, 30_000]);
  });
});

function harness() {
  const reads: { at: number; settle: (answer: ScheduleAnswer) => void }[] = [];
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  const state = { clock: 0, visible: true, focused: true, reads, timers };
  const schedule = createSchedule({
    visible: () => state.visible,
    focused: () => state.focused,
    now: () => state.clock,
    read: () =>
      new Promise((settle) => {
        state.reads.push({ at: state.clock, settle });
      }),
    after: (ms, run) => {
      const timer = { at: state.clock + ms, run, live: true };
      state.timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  const answer = async (files: boolean, key: string) => {
    state.reads.at(-1)?.settle({ files, key });
    await Promise.resolve();
    await Promise.resolve();
  };
  const next = () => state.timers.findLast((timer) => timer.live)?.at;
  const wait = (ms: number) => {
    state.clock += ms;
    for (const timer of state.timers) {
      if (timer.live && timer.at <= state.clock) {
        timer.live = false;
        timer.run();
      }
    }
  };
  return { state, schedule, answer, next, wait };
}

describe("refresh schedule", () => {
  it("reads soon after watch news, but never sooner than four times the last read", async () => {
    const { state, schedule, answer, next } = harness();
    schedule.start();
    state.clock = 500;
    await answer(true, "a");
    state.clock = 600;
    schedule.nudge();
    expect(next()).toBe(600 + 1900);
    state.clock = 2500;
    state.timers.at(-1)?.run();
    expect(state.reads).toHaveLength(2);
    schedule.nudge();
    expect(state.reads).toHaveLength(2);
  });

  it("doubles after lists that come back the same and starts over on a change", async () => {
    const { state, schedule, answer, next } = harness();
    schedule.start();
    await answer(true, "a");
    expect(next()).toBe(2000);
    state.clock = 2000;
    state.timers.at(-1)?.run();
    await answer(true, "a");
    expect(next()).toBe(2000 + 4000);
    state.clock = 6000;
    state.timers.at(-1)?.run();
    await answer(true, "b");
    expect(next()).toBe(6000 + 2000);
  });

  it("lets the idle wait grow to 2 minutes while the window is not focused", async () => {
    const { state, schedule, answer, next, wait } = harness();
    state.focused = false;
    schedule.start();
    const waits: number[] = [];
    for (let list = 0; list < 7; list += 1) {
      await answer(true, "same");
      const at = next() ?? 0;
      waits.push(at - state.clock);
      wait(at - state.clock);
    }
    expect(waits).toEqual([2000, 4000, 8000, 16_000, 32_000, 64_000, 120_000]);
    state.focused = true;
    await answer(true, "same");
    expect((next() ?? 0) - state.clock).toBe(30_000);
  });

  it("counts an answer without a file list as a step even when it differs", async () => {
    const { schedule, answer, next } = harness();
    schedule.start();
    await answer(false, "a");
    expect(next()).toBe(4000);
  });

  it("starts nothing while hidden, and a hidden window clears the timer", async () => {
    const { state, schedule, answer, next, wait } = harness();
    schedule.start();
    await answer(true, "a");
    schedule.hide();
    wait(60_000);
    expect(state.reads).toHaveLength(1);
    state.visible = false;
    schedule.refresh();
    expect(state.reads).toHaveLength(1);
    state.visible = true;
    schedule.refresh();
    expect(state.reads).toHaveLength(2);
    await answer(true, "a");
    expect(next()).toBe(state.clock + 2000);
  });

  it("never runs two reads at once and asks once more after the first lands", async () => {
    const { state, schedule, answer } = harness();
    schedule.start();
    schedule.refresh();
    schedule.refresh();
    expect(state.reads).toHaveLength(1);
    await answer(true, "a");
    expect(state.reads).toHaveLength(2);
    await answer(true, "a");
    expect(state.reads).toHaveLength(2);
  });

  it("asks at once on a focus or session event and resets the doubling", async () => {
    const { state, schedule, answer, next } = harness();
    schedule.start();
    await answer(true, "a");
    state.clock = 2000;
    state.timers.at(-1)?.run();
    await answer(true, "a");
    state.clock = 6000;
    state.timers.at(-1)?.run();
    await answer(true, "a");
    expect(next()).toBe(6000 + 8000);
    schedule.refresh();
    expect(state.reads).toHaveLength(4);
    await answer(true, "a");
    expect(next()).toBe(6000 + 2000);
  });

  it("moves a waiting timer back to the floor when the shown file changes", async () => {
    const { state, schedule, answer, next } = harness();
    schedule.start();
    await answer(true, "a");
    state.clock = 2000;
    state.timers.at(-1)?.run();
    await answer(true, "a");
    expect(next()).toBe(6000);
    state.clock = 3000;
    schedule.calm();
    expect(next()).toBe(5000);
  });

  it("starts nothing after it stops, and drops a read that lands after", async () => {
    const { state, schedule, answer, wait } = harness();
    schedule.start();
    schedule.stop();
    await answer(true, "a");
    wait(60_000);
    schedule.refresh();
    expect(state.reads).toHaveLength(1);
  });
});
