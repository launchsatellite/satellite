import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutputFlow, outputFlowLimits } from "./output-flow.ts";

const { chunkChars, highWater, lowWater, flushMs } = outputFlowLimits;

function flow() {
  const sink = { emit: vi.fn<(chunk: string) => void>(), pause: vi.fn(), resume: vi.fn() };
  return { sink, output: createOutputFlow(sink) };
}

function emitted(sink: ReturnType<typeof flow>["sink"]): string {
  return sink.emit.mock.calls.map(([chunk]) => chunk).join("");
}

describe("createOutputFlow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces small writes into one event after a short interval", () => {
    const { sink, output } = flow();
    output.push("a");
    output.push("b");
    expect(sink.emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(flushMs);
    expect(sink.emit.mock.calls).toEqual([["ab"]]);
  });

  it("never emits a chunk over the limit and never splits a surrogate pair", () => {
    const { sink, output } = flow();
    const text = `${"x".repeat(chunkChars - 1)}😀${"y".repeat(chunkChars)}`;
    output.push(text);
    vi.advanceTimersByTime(flushMs);
    for (const [chunk] of sink.emit.mock.calls) {
      expect(chunk.length).toBeLessThanOrEqual(chunkChars);
      expect(chunk.charCodeAt(chunk.length - 1)).not.toBe(0xd83d);
    }
    expect(emitted(sink)).toBe(text);
  });

  it("pauses above the high mark and resumes once acks bring it under the low mark", () => {
    const { sink, output } = flow();
    const chunk = "z".repeat(chunkChars);
    let sent = 0;
    while (sent <= highWater) {
      output.push(chunk);
      sent += chunk.length;
    }
    vi.advanceTimersByTime(flushMs);
    expect(sink.pause).toHaveBeenCalledTimes(1);
    output.ack(sent - lowWater - 1);
    expect(sink.resume).not.toHaveBeenCalled();
    output.ack(1);
    expect(sink.resume).toHaveBeenCalledTimes(1);
  });

  it("clamps an ack larger than the output still outstanding", () => {
    const { sink, output } = flow();
    output.push("abc");
    vi.advanceTimersByTime(flushMs);
    output.ack(1_000_000);
    const chunk = "z".repeat(chunkChars);
    let sent = 0;
    while (sent <= highWater) {
      output.push(chunk);
      sent += chunk.length;
    }
    vi.advanceTimersByTime(flushMs);
    expect(sink.pause).toHaveBeenCalledTimes(1);
  });

  it("resumes a paused terminal when stopped, so a dead owner never blocks cleanup", () => {
    const { sink, output } = flow();
    output.push("z".repeat(highWater + 1));
    vi.advanceTimersByTime(flushMs);
    expect(sink.pause).toHaveBeenCalledTimes(1);
    output.stop();
    expect(sink.resume).toHaveBeenCalledTimes(1);
    const before = sink.emit.mock.calls.length;
    output.push("late");
    vi.advanceTimersByTime(flushMs);
    expect(sink.emit.mock.calls.length).toBe(before);
  });

  it("delivers what is still pending when the terminal ends on its own", () => {
    const { sink, output } = flow();
    output.push("last words");
    output.finish();
    expect(emitted(sink)).toBe("last words");
  });
});
