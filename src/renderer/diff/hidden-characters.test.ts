import { InvisibleCharacters } from "monaco-editor/base/common/strings";
import { describe, expect, it } from "vitest";
import { visibleLines } from "../../shared/visible-text.ts";

describe("hidden characters in the diff", () => {
  it("reveals every character the editor's own list calls invisible", () => {
    const kept = new Set([0x20, 0x0d]);
    const missed = [...InvisibleCharacters.codePoints]
      .filter((point) => !kept.has(point))
      .filter((point) => visibleLines(String.fromCodePoint(point)) === String.fromCodePoint(point))
      .map((point) => point.toString(16));
    expect(missed).toEqual([]);
  });
});
