import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findExecutable } from "./executable-search.ts";

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
