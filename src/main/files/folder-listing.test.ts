import { execFileSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderListing } from "../../shared/bridge-contract.ts";
import { listFolders } from "./folder-listing.ts";
import { checkIgnored } from "./ignore-check.ts";
import { readFileForViewing } from "./file-read.ts";
import { readNames } from "./name-index.ts";
import {
  git,
  isolateGit,
  makeRepository,
  mockedEnvironment,
  put,
  scratch,
  snapshot,
} from "./repository-fixture.ts";

vi.mock("./ignore-check.ts", async (original) => {
  const real = await original<typeof import("./ignore-check.ts")>();
  return { checkIgnored: vi.fn(real.checkIgnored) };
});
vi.mock("../platform/user-environment.ts", () => ({
  userEnvironment: () => mockedEnvironment(),
}));

async function listFolder(root: string, folder: string): Promise<FolderListing> {
  const [listing] = await listFolders(root, [folder]);
  if (listing === undefined) throw new Error("no listing came back");
  return listing;
}

beforeEach(isolateGit);
afterEach(() => {
  vi.unstubAllEnvs();
});

function shown(listing: FolderListing): string[] | string {
  return listing.state === "listed"
    ? listing.entries.map((entry) => `${entry.ignored ? "~" : ""}${entry.kind}:${entry.name}`)
    : listing.state;
}

async function makeMany(folder: string, count: number): Promise<void> {
  await mkdir(folder, { recursive: true });
  for (let at = 0; at < count; at += 250) {
    const batch = Array.from({ length: Math.min(250, count - at) }, (_, i) =>
      writeFile(join(folder, `f${String(at + i).padStart(5, "0")}`), ""),
    );
    await Promise.all(batch);
  }
}

describe("listFolders", () => {
  it("asks git once for every folder and still marks each folder's ignored entries", async () => {
    const root = await makeRepository();
    await put(root, {
      ".gitignore": "*.log\nbuild/\n",
      "a.log": "x",
      "a.txt": "x",
      "src/b.log": "x",
      "src/b.ts": "x",
    });
    vi.mocked(checkIgnored).mockClear();
    const listings = await listFolders(root, ["", "src"]);
    expect(vi.mocked(checkIgnored)).toHaveBeenCalledTimes(1);
    expect(listings.map(shown)).toEqual([
      ["folder:src", "file:.gitignore", "~file:a.log", "file:a.txt"],
      ["~file:b.log", "file:b.ts"],
    ]);
  });
});

describe("listFolders when the one check fails", () => {
  it("checks each folder alone, so a submodule only leaves its own entries plain", async () => {
    const inner = await makeRepository();
    await put(inner, { "s.txt": "x", "s.log": "x" });
    await git(inner, "add", ".");
    await git(inner, "commit", "-qm", "s");
    const root = await makeRepository();
    await put(root, { ".gitignore": "*.log\n", "x.log": "x", "x.txt": "x" });
    await git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", inner, "subm");
    const listings = await listFolders(root, ["", "subm"]);
    expect(listings.map(shown)[0]).toContain("~file:x.log");
    expect(listings.map(shown)[1]).toEqual(["file:s.log", "file:s.txt"]);
  });

  it("does not ask for the next chunk once a check hangs", async () => {
    const root = await makeRepository();
    const names = Array.from({ length: 3000 }, (_, at) => `f${String(at)}.txt`);
    await put(
      root,
      Object.fromEntries(
        names.flatMap((name) => [
          [name, "x"],
          [`b/${name}`, "x"],
        ]),
      ),
    );
    vi.mocked(checkIgnored).mockClear();
    vi.mocked(checkIgnored).mockResolvedValueOnce({ kind: "hung" });
    await listFolders(root, ["", "b"]);
    expect(vi.mocked(checkIgnored)).toHaveBeenCalledTimes(1);
  });
});

describe("listFolder", () => {
  it("lists folders first, shows ignored entries and dot files flagged, and leaves out .git", async () => {
    const root = await makeRepository();
    await put(root, {
      ".gitignore": "*.log\nbuild/\n",
      "b.txt": "x",
      "a.txt": "x",
      "debug.log": "x",
      ".dotfile": "x",
      "z/inner.txt": "x",
      "build/out.js": "x",
      "src/app.ts": "x",
    });
    expect(shown(await listFolder(root, ""))).toEqual([
      "~folder:build",
      "folder:src",
      "folder:z",
      "file:.dotfile",
      "file:.gitignore",
      "file:a.txt",
      "file:b.txt",
      "~file:debug.log",
    ]);
    expect(shown(await listFolder(root, "build"))).toEqual(["~file:out.js"]);
    expect(shown(await listFolder(root, "src"))).toEqual(["file:app.ts"]);
  });

  it("shows entries plain when the ignore check cannot answer", async () => {
    const root = await makeRepository();
    await put(root, { ".gitignore": "*.log\n", "debug.log": "x", "a.txt": "x" });
    await writeFile(join(root, ".git", "index"), "not an index");
    expect(shown(await listFolder(root, ""))).toEqual([
      "file:.gitignore",
      "file:a.txt",
      "file:debug.log",
    ]);
  });

  it("does not flag a tracked file that an ignore pattern matches", async () => {
    const root = await makeRepository();
    await put(root, {
      ".gitignore": "*.log\nbuild/\n",
      "build/forced.js": "x",
      "build/other.js": "x",
    });
    await git(root, "add", "-f", "build/forced.js");
    expect(shown(await listFolder(root, "build"))).toEqual(["file:forced.js", "~file:other.js"]);
  });

  it("marks a folder that holds a .git entry as a repository and a link as a link", async () => {
    const root = await makeRepository();
    const outside = join(await scratch(), "outside");
    await mkdir(outside);
    await put(root, {
      "nested/.git": "gitdir: ../elsewhere\n",
      "nested/a.txt": "x",
      "plain/a": "x",
    });
    await symlink(outside, join(root, "linked"), "junction");
    expect(shown(await listFolder(root, ""))).toEqual([
      "repository:nested",
      "folder:plain",
      "link:linked",
    ]);
    await put(root, { "nested/sub/b.txt": "x" });
    expect(shown(await listFolder(root, "nested"))).toEqual(["folder:sub", "file:a.txt"]);
    expect(shown(await listFolder(root, "nested/sub"))).toEqual(["file:b.txt"]);
    expect(await listFolder(root, "nested/.git")).toEqual({ state: "unreadable" });
    expect(await listFolder(root, "nested/missing")).toEqual({ state: "missing" });
  });

  it.skipIf(process.platform === "win32")(
    "marks a link to a file as a link and leaves out a pipe",
    async () => {
      const root = await makeRepository();
      await put(root, { "a.txt": "x" });
      await symlink("a.txt", join(root, "to-file"));
      const { execFileSync } = await import("node:child_process");
      execFileSync("mkfifo", [join(root, "pipe")]);
      expect(shown(await listFolder(root, ""))).toEqual(["file:a.txt", "link:to-file"]);
    },
  );

  it("refuses a folder reached through a linked folder, .git, .., an absolute path and a drive path", async () => {
    const root = await makeRepository();
    const outside = join(await scratch(), "outside");
    await put(outside, { "deep/x.txt": "x" });
    await symlink(outside, join(root, "linked"), "junction");
    await put(root, { "sub/inner/a.txt": "x" });
    for (const folder of [
      "linked",
      "linked/deep",
      ".git",
      ".GIT/hooks",
      "..",
      "../outside",
      "sub/../..",
      "/etc",
      "C:/Windows",
      "C:",
      "sub\\inner",
      "sub//inner",
      "sub/",
    ]) {
      expect(await listFolder(root, folder)).toEqual({ state: "unreadable" });
    }
    expect(shown(await listFolder(root, "sub/inner"))).toEqual(["file:a.txt"]);
  });

  it("answers too-many past the scan limit and cuts the list at 1000 with the rest counted", async () => {
    const root = await makeRepository();
    await makeMany(join(root, "huge"), 5001);
    await makeMany(join(root, "many"), 1100);
    expect(await listFolder(root, "huge")).toEqual({ state: "too-many" });
    const listing = await listFolder(root, "many");
    expect(listing.state === "listed" && listing.entries.length).toBe(1000);
    expect(listing.state === "listed" && listing.more).toBe(100);
  });

  it.skipIf(process.platform === "win32")(
    "reads a name that starts with a colon literally and counts a name it cannot show",
    async () => {
      const root = await makeRepository();
      await put(root, {
        ".gitignore": ":(foo)ig\nign.txt\n",
        ":(foo)ig": "x",
        ":(top)ign.txt": "x",
        "plain.txt": "x",
        "back\\slash.txt": "x",
      });
      const listing = await listFolder(root, "");
      expect(shown(listing)).toEqual([
        "file:.gitignore",
        "~file::(foo)ig",
        "file::(top)ign.txt",
        "file:plain.txt",
      ]);
      expect(listing.state === "listed" && listing.more).toBe(1);
    },
  );

  it.skipIf(process.platform === "win32")(
    "reads a folder that starts with a colon literally, so its entries are checked on their own",
    async () => {
      const root = await makeRepository();
      await put(root, {
        ".gitignore": "*.log\nigndir/c\n",
        ":(icase)X/a.log": "x",
        ":(icase)X/b.txt": "x",
        ":(top)igndir/c": "x",
      });
      expect(shown(await listFolder(root, ":(icase)X"))).toEqual(["~file:a.log", "file:b.txt"]);
      expect(shown(await listFolder(root, ":(top)igndir"))).toEqual(["file:c"]);
    },
  );

  it("answers missing for a folder that is gone and for a file", async () => {
    const root = await makeRepository();
    await put(root, { "a.txt": "x" });
    expect(await listFolder(root, "nope")).toEqual({ state: "missing" });
    expect(await listFolder(root, "nope/deeper")).toEqual({ state: "missing" });
    expect(await listFolder(root, "a.txt")).toEqual({ state: "missing" });
    expect(await listFolder(join(root, "gone"), "")).toEqual({ state: "missing" });
  });

  it("writes nothing into the repository", async () => {
    const root = await makeRepository();
    await put(root, { ".gitignore": "*.log\n", "a.txt": "x", "debug.log": "x", "src/b.ts": "x" });
    await git(root, "add", "a.txt");
    const before = await snapshot(join(root, ".git"));
    await listFolder(root, "");
    await listFolder(root, "src");
    await readNames(root);
    await readFileForViewing(root, "a.txt", null);
    expect(await snapshot(join(root, ".git"))).toEqual(before);
  });
});

describe("a git that hangs", () => {
  it.skipIf(process.platform === "win32")(
    "shows the entries plain in time and answers the name list as hung",
    async () => {
      const root = await makeRepository();
      await put(root, { "a.txt": "x", "b.log": "x", ".gitignore": "*.log\n" });
      const pipe = join(await scratch(), "excludes");
      execFileSync("mkfifo", [pipe]);
      await git(root, "config", "core.excludesFile", pipe);
      const started = Date.now();
      expect(shown(await listFolder(root, ""))).toEqual([
        "file:.gitignore",
        "file:a.txt",
        "file:b.log",
      ]);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(await readNames(root, undefined, undefined, 300)).toEqual({ kind: "hung" });
    },
  );
});
