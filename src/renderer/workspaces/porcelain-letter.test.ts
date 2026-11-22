import { describe, expect, it } from "vitest";
import { porcelainLetter } from "./porcelain-letter.ts";

describe("porcelainLetter", () => {
  it("names each git status code with the letter the Changes list draws", () => {
    const codes = ["??", " M", "MM", "AM", " D", "D ", "R ", "RM", " T", "UU", "AA", "DD"];
    expect(codes.map(porcelainLetter)).toEqual([
      "A",
      "M",
      "M",
      "A",
      "D",
      "D",
      "R",
      "R",
      "T",
      "U",
      "U",
      "U",
    ]);
  });
});
