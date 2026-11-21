import { describe, expect, it } from "vitest";
import { lineRange } from "./line-range.ts";

const picked = (startLine: number, endLine: number, endColumn: number) => ({
  startLine,
  endLine,
  endColumn,
  empty: false,
});

describe("lineRange", () => {
  it("names nothing for a caret", () => {
    expect(lineRange({ startLine: 1, endLine: 1, endColumn: 1, empty: true }, 5)).toBeNull();
  });

  it("drops a last line the selection only touches the start of", () => {
    expect(lineRange(picked(2, 4, 1), 9)).toEqual({ start: 2, end: 3 });
    expect(lineRange(picked(2, 2, 6), 9)).toEqual({ start: 2, end: 2 });
  });

  it("never names a line past the file's last", () => {
    expect(lineRange(picked(1, 4, 1), 3)).toEqual({ start: 1, end: 3 });
    expect(lineRange(picked(2, 6, 3), 3)).toEqual({ start: 2, end: 3 });
    expect(lineRange(picked(4, 4, 2), 3)).toBeNull();
    expect(lineRange(picked(1, 1, 3), 0)).toBeNull();
  });
});
