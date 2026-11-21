import { describe, expect, it } from "vitest";
import { lookAlikeColumns } from "./look-alikes.ts";

describe("lookAlikeColumns", () => {
  it("marks a letter of another script hidden inside a Latin word", () => {
    expect(lookAlikeColumns("const p\u{430}ypal = load(\u{43e}k);")).toEqual([
      { start: 8, end: 9 },
      { start: 21, end: 22 },
    ]);
    expect(lookAlikeColumns("if (us\u{435}r.isAdmin) return")).toEqual([{ start: 7, end: 8 }]);
  });

  it("leaves words written in one script alone, Latin with accents included", () => {
    expect(
      lookAlikeColumns("caf\u{e9} \u{43f}\u{440}\u{438}\u{432}\u{435}\u{442} na\u{ef}ve"),
    ).toEqual([]);
    expect(lookAlikeColumns(`// ${"\u{436}".repeat(1000)}`)).toEqual([]);
  });
});
