import { describe, expect, it } from "vitest";
import { isSafeFileName, isTooLongForCheckouts } from "./file-system.ts";

describe("file system rules", () => {
  it("refuses names Windows reads as devices or streams only on Windows", () => {
    for (const name of [
      "a:b.json",
      "nul.json",
      "dot.json.",
      "space.json ",
      "nul .txt",
      "COM\u00b9",
      "lpt\u00b2.log",
      "Com\u00b3 .txt",
    ]) {
      expect(isSafeFileName(name, "win32")).toBe(false);
      expect(isSafeFileName(name, "linux")).toBe(true);
    }
    for (const name of ["", ".", "..", "back\\slash"])
      expect(isSafeFileName(name, "darwin")).toBe(false);
    expect(isSafeFileName("ok.json", "win32")).toBe(true);
    expect(isSafeFileName("com\u00b9x.txt", "win32")).toBe(true);
  });

  it("holds a workspace folder to 150 characters on Windows only", () => {
    const path = `C:\\${"a".repeat(148)}`;
    expect(isTooLongForCheckouts(path, "win32")).toBe(true);
    expect(isTooLongForCheckouts(path.slice(0, 150), "win32")).toBe(false);
    expect(isTooLongForCheckouts(path, "linux")).toBe(false);
  });
});
