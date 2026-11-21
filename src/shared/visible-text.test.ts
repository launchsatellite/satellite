import { describe, expect, it } from "vitest";
import { visibleLines, visibleText } from "./visible-text.ts";

describe("visibleText", () => {
  it("reveals direction and invisible characters in a name", () => {
    expect(visibleText("a\u{202e}b\u{200b}c\tz")).toBe("a[U+202E]b[U+200B]c[U+0009]z");
    expect(visibleText("tag\u{e0041}.txt")).toBe("tag[U+E0041].txt");
  });

  it("reveals blank fillers that make two names look the same", () => {
    expect(visibleText("a\u{3164}.txt")).toBe("a[U+3164].txt");
    expect(visibleText("\u{115f}\u{1160}\u{ffa0}\u{2800}\u{34f}\u{180b}")).toBe(
      "[U+115F][U+1160][U+FFA0][U+2800][U+034F][U+180B]",
    );
    expect(visibleText("a\u{a0}b\u{3000}c")).toBe("a[U+00A0]b[U+3000]c");
  });

  it("keeps the joiners words and emoji are written with, as the prompt cleaner does", () => {
    const persian = "\u{645}\u{6cc}\u{200c}\u{634}\u{648}\u{62f}.md";
    const emoji = "\u{2764}\u{fe0f}\u{200d}\u{1f525}.png";
    expect(visibleText(persian)).toBe(persian);
    expect(visibleText(emoji)).toBe(emoji);
    expect(visibleText("a\u{200c}b\u{fe0f}")).toBe("a[U+200C]b[U+FE0F]");
  });

  it("reveals every code point a browser can draw as nothing", () => {
    const hidden =
      /[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Zs}\u{2800}\u{1cbb}\u{1cbc}\u{fffc}\u{133fc}]/u;
    const missed: string[] = [];
    for (let point = 0; point <= 0x10ffff; point += 1) {
      const character = String.fromCodePoint(point);
      if (point === 0x20 || !hidden.test(character)) continue;
      const hex = point.toString(16).toUpperCase().padStart(4, "0");
      if (visibleText(character) !== `[U+${hex}]`) missed.push(hex);
    }
    expect(missed).toEqual([]);
    expect(
      visibleText("admin\u{17b4}\u{17b5}\u{2065}\u{fff0}\u{fff8}\u{e0000}\u{e0002}\u{e0fff}"),
    ).toBe("admin[U+17B4][U+17B5][U+2065][U+FFF0][U+FFF8][U+E0000][U+E0002][U+E0FFF]");
  });

  it("keeps plain unicode names as they are", () => {
    for (const name of ["caf\u{e9} notes.md", "\u{65e5}\u{672c}\u{8a9e}.txt", "it's new.txt"]) {
      expect(visibleText(name)).toBe(name);
    }
  });
});

describe("visibleLines", () => {
  it("keeps git's lines while showing carriage returns and a byte order mark", () => {
    const shown = visibleLines("\u{feff}#!/bin/sh\r\nlone\rreturn\nplain\n");
    expect(shown).toBe("[U+FEFF]#!/bin/sh\u{240d}\nlone\u{240d}return\nplain\n");
    expect(shown.split("\n")).toHaveLength(4);
  });

  it("reveals hidden characters however many harmless letters the text holds", () => {
    const text = `${"\u{436}".repeat(1000)}\nconst a\u{200b}b = 1;\t// \u{2028}\n`;
    expect(visibleLines(text)).toBe(
      `${"\u{436}".repeat(1000)}\nconst a[U+200B]b = 1;\t// [U+2028]\n`,
    );
  });
});
