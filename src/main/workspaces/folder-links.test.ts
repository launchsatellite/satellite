import { lstat, mkdir, mkdtemp, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { findLinks, removeLink } from "./folder-links.ts";

const onWindows = process.platform === "win32";

let base = "";
let root = "";
let outside = "";

function open(entries = 1000, depth = 64) {
  return { entries, depth, deadline: Date.now() + 10_000 };
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "satellite-links-")));
  root = join(base, "worktree");
  outside = join(base, "outside");
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "\n");
  await mkdir(join(outside, "deep"), { recursive: true });
  await writeFile(join(outside, "keep.md"), "Mine.\n");
  await symlink(base, join(outside, "deep", "loop"), "junction");
});

describe("findLinks", () => {
  it("finds every link to a folder without following it, junctions included", async () => {
    const linked = join(root, "node_modules", "shared-lib");
    await symlink(outside, linked, "junction");
    await symlink(outside, join(root, "top-link"), "junction");
    const found = await findLinks(root, open());
    expect(found.complete).toBe(true);
    expect(found.links.sort()).toEqual([linked, join(root, "top-link")].sort());
  });

  it.skipIf(onWindows)("finds links to files and dangling links too", async () => {
    await symlink(join(outside, "keep.md"), join(root, "file-link"));
    await symlink(join(base, "missing"), join(root, "node_modules", "dangling"));
    const found = await findLinks(root, open());
    expect(found.links.sort()).toEqual(
      [join(root, "file-link"), join(root, "node_modules", "dangling")].sort(),
    );
  });

  it("says when it stopped at its bounds", async () => {
    await mkdir(join(root, "a", "b", "c"), { recursive: true });
    expect((await findLinks(root, open(2))).complete).toBe(false);
    expect((await findLinks(root, open(1000, 1))).complete).toBe(false);
    expect(
      (await findLinks(root, { entries: 1000, depth: 64, deadline: Date.now() - 1 })).complete,
    ).toBe(false);
    expect((await findLinks(root, open(1000, 3))).complete).toBe(true);
  });
});

describe("removeLink", () => {
  it("removes the link and never what it points to", async () => {
    const linked = join(root, "node_modules", "shared-lib");
    await symlink(outside, linked, "junction");
    expect(await removeLink(linked)).toBe(true);
    expect(await exists(linked)).toBe(false);
    expect((await readdir(outside)).sort()).toEqual(["deep", "keep.md"]);
    expect(await exists(join(outside, "deep", "loop"))).toBe(true);
  });

  it("never removes a real folder found where a link was", async () => {
    const folder = join(root, "node_modules", "empty");
    await mkdir(folder);
    expect(await removeLink(folder)).toBe(false);
    expect(await exists(folder)).toBe(true);
  });
});
