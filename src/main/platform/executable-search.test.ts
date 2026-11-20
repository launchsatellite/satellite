import { describe, expect, it } from "vitest";
import { executableCandidates } from "./executable-search.ts";

describe("executableCandidates", () => {
  it("finds only exe and com files on Windows", () => {
    expect(executableCandidates("gh", "win32", { PATH: "C:\\Tools\\bin" })).toEqual([
      "C:\\Tools\\bin\\gh.exe",
      "C:\\Tools\\bin\\gh.com",
    ]);
  });

  it("reads the Windows Path key whatever its case", () => {
    expect(executableCandidates("git", "win32", { Path: "D:\\Git\\cmd" })).toEqual([
      "D:\\Git\\cmd\\git.exe",
      "D:\\Git\\cmd\\git.com",
    ]);
    expect(executableCandidates("git", "win32", { pAtH: "D:\\Git\\cmd" })).toHaveLength(2);
  });

  it("splits Windows paths on semicolons and posix paths on colons", () => {
    expect(executableCandidates("claude", "win32", { PATH: "C:\\A;C:\\B" })).toEqual([
      "C:\\A\\claude.exe",
      "C:\\A\\claude.com",
      "C:\\B\\claude.exe",
      "C:\\B\\claude.com",
    ]);
    expect(executableCandidates("claude", "darwin", { PATH: "/opt/tools/bin:/usr/bin" })).toEqual([
      "/opt/tools/bin/claude",
      "/usr/bin/claude",
    ]);
  });

  it("skips empty and relative path entries", () => {
    expect(
      executableCandidates("git", "linux", { PATH: ":/opt/tools/bin::.:node_modules/.bin:" }),
    ).toEqual(["/opt/tools/bin/git"]);
    expect(executableCandidates("git", "win32", { PATH: ";C:\\A;;.;bin;" })).toEqual([
      "C:\\A\\git.exe",
      "C:\\A\\git.com",
    ]);
    expect(executableCandidates("git", "linux", {})).toEqual([]);
  });
});
