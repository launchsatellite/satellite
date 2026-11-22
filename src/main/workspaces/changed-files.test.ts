import { afterEach, describe, expect, it, vi } from "vitest";
import { pacedStatus, parseStatus } from "./changed-files.ts";
import { readGit } from "./git-command.ts";

vi.mock("./git-command.ts", async (original) => {
  const actual = await original<typeof import("./git-command.ts")>();
  return { ...actual, readGit: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(readGit).mockReset();
});

function answers(...runs: string[]): void {
  for (const run of runs) {
    vi.mocked(readGit).mockImplementationOnce(() => {
      vi.advanceTimersByTime(1000);
      return Promise.resolve(run === "time" ? "time" : { exitCode: 0, stdout: run, stderr: "" });
    });
  }
}

describe("pacedStatus", () => {
  it("reads a workspace again only once four times its last read has passed", async () => {
    vi.useFakeTimers();
    answers(" M a\0", " M a\0?? b\0");
    expect((await pacedStatus("/paced/slow"))?.entries).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect((await pacedStatus("/paced/slow"))?.entries).toHaveLength(1);
    expect(readGit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect((await pacedStatus("/paced/slow"))?.entries).toHaveLength(2);
    expect(readGit).toHaveBeenCalledTimes(2);
  });

  it("reads again on time when the wall clock steps back", async () => {
    vi.useFakeTimers();
    answers(" M a\0", " M a\0?? b\0");
    expect((await pacedStatus("/paced/stepped"))?.entries).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    vi.setSystemTime(Date.now() - 3_600_000);
    expect((await pacedStatus("/paced/stepped"))?.entries).toHaveLength(2);
  });

  it("keeps the last count when a read runs out of time", async () => {
    vi.useFakeTimers();
    answers(" M a\0", "time");
    expect((await pacedStatus("/paced/late"))?.entries).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect((await pacedStatus("/paced/late"))?.entries).toHaveLength(1);
    expect(readGit).toHaveBeenCalledTimes(2);
  });

  it("answers nothing for a read that failed", async () => {
    vi.useFakeTimers();
    vi.mocked(readGit).mockResolvedValueOnce({ exitCode: 128, stdout: "", stderr: "fatal" });
    expect(await pacedStatus("/paced/failed")).toBeUndefined();
  });
});

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
