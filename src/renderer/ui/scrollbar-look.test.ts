import { describe, expect, it } from "vitest";
import { thumbColours } from "./scrollbar-look.ts";

describe("thumbColours", () => {
  it("lays the three strengths on a six digit text colour and refuses any other form", () => {
    expect(thumbColours("#ededea")).toEqual({
      rest: "#ededea33",
      hover: "#ededea59",
      drag: "#ededea80",
    });
    for (const shortened of ["#fff", "white", "#ededea80", "rgb(237 237 234)"]) {
      expect(() => thumbColours(shortened), shortened).toThrow();
    }
  });
});
