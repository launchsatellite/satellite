import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { silenceWatch } from "./silence-watch.ts";

describe("silenceWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends a worker that only ever receives requests", () => {
    const silent = vi.fn();
    const watch = silenceWatch(5000, silent);
    for (let at = 0; at < 5; at += 1) {
      watch.sent();
      vi.advanceTimersByTime(1000);
    }
    expect(silent).toHaveBeenCalledOnce();
  });

  it("renews only when the worker replies with work still pending", () => {
    const silent = vi.fn();
    const watch = silenceWatch(5000, silent);
    watch.sent();
    vi.advanceTimersByTime(4000);
    watch.heard(true);
    vi.advanceTimersByTime(4000);
    expect(silent).not.toHaveBeenCalled();
    watch.heard(false);
    vi.advanceTimersByTime(10000);
    expect(silent).not.toHaveBeenCalled();
  });

  it("leaves no old deadline to end the next worker once stopped", () => {
    const silent = vi.fn();
    const watch = silenceWatch(5000, silent);
    watch.sent();
    vi.advanceTimersByTime(3000);
    watch.stop();
    watch.sent();
    vi.advanceTimersByTime(3000);
    expect(silent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(silent).toHaveBeenCalledOnce();
  });
});
