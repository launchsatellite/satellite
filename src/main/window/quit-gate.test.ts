import { describe, expect, it, vi } from "vitest";
import { createQuitGate } from "./quit-gate.ts";

function held(gate: (event: { preventDefault(): void }) => void): boolean {
  const event = { preventDefault: vi.fn() };
  gate(event);
  return event.preventDefault.mock.calls.length > 0;
}

describe("createQuitGate", () => {
  it("holds every quit until the one wait settles, then lets the last quit through", async () => {
    const settling = Promise.withResolvers<undefined>();
    const settle = vi.fn(() => settling.promise);
    const quit = vi.fn();
    const gate = createQuitGate(() => Promise.resolve(true), settle, quit);
    expect(held(gate)).toBe(true);
    await vi.waitFor(() => {
      expect(settle).toHaveBeenCalledTimes(1);
    });
    expect(held(gate)).toBe(true);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
    settling.resolve(undefined);
    await vi.waitFor(() => {
      expect(quit).toHaveBeenCalledTimes(1);
    });
    expect(held(gate)).toBe(false);
  });

  it("asks once while the question is open and stays open when the answer is no", async () => {
    const answer = Promise.withResolvers<boolean>();
    const ask = vi.fn(() => answer.promise);
    const settle = vi.fn(() => Promise.resolve());
    const quit = vi.fn();
    const gate = createQuitGate(ask, settle, quit);
    expect(held(gate)).toBe(true);
    expect(held(gate)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    answer.resolve(false);
    await answer.promise;
    await Promise.resolve();
    expect(held(gate)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(settle).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });
});
