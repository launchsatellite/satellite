import { describe, expect, it } from "vitest";
import { mostUrgent, pixelOf } from "./session-pixel.ts";

describe("session pixel", () => {
  it("draws each status as its pixel", () => {
    expect(pixelOf("idle")).toBe("idle");
    expect(pixelOf("working")).toBe("working");
    expect(pixelOf("needs-you")).toBe("needs-you");
    expect(pixelOf("done")).toBe("done");
    expect(pixelOf("stopped")).toBe("idle");
  });

  it("shows the most urgent session of a workspace", () => {
    expect(mostUrgent([])).toBe("idle");
    expect(mostUrgent(["stopped", "done"])).toBe("done");
    expect(mostUrgent(["idle", "stopped"])).toBe("idle");
    expect(mostUrgent(["done", "working", "idle"])).toBe("working");
    expect(mostUrgent(["working", "needs-you", "done"])).toBe("needs-you");
  });
});
