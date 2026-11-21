import { describe, expect, it } from "vitest";
import { visibleText } from "./visible-text.ts";

describe("visibleText", () => {
  it("reveals direction and invisible characters in a name", () => {
    expect(visibleText("a‮b​c\tz")).toBe("a[U+202E]b[U+200B]c[U+0009]z");
    expect(visibleText("tag\u{E0041}.txt")).toBe("tag[U+E0041].txt");
  });

  it("keeps plain unicode names as they are", () => {
    for (const name of ["café notes.md", "日本語.txt", "it's new.txt"]) {
      expect(visibleText(name)).toBe(name);
    }
  });
});
