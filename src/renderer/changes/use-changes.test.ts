import { describe, expect, it } from "vitest";
import { nextSteps, pollDelay } from "./use-changes.ts";

describe("change list poll", () => {
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
