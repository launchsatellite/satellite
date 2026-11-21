import { describe, expect, it } from "vitest";
import { AmbiguousCharacters } from "monaco-editor/base/common/strings";
import { confusableColumns, lookAlikeColumns } from "./look-alikes.ts";

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

describe("confusableColumns", () => {
  const table = AmbiguousCharacters.getInstance(new Set());
  const marked = (line: string) =>
    confusableColumns(line, (point) => table.isAmbiguous(point)).map(({ start, end }) =>
      line.slice(start - 1, end - 1),
    );

  it("marks every look-alike the editor's table knows, whole words in another script included", () => {
    expect(marked("const \u{441}\u{43e}\u{440}\u{435} = 1;")).toEqual([
      "\u{441}",
      "\u{43e}",
      "\u{440}",
      "\u{435}",
    ]);
    expect(marked("if (\u{261}oogle) \u{131}sAdmin = al\u{1c0}ow")).toEqual([
      "\u{261}",
      "\u{131}",
      "\u{1c0}",
    ]);
    expect(marked("p\u{ff41}ypal")).toEqual(["\u{ff41}"]);
    expect(marked("a = 1\u{37e} b = 2")).toEqual(["\u{37e}"]);
    expect(marked("level\u{2160}, x\u{1d7ce}, x\u{966}")).toEqual([
      "\u{2160}",
      "\u{1d7ce}",
      "\u{966}",
    ]);
  });

  it("leaves real words of another script and accented Latin alone", () => {
    expect(marked("// \u{43f}\u{440}\u{438}\u{432}\u{435}\u{442} caf\u{e9} na\u{ef}ve")).toEqual(
      [],
    );
    expect(marked(`// ${"\u{436}".repeat(1000)}`)).toEqual([]);
  });
});

describe("the editor's look-alike table", () => {
  it("still holds the pairs people rely on", () => {
    const table = AmbiguousCharacters.getInstance(new Set());
    const known = [
      0x430, 0x435, 0x43e, 0x440, 0x441, 0x445, 0x443, 0x456, 0x3bf, 0x37e, 0x3b1, 0xff41, 0x131,
      0x1c0, 0x2160, 0x1d7ce, 0x966, 0x4cf,
    ];
    expect(known.filter((point) => !table.isAmbiguous(point))).toEqual([]);
    const plain = [0x61, 0x62, 0x63, 0x6f, 0x30, 0x31, 0x6c, 0x49, 0x20, 0x41];
    expect(plain.filter((point) => table.isAmbiguous(point))).toEqual([]);
  });
});
