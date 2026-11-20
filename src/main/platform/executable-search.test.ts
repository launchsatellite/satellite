import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executableCandidates, findExecutable } from "./executable-search.ts";

const isWindows = process.platform === "win32";
const fileName = isWindows ? "tool.exe" : "tool";

let base = "";

async function folderWith(name: string, kind: "runnable" | "plain" | "folder"): Promise<string> {
  const folder = join(base, name);
  await mkdir(folder, { recursive: true });
  const target = join(folder, fileName);
  if (kind === "folder") await mkdir(target);
  else {
    await writeFile(target, "#!/bin/sh\n");
    await chmod(target, kind === "runnable" ? 0o755 : 0o644);
  }
  return folder;
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "satellite-find-"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

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

  it("skips root-relative Windows entries without a drive", () => {
    expect(
      executableCandidates("gh", "win32", { PATH: "\\tools;/tools;C:\\A;\\\\server\\share\\bin" }),
    ).toEqual([
      "C:\\A\\gh.exe",
      "C:\\A\\gh.com",
      "\\\\server\\share\\bin\\gh.exe",
      "\\\\server\\share\\bin\\gh.com",
    ]);
  });

  it("strips surrounding quotes from Windows entries", () => {
    expect(
      executableCandidates("git", "win32", { PATH: '"C:\\Program Files\\Git\\cmd";C:\\B' }),
    ).toEqual([
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files\\Git\\cmd\\git.com",
      "C:\\B\\git.exe",
      "C:\\B\\git.com",
    ]);
  });
});

describe("findExecutable", () => {
  it("finds a regular executable file", async () => {
    const folder = await folderWith("runnable", "runnable");
    expect(await findExecutable("tool", { PATH: folder })).toBe(join(folder, fileName));
  });

  it("skips a directory with the tool's name", async () => {
    const decoy = await folderWith("decoy-folder", "folder");
    const real = await folderWith("after-folder", "runnable");
    expect(await findExecutable("tool", { PATH: [decoy, real].join(delimiter) })).toBe(
      join(real, fileName),
    );
  });

  it.skipIf(isWindows)("skips a file that is not executable", async () => {
    const decoy = await folderWith("decoy-plain", "plain");
    const real = await folderWith("after-plain", "runnable");
    expect(await findExecutable("tool", { PATH: [decoy, real].join(delimiter) })).toBe(
      join(real, fileName),
    );
  });
});
