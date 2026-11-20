import { describe, expect, it } from "vitest";
import { createHeldKeyGate, type GatedKey } from "./held-keys.ts";

const down = (repeat: boolean): GatedKey => ({ type: "keydown", repeat });
const up: GatedKey = { type: "keyup", repeat: false };

describe("createHeldKeyGate", () => {
  it("drops a key held from before the terminal took focus until a fresh press", () => {
    const gate = createHeldKeyGate();
    gate.focused();
    expect([down(true), down(true), up].map((key) => gate.allows(key))).toEqual([
      false,
      false,
      true,
    ]);
    expect([down(false), down(true), down(true)].map((key) => gate.allows(key))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("drops held keys again after every new focus", () => {
    const gate = createHeldKeyGate();
    expect(gate.allows(down(true))).toBe(true);
    gate.focused();
    expect(gate.allows(down(true))).toBe(false);
    expect(gate.allows(down(false))).toBe(true);
    gate.focused();
    expect(gate.allows({ type: "keypress", repeat: true })).toBe(false);
    expect(gate.allows(down(true))).toBe(false);
  });
});
