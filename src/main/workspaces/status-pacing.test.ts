import { describe, expect, it, vi } from "vitest";
import { keptAnswerMs, mayReuse, nextRead, pacedStatus } from "./status-pacing.ts";

const counted = { entries: [{ code: " M", path: "a" }], raw: " M a\0" };

describe("status pacing", () => {
  it("reuses an answer for four times as long as it took, so a fast repository reads every time", () => {
    const slow = { status: counted, finishedAt: 10_000, elapsedMs: 3000, answeredAt: 10_000 };
    expect(mayReuse(slow, 21_999)).toBe(true);
    expect(mayReuse(slow, 22_000)).toBe(false);
    expect(mayReuse({ ...slow, elapsedMs: 40 }, 10_200)).toBe(false);
    expect(mayReuse(undefined, 0)).toBe(false);
  });

  it("keeps the last count through a read that failed, for a bounded time", () => {
    const last = nextRead(undefined, counted, 0, 3000);
    expect(nextRead(last, undefined, 3000, 8000).status).toBe(counted);
    expect(nextRead(last, undefined, 3000, 3000 + keptAnswerMs).status).toBeUndefined();
    expect(nextRead(undefined, undefined, 0, 5000).status).toBeUndefined();
  });

  it("starts no second read of a slow folder inside its pace", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const read = vi.fn(() => {
      now += 2000;
      return Promise.resolve(counted);
    });
    const folder = `/paced/${String(Math.random())}`;
    expect(await pacedStatus(folder, read)).toBe(counted);
    now += 5000;
    expect(await pacedStatus(folder, read)).toBe(counted);
    expect(read).toHaveBeenCalledTimes(1);
    now += 4000;
    await pacedStatus(folder, read);
    expect(read).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
