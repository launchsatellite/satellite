import { execFile } from "node:child_process";
import { existsSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectIncludedFiles, type CopyLimit, copyIncludedFiles } from "./include-copy.ts";
import { createIncludeMatcher, parseWorktreeInclude } from "./worktree-include.ts";

const seam = vi.hoisted(() => ({ hooks: new Map<string, (path: string) => void>() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: (...args: Parameters<typeof actual.lstat>) => {
      seam.hooks.get("lstat")?.(String(args[0]));
      return actual.lstat(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      seam.hooks.get("before-open")?.(String(args[0]));
      const handle = await actual.open(...args);
      seam.hooks.get("after-open")?.(String(args[0]));
      return handle;
    },
  };
});

const run = promisify(execFile);
const onUnix = process.platform !== "win32";

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

function unhurried(): CopyLimit {
  return { deadline: Date.now() + 60_000, signal: new AbortController().signal };
}

function collect(
  root: string,
  ignored: readonly string[],
  include: ReturnType<typeof createIncludeMatcher>,
): ReturnType<typeof collectIncludedFiles> {
  return collectIncludedFiles(root, ignored, include, unhurried());
}

function copy(
  root: string,
  worktree: string,
  files: readonly string[],
): ReturnType<typeof copyIncludedFiles> {
  return copyIncludedFiles(root, worktree, files, unhurried());
}

function once(hook: string, path: string, change: () => void): void {
  seam.hooks.set(hook, (seen) => {
    if (seen !== path) return;
    seam.hooks.delete(hook);
    change();
  });
}

async function sparseFile(path: string, size: number): Promise<void> {
  const handle = await open(path, "w");
  await handle.truncate(size);
  await handle.close();
}

afterEach(() => {
  seam.hooks.clear();
});

describe("collectIncludedFiles and copyIncludedFiles", () => {
  it("copies the bytes of matched files and nothing else", async () => {
    const { root, worktree } = await folders();
    await writeFile(join(root, ".env"), "TOKEN=1\n");
    await writeFile(join(root, "debug.log"), "noise\n");
    const selection = await collect(
      root,
      [".env", "debug.log", "../escape", "./.env", "a//b", "/abs", "a\\b", "a\0b"],
      matcher(".env\n../escape\n/abs\n"),
    );
    expect(selection).toEqual({ files: [".env"], links: 0 });
    if (typeof selection === "string") return;
    expect(await copy(root, worktree, selection.files)).toEqual({
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
      expect(await copy(root, worktree, ["run.sh"])).toEqual({
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
    const selection = await collect(
      root,
      ["vendor/", "node_modules/"],
      matcher("vendor/**/config.json\n"),
    );
    expect(selection).toEqual({ files: ["vendor/a/b/config.json"], links: 0 });
    if (typeof selection === "string") return;
    expect(await copy(root, worktree, selection.files)).toEqual({
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
    const selection = await collect(root, ["secrets/"], matcher("secrets/\n"));
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
    expect(await collect(root, [".env", "vendor/"], matcher(".env\nvendor/**\n"))).toEqual({
      files: [],
      links: 3,
    });
    expect(await copy(root, worktree, [".env", "vendor/linked/id_ed25519"])).toEqual({
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
      expect(await copy(root, worktree, ["config/dev.local.json", ".env"])).toEqual({
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
    expect(await copy(root, worktree, [".env"])).toEqual({ copied: 0, skipped: 1 });
    expect(await readFile(join(worktree, ".env"), "utf8")).toBe("from the checkout");
  });

  it.skipIf(process.platform === "win32")(
    "skips a named pipe without waiting on it",
    async () => {
      const { root, worktree } = await folders();
      await run("mkfifo", [join(root, ".env")]);
      await mkdir(join(root, "vendor"));
      await run("mkfifo", [join(root, "vendor", "pipe")]);
      expect(await collect(root, [".env", "vendor/"], matcher(".env\nvendor/\n"))).toEqual({
        files: [],
        links: 0,
      });
      expect(await copy(root, worktree, [".env"])).toEqual({
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
    expect(await collect(root, ["cache/"], matcher("cache/\n"))).toBe("too-many");
  }, 30_000);

  it.skipIf(!onUnix)(
    "never copies through a parent swapped for a link after its check",
    async () => {
      const { root, worktree, outside } = await folders();
      await mkdir(join(root, "conf"));
      await writeFile(join(root, "conf", "local.json"), "inside");
      await writeFile(join(outside, "local.json"), "outside");
      once("lstat", join(root, "conf", "local.json"), () => {
        renameSync(join(root, "conf"), join(root, "conf-real"));
        symlinkSync(outside, join(root, "conf"));
      });
      expect(await copy(root, worktree, ["conf/local.json"])).toEqual({ copied: 0, skipped: 1 });
      expect(existsSync(join(worktree, "conf", "local.json"))).toBe(false);
    },
  );

  it.skipIf(!onUnix)(
    "never copies through a parent swapped for a link and back around the open",
    async () => {
      const { root, worktree, outside } = await folders();
      await mkdir(join(root, "conf"));
      await writeFile(join(root, "conf", "local.json"), "inside");
      await writeFile(join(outside, "local.json"), "outside");
      once("lstat", join(root, "conf", "local.json"), () => {
        renameSync(join(root, "conf"), join(root, "conf-real"));
        symlinkSync(outside, join(root, "conf"));
      });
      once("after-open", join(root, "conf", "local.json"), () => {
        unlinkSync(join(root, "conf"));
        renameSync(join(root, "conf-real"), join(root, "conf"));
      });
      expect(await copy(root, worktree, ["conf/local.json"])).toEqual({ copied: 0, skipped: 1 });
      expect(existsSync(join(worktree, "conf", "local.json"))).toBe(false);
    },
  );

  it("skips a file replaced between its check and its open", async () => {
    const { root, worktree } = await folders();
    await writeFile(join(root, "local.json"), "checked");
    once("before-open", join(root, "local.json"), () => {
      renameSync(join(root, "local.json"), join(root, "checked.json"));
      writeFileSync(join(root, "local.json"), "swapped");
    });
    expect(await copy(root, worktree, ["local.json"])).toEqual({ copied: 0, skipped: 1 });
    expect(await readdir(worktree)).toEqual([]);
  });

  it("stops once its deadline passes or creation stops", async () => {
    const { root, worktree } = await folders();
    await writeFile(join(root, "local.json"), "x");
    const late = { deadline: Date.now() - 1, signal: new AbortController().signal };
    const quitting = new AbortController();
    quitting.abort();
    const stopped = { deadline: Date.now() + 60_000, signal: quitting.signal };
    for (const limit of [late, stopped]) {
      expect(await collectIncludedFiles(root, ["local.json"], matcher("*\n"), limit)).toBe(
        "too-slow",
      );
      expect(await copyIncludedFiles(root, worktree, ["local.json"], limit)).toBe("too-slow");
    }
    expect(await readdir(worktree)).toEqual([]);
  });

  it("stops a walk a hostile .worktreeinclude makes slow at its deadline", async () => {
    const { root } = await folders();
    const deep = join(root, "n", ...Array.from({ length: 60 }, () => "a"));
    await mkdir(deep, { recursive: true });
    await Promise.all(
      Array.from({ length: 300 }, (_, index) => writeFile(join(deep, `f${String(index)}`), "")),
    );
    const run12 = Array.from({ length: 12 }, () => "a").join("/");
    const hostile = Array.from(
      { length: 1000 },
      (_, index) => `n/**/${run12}/z${String(index)}`,
    ).join("\n");
    const started = Date.now();
    const limit = { deadline: started + 100, signal: new AbortController().signal };
    expect(await collectIncludedFiles(root, ["n/"], matcher(hostile), limit)).toBe("too-slow");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("stops after 100000 entries", async () => {
    const { root } = await folders();
    const entries = Array.from({ length: 100_001 }, (_, index) => `n${String(index)}`);
    expect(await collect(root, entries, matcher("nothing\n"))).toBe("too-many");
  });

  it.skipIf(!onUnix)("stops at 1 GiB and never copies past it", async () => {
    const { root, worktree } = await folders();
    await sparseFile(join(root, "big.bin"), 1_073_741_825);
    expect(await collect(root, ["big.bin"], matcher("big.bin\n"))).toBe("too-large");
    expect(await copy(root, worktree, ["big.bin"])).toEqual({ copied: 0, skipped: 1 });
    expect(await readdir(worktree)).toEqual([]);
  });

  it.skipIf(!onUnix)("skips names Windows reads as devices or streams", async () => {
    const { root } = await folders();
    const names = ["ok.json", "a:b.json", "nul.json", "dot.json.", "space.json "];
    for (const name of names) await writeFile(join(root, name), "x");
    const platform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(await collect(root, names, matcher("*\n"))).toEqual({ files: ["ok.json"], links: 0 });
    } finally {
      Object.defineProperty(process, "platform", { value: platform });
    }
  });

  it.skipIf(!onUnix || process.getuid?.() === 0)(
    "skips a folder it may not read instead of failing",
    async () => {
      const { root } = await folders();
      await mkdir(join(root, "cache", "locked"), { recursive: true });
      await writeFile(join(root, "cache", "kept"), "x");
      await chmod(join(root, "cache", "locked"), 0o000);
      try {
        expect(await collect(root, ["cache/"], matcher("cache/\n"))).toEqual({
          files: ["cache/kept"],
          links: 0,
        });
      } finally {
        await chmod(join(root, "cache", "locked"), 0o700);
      }
    },
  );
});
