import { describe, expect, it } from "vitest";
import { parseStatus } from "./changed-files.ts";

describe("parseStatus", () => {
  it("counts modified, staged and untracked files", () => {
    expect(parseStatus(" M a\0?? d/x\0?? new\0A  b\0")).toEqual([
      { code: " M", path: "a" },
      { code: "??", path: "d/x" },
      { code: "??", path: "new" },
      { code: "A ", path: "b" },
    ]);
  });

  it("keeps a file name with spaces, quotes and unicode", () => {
    expect(parseStatus('?? a "b" é.txt\0?? line\nbreak\0')).toEqual([
      { code: "??", path: 'a "b" é.txt' },
      { code: "??", path: "line\nbreak" },
    ]);
  });

  it("reads a rename's source as part of one entry", () => {
    expect(parseStatus("R  new\0old\0 M c\0")).toEqual([
      { code: "R ", path: "new" },
      { code: " M", path: "c" },
    ]);
    expect(parseStatus("C  copy\0?? looks like an entry\0")).toEqual([
      { code: "C ", path: "copy" },
    ]);
    expect(parseStatus("R  cut")).toEqual([{ code: "R ", path: "cut" }]);
  });

  it("answers nothing for empty output", () => {
    expect(parseStatus("")).toEqual([]);
    expect(parseStatus("\0\0M\0 M\0xx\0")).toEqual([]);
  });

  it("reads a huge status in bounded time", () => {
    const stdout = "?? some/folder/file.txt\0".repeat(500_000);
    const started = Date.now();
    expect(parseStatus(stdout)).toHaveLength(500_000);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);
});
