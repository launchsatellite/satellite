import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { collectIncludedFiles, copyIncludedFiles } from "./include-copy.ts";
import { createIncludeMatcher, parseWorktreeInclude } from "./worktree-include.ts";

const run = promisify(execFile);

async function temporaryFolder(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "satellite-copy-")));
}

async function folders(): Promise<{ root: string; worktree: string; outside: string }> {
  const [root, worktree, outside] = await Promise.all([
    temporaryFolder(),
    temporaryFolder(),
    temporaryFolder(),
  ]);
  return { root, worktree, outside };
}

function matcher(text: string): ReturnType<typeof createIncludeMatcher> {
  return createIncludeMatcher(parseWorktreeInclude(text));
}

describe("collectIncludedFiles and copyIncludedFiles", () => {
  it("copies the bytes of matched files and nothing else", async () => {
    const { root, worktree } = await folders();
    await writeFile(join(root, ".env"), "TOKEN=1\n");
    await writeFile(join(root, "debug.log"), "noise\n");
    const selection = await collectIncludedFiles(
      root,
      [".env", "debug.log", "../escape", "./.env", "a//b", "/abs", "a\\b", "a\0b"],
      matcher(".env\n../escape\n/abs\n"),
    );
    expect(selection).toEqual({ files: [".env"], links: 0 });
    if (typeof selection === "string") return;
    expect(await copyIncludedFiles(root, worktree, selection.files)).toEqual({
      copied: 1,
      skipped: 0,
    });
    expect(await readFile(join(worktree, ".env"), "utf8")).toBe("TOKEN=1\n");
    expect(await readdir(worktree)).toEqual([".env"]);
  });

  it.skipIf(process.platform === "win32")(
    "copies the executable bit of matched files",
    async () => {
      const { root, worktree } = await folders();
      await writeFile(join(root, "run.sh"), "#!/bin/sh\n");
      await chmod(join(root, "run.sh"), 0o755);
      expect(await copyIncludedFiles(root, worktree, ["run.sh"])).toEqual({
        copied: 1,
        skipped: 0,
      });
      expect((await stat(join(worktree, "run.sh"))).mode & 0o111).not.toBe(0);
    },
  );

  it("copies a matched file from inside an ignored folder it reaches", async () => {
    const { root, worktree } = await folders();
    await mkdir(join(root, "vendor", "a", "b"), { recursive: true });
    await writeFile(join(root, "vendor", "a", "b", "config.json"), "{}");
    await writeFile(join(root, "vendor", "a", "other.json"), "{}");
    await mkdir(join(root, "node_modules", "x"), { recursive: true });
    await writeFile(join(root, "node_modules", "x", "config.json"), "{}");
    const selection = await collectIncludedFiles(
      root,
      ["vendor/", "node_modules/"],
      matcher("vendor/**/config.json\n"),
    );
    expect(selection).toEqual({ files: ["vendor/a/b/config.json"], links: 0 });
    if (typeof selection === "string") return;
    expect(await copyIncludedFiles(root, worktree, selection.files)).toEqual({
      copied: 1,
      skipped: 0,
    });
    expect(await readFile(join(worktree, "vendor", "a", "b", "config.json"), "utf8")).toBe("{}");
  });

  it("copies a whole ignored folder the include names", async () => {
    const { root } = await folders();
    await mkdir(join(root, "secrets", "deep"), { recursive: true });
    await writeFile(join(root, "secrets", "deep", "key"), "k");
    await writeFile(join(root, "secrets", "id"), "i");
    const selection = await collectIncludedFiles(root, ["secrets/"], matcher("secrets/\n"));
    expect(selection).not.toBeTypeOf("string");
    if (typeof selection === "string") return;
    expect([...selection.files].sort()).toEqual(["secrets/deep/key", "secrets/id"]);
  });

  it.skipIf(process.platform === "win32")("skips links instead of following them", async () => {
    const { root, worktree, outside } = await folders();
    await writeFile(join(outside, "id_ed25519"), "private");
    await symlink(join(outside, "id_ed25519"), join(root, ".env"));
    await mkdir(join(root, "vendor"));
    await symlink(outside, join(root, "vendor", "linked"));
    await symlink(join(outside, "id_ed25519"), join(root, "vendor", "config.json"));
    expect(
      await collectIncludedFiles(root, [".env", "vendor/"], matcher(".env\nvendor/**\n")),
    ).toEqual({ files: [], links: 3 });
    expect(await copyIncludedFiles(root, worktree, [".env", "vendor/linked/id_ed25519"])).toEqual({
      copied: 0,
      skipped: 2,
    });
    expect(await readdir(worktree)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "never writes through a link in the new checkout",
    async () => {
      const { root, worktree, outside } = await folders();
      await mkdir(join(root, "config"));
      await writeFile(join(root, "config", "dev.local.json"), "{}");
      await writeFile(join(root, ".env"), "TOKEN=1\n");
      await symlink(outside, join(worktree, "config"));
      await symlink(join(outside, "planted"), join(worktree, ".env"));
      expect(await copyIncludedFiles(root, worktree, ["config/dev.local.json", ".env"])).toEqual({
        copied: 0,
        skipped: 2,
      });
      expect(await readdir(outside)).toEqual([]);
    },
  );

  it("keeps a file the checkout already has", async () => {
    const { root, worktree } = await folders();
    await writeFile(join(root, ".env"), "from the main folder");
    await writeFile(join(worktree, ".env"), "from the checkout");
    expect(await copyIncludedFiles(root, worktree, [".env"])).toEqual({ copied: 0, skipped: 1 });
    expect(await readFile(join(worktree, ".env"), "utf8")).toBe("from the checkout");
  });

  it.skipIf(process.platform === "win32")(
    "skips a named pipe without waiting on it",
    async () => {
      const { root, worktree } = await folders();
      await run("mkfifo", [join(root, ".env")]);
      await mkdir(join(root, "vendor"));
      await run("mkfifo", [join(root, "vendor", "pipe")]);
      expect(
        await collectIncludedFiles(root, [".env", "vendor/"], matcher(".env\nvendor/\n")),
      ).toEqual({ files: [], links: 0 });
      expect(await copyIncludedFiles(root, worktree, [".env"])).toEqual({
        copied: 0,
        skipped: 1,
      });
    },
    5000,
  );

  it("stops at 10000 files", async () => {
    const { root } = await folders();
    await mkdir(join(root, "cache"));
    for (let start = 0; start < 10_001; start += 500) {
      await Promise.all(
        Array.from({ length: Math.min(500, 10_001 - start) }, (_, offset) =>
          writeFile(join(root, "cache", `f${String(start + offset)}`), ""),
        ),
      );
    }
    expect(await collectIncludedFiles(root, ["cache/"], matcher("cache/\n"))).toBe("too-many");
  }, 30_000);
});
