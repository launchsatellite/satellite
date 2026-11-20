import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveInside, samePath } from "./paths.ts";

const isWindows = process.platform === "win32";

let base = "";
let root = "";

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "satellite-paths-"));
  root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(join(root, "space folder"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, "a.txt"), "a");
  await writeFile(join(root, "space folder", "zoë.txt"), "z");
  await writeFile(join(outside, "secret.txt"), "s");
  if (!isWindows) {
    await symlink(join(outside, "secret.txt"), join(root, "escape"));
    await symlink(join(root, "a.txt"), join(root, "inner"));
  }
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("resolveInside", () => {
  it("refuses a path that climbs out with ..", async () => {
    expect(await resolveInside(root, "../outside/secret.txt")).toBeUndefined();
  });

  it("refuses an absolute path that climbs out of the root", async () => {
    expect(await resolveInside(root, "/../outside/secret.txt")).toBeUndefined();
  });

  it("anchors an absolute path at the root", async () => {
    expect(await resolveInside(root, "/a.txt")).toBe(await realpath(join(root, "a.txt")));
  });

  it.skipIf(isWindows)("refuses a symlink that points outside the root", async () => {
    expect(await resolveInside(root, "escape")).toBeUndefined();
  });

  it.skipIf(isWindows)("allows a symlink that stays inside", async () => {
    expect(await resolveInside(root, "inner")).toBe(await realpath(join(root, "a.txt")));
  });

  it("returns undefined for a missing file", async () => {
    expect(await resolveInside(root, "missing.txt")).toBeUndefined();
  });

  it("resolves names with spaces and unicode", async () => {
    expect(await resolveInside(root, "space folder/zoë.txt")).toBe(
      await realpath(join(root, "space folder", "zoë.txt")),
    );
  });
});

describe("samePath", () => {
  it("treats two spellings of one folder as the same", () => {
    expect(samePath("/srv/repo", "/srv/repo/", "linux")).toBe(true);
    expect(samePath("/srv/repo", "/srv/./tools/../repo", "linux")).toBe(true);
    expect(samePath("/srv/Repo", "/srv/repo", "linux")).toBe(false);
    expect(samePath("/Users/<name>/Repo", "/users/<name>/repo/", "darwin")).toBe(true);
    expect(samePath("/Users/<name>/repo", "/Users/<name>/repo2", "darwin")).toBe(false);
    expect(samePath("C:\\Users\\<name>\\Repo", "c:/users/<name>/repo/", "win32")).toBe(true);
    expect(samePath("C:\\Users\\<name>\\repo", "D:\\Users\\<name>\\repo", "win32")).toBe(false);
  });
});
