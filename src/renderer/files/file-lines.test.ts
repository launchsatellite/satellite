import { describe, expect, it } from "vitest";
import { fileLinesRequest } from "./file-lines.ts";
import { noFileLinesSentence } from "./file-words.ts";

const lines = { start: 2, end: 3 };
const sentenceOf = (path: string, selection: { start: number; end: number } | null = lines) => {
  const request = fileLinesRequest(path, selection);
  return request.ok ? request.text : request.sentence;
};

describe("fileLinesRequest", () => {
  it("points at the lines of the file as it is in the workspace", () => {
    expect(sentenceOf("src/app.ts")).toBe("Lines 2 to 3 of src/app.ts in this workspace. ");
    expect(sentenceOf("src/app.ts", { start: 4, end: 4 })).toBe(
      "Line 4 of src/app.ts in this workspace. ",
    );
    expect(sentenceOf("caf\u{e9} notes.md")).toBe(
      'Lines 2 to 3 of "caf\u{e9} notes.md" in this workspace. ',
    );
  });

  it("answers the file sentence for no selection or a range that names nothing", () => {
    expect(sentenceOf("a.ts", null)).toBe(noFileLinesSentence);
    expect(sentenceOf("a.ts", { start: 3, end: 2 })).toBe(noFileLinesSentence);
    expect(sentenceOf("a.ts", { start: 0, end: 1 })).toBe(noFileLinesSentence);
  });

  it("refuses a path with hidden characters", () => {
    for (const path of ["a\u{202e}b.md", "a\nb.md", "a\u{200b}b", "a\u001b[201~b", ""]) {
      const request = fileLinesRequest(path, lines);
      expect(request.ok).toBe(false);
      expect(sentenceOf(path)).toContain("hidden characters");
    }
  });

  it("refuses an at sign anywhere but directly after a letter, a digit or a slash", () => {
    for (const path of ["@scope/pkg.ts", "dir/ @x.ts", "dir/-@x.ts"]) {
      expect(fileLinesRequest(path, lines).ok).toBe(false);
    }
    expect(fileLinesRequest("-@x.ts", lines).ok).toBe(false);
    expect(fileLinesRequest("pkg@2/a.ts", lines).ok).toBe(true);
    expect(fileLinesRequest("dir/@types/a.ts", lines).ok).toBe(true);
  });

  it("refuses a reference past the limit", () => {
    const request = fileLinesRequest(`${"d/".repeat(400)}a.ts`, lines);
    expect(request.ok).toBe(false);
    expect(sentenceOf(`${"d/".repeat(400)}a.ts`)).toContain("too long");
  });
});
