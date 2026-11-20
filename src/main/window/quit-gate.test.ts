import { describe, expect, it, vi } from "vitest";
import { createQuitGate } from "./quit-gate.ts";

describe("createQuitGate", () => {
  it("holds every quit until the one wait settles, then lets the last quit through", async () => {
    const settling = Promise.withResolvers<undefined>();
    const settle = vi.fn(() => settling.promise);
    const quit = vi.fn();
    const gate = createQuitGate(settle, quit);
    const quitEvent = () => {
      const event = { preventDefault: vi.fn() };
      gate(event);
      return event.preventDefault.mock.calls.length > 0;
    };
    expect(quitEvent()).toBe(true);
    expect(quitEvent()).toBe(true);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
    settling.resolve(undefined);
    await vi.waitFor(() => {
      expect(quit).toHaveBeenCalledTimes(1);
    });
    expect(quitEvent()).toBe(false);
  });
});
