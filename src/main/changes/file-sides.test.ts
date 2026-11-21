import { execFile } from "node:child_process";
import type { BigIntStats } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  stat,
  symlink,
  utimes,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitReadMs } from "../workspaces/git-command.ts";
import { isChangePath, lineCount, readBlobSide, readWorktreeSide } from "./file-sides.ts";

const fileCalls = vi.hoisted(() => {
  const calls: {
    realpath?: ((path: string) => Promise<string>) | undefined;
    lstat?: ((path: string) => Promise<BigIntStats>) | undefined;
    open?: ((path: string, flags: number) => Promise<FileHandle>) | undefined;
  } = {};
  return calls;
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: (path: string) => fileCalls.realpath?.(path) ?? actual.realpath(path),
    lstat: (path: string, options: { bigint: true }) =>
      fileCalls.lstat?.(path) ?? actual.lstat(path, options),
    open: (path: string, flags: number) =>
      fileCalls.open?.(path, flags) ?? actual.open(path, flags),
  };
});

vi.mock("../platform/user-environment.ts", () => ({
  userEnvironment: () =>
    Promise.resolve(
      Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    ),
}));

const run = promisify(execFile);
const gitVersion = /(\d+)\.(\d+)/.exec((await run("git", ["--version"])).stdout);
const hasNoLazyFetch = Number(gitVersion?.[1]) * 1000 + Number(gitVersion?.[2]) >= 2045;

async function scratch(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "satellite-sides-")));
}

async function worktree(): Promise<{ base: string; root: string }> {
  const base = await scratch();
  const root = join(base, "root");
  await mkdir(root);
  return { base, root };
}

function gitEnvironment(config: string): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  return { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
}

describe("isChangePath", () => {
  it("refuses a path that climbs out, is absolute or reaches into .git", () => {
    for (const path of [
      "",
      "../x",
      "a/../../x",
      "/etc/passwd",
      "a//b",
      "./a",
      "a/",
      ".git/config",
      "sub/.GIT/HEAD",
      "sub/.git",
      "a\0b",
      "lost\ufffdbyte",
      "a".repeat(4097),
    ]) {
      expect(isChangePath(path, "linux")).toBe(false);
    }
    for (const path of [
      "C:/x",
      "c:x",
      "a\\b",
      "\\\\server\\share\\x",
      "a/b:stream",
      "con",
      "sub/NUL.txt",
      "dot.",
      "space ",
      ".git ",
      "GIT~1/config",
      "x/.g\u200cit/config",
    ]) {
      expect(isChangePath(path, "win32")).toBe(false);
    }
    expect(isChangePath(".g\u200cit/config", "darwin")).toBe(false);
    for (const path of ["src/app.ts", "-dash.txt", "café notes.md", "a".repeat(4096)]) {
      expect(isChangePath(path, "linux")).toBe(true);
      expect(isChangePath(path, "win32")).toBe(true);
    }
    expect(isChangePath("x/a:b/con", "linux")).toBe(true);
  });
});

describe("readWorktreeSide", () => {
  it("refuses a file reached through a linked folder", async () => {
    const { base, root } = await worktree();
    await mkdir(join(base, "outside"));
    await writeFile(join(base, "outside", "secret.txt"), "secret\n");
    await symlink(join(base, "outside"), join(root, "linked"), "junction");
    expect(await readWorktreeSide(root, "linked/secret.txt")).toEqual({ kind: "refused" });
    expect(await readWorktreeSide(root, "../outside/secret.txt")).toEqual({ kind: "unreadable" });
    expect(await readWorktreeSide(join(root, "linked"), "secret.txt")).toEqual({
      kind: "text",
      text: "secret\n",
    });
  });

  it("refuses anything under .git, whatever its case", async () => {
    const { root } = await worktree();
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "config"), "[core]\n");
    expect(await readWorktreeSide(root, ".git/config")).toEqual({ kind: "unreadable" });
    expect(await readWorktreeSide(root, ".GIT/config")).toEqual({ kind: "unreadable" });
  });

  it.skipIf(process.platform === "win32")(
    "answers unreadable for a name git lists that the reader will not read",
    async () => {
      const { root } = await worktree();
      for (const name of ["back\\slash.txt", "lost\ufffdbyte.txt"]) {
        await writeFile(join(root, name), "content\n");
        expect(await readWorktreeSide(root, name)).toEqual({ kind: "unreadable" });
      }
      expect(await readWorktreeSide(root, "../outside.txt")).toEqual({ kind: "unreadable" });
    },
  );

  it.skipIf(process.platform === "win32")(
    "shows a link as its target and never follows it",
    async () => {
      const { base, root } = await worktree();
      await writeFile(join(base, "secret.txt"), "secret\n");
      await symlink(join(base, "secret.txt"), join(root, "link.txt"));
      expect(await readWorktreeSide(root, "link.txt")).toEqual({
        kind: "text",
        text: join(base, "secret.txt"),
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "answers not-utf8 for a link whose target holds an invalid byte",
    async () => {
      const { root } = await worktree();
      await symlink(Buffer.from([0x63, 0x61, 0x66, 0xe9]), join(root, "link.txt"));
      expect(await readWorktreeSide(root, "link.txt")).toEqual({ kind: "not-utf8" });
    },
  );

  it("answers large past the byte or the line limit", async () => {
    const { root } = await worktree();
    await writeFile(join(root, "bytes.txt"), "a".repeat(65));
    await writeFile(join(root, "fits.txt"), "a".repeat(64));
    await writeFile(join(root, "lines.txt"), "a\n".repeat(20_001));
    await writeFile(join(root, "most-lines.txt"), "a\n".repeat(19_999) + "a");
    expect(await readWorktreeSide(root, "bytes.txt", 64)).toEqual({ kind: "large" });
    expect(await readWorktreeSide(root, "fits.txt", 64)).toEqual({
      kind: "text",
      text: "a".repeat(64),
    });
    expect(await readWorktreeSide(root, "lines.txt")).toEqual({ kind: "large" });
    expect((await readWorktreeSide(root, "most-lines.txt")).kind).toBe("text");
    await writeFile(join(root, "returns.txt"), "a\r".repeat(20_001));
    await writeFile(join(root, "windows.txt"), "a\r\n".repeat(19_999) + "a");
    expect((await readWorktreeSide(root, "returns.txt")).kind).toBe("text");
    expect((await readWorktreeSide(root, "windows.txt")).kind).toBe("text");
    expect(["", "a", "a\n", "a\r", "a\r\n", "a\rb", "a\r\nb\n", "\n\r\r\n"].map(lineCount)).toEqual(
      [0, 1, 1, 1, 1, 1, 2, 2],
    );
  });

  it("answers binary when a NUL sits in the first 8000 bytes", async () => {
    const { root } = await worktree();
    await writeFile(
      join(root, "early.bin"),
      Buffer.concat([Buffer.from("a".repeat(7999)), Buffer.from([0])]),
    );
    await writeFile(
      join(root, "late.txt"),
      Buffer.concat([Buffer.from("a".repeat(8000)), Buffer.from([0])]),
    );
    expect(await readWorktreeSide(root, "early.bin")).toEqual({ kind: "binary" });
    expect((await readWorktreeSide(root, "late.txt")).kind).toBe("text");
  });

  it("keeps line endings and a byte order mark, and never decodes bytes that are not UTF-8", async () => {
    const { root } = await worktree();
    await writeFile(
      join(root, "mixed.txt"),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a\r\nb\n")]),
    );
    await writeFile(join(root, "latin-e.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    await writeFile(join(root, "latin-f.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe8, 0x0a]));
    await writeFile(join(root, "cut.txt"), Buffer.from([0x61, 0xe2, 0x82]));
    expect(await readWorktreeSide(root, "mixed.txt")).toEqual({
      kind: "text",
      text: "\ufeffa\r\nb\n",
    });
    for (const name of ["latin-e.txt", "latin-f.txt", "cut.txt"]) {
      expect(await readWorktreeSide(root, name)).toEqual({ kind: "not-utf8" });
    }
  });

  it("answers gone for a missing file or worktree and binary for a folder", async () => {
    const { base, root } = await worktree();
    await mkdir(join(root, "folder"));
    expect(await readWorktreeSide(root, "missing.txt")).toEqual({ kind: "gone" });
    expect(await readWorktreeSide(root, "missing/file.txt")).toEqual({ kind: "gone" });
    expect(await readWorktreeSide(join(base, "absent"), "file.txt")).toEqual({ kind: "gone" });
    expect(await readWorktreeSide(root, "folder")).toEqual({ kind: "binary" });
  });

  it.skipIf(process.platform === "win32")("never opens a pipe", async () => {
    const { root } = await worktree();
    await run("mkfifo", [join(root, "pipe")]);
    expect(await readWorktreeSide(root, "pipe")).toEqual({ kind: "binary" });
  });

  it("reads names with spaces, quotes, unicode and a leading dash", async () => {
    const { root } = await worktree();
    const names = ["with space.txt", "it's.txt", "café.md", "-dash.txt"];
    if (process.platform !== "win32") names.push('quote"d.txt');
    await mkdir(join(root, "café folder"));
    await writeFile(join(root, "café folder", "inner.txt"), "inner\n");
    for (const name of names) await writeFile(join(root, name), `${name}\n`);
    for (const name of names) {
      expect(await readWorktreeSide(root, name)).toEqual({ kind: "text", text: `${name}\n` });
    }
    expect(await readWorktreeSide(root, "café folder/inner.txt")).toEqual({
      kind: "text",
      text: "inner\n",
    });
  });
});

describe("readWorktreeSide on a file system that stalls", () => {
  afterEach(() => {
    fileCalls.realpath = undefined;
    fileCalls.lstat = undefined;
    fileCalls.open = undefined;
    vi.useRealTimers();
  });

  it("answers within its time and then skips a stuck worktree until it settles", async () => {
    const { root } = await worktree();
    await writeFile(join(root, "file.txt"), "file\n");
    const { promise: stuck, resolve: unstick } = Promise.withResolvers<undefined>();
    let calls = 0;
    fileCalls.realpath = async (path) => {
      calls += 1;
      await stuck;
      return realpath(path);
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = readWorktreeSide(root, "file.txt");
    await vi.advanceTimersByTimeAsync(gitReadMs);
    expect(await first).toEqual({ kind: "hung" });
    const seen = calls;
    expect(await readWorktreeSide(root, "file.txt")).toEqual({ kind: "hung" });
    expect(calls).toBe(seen);
    fileCalls.realpath = undefined;
    vi.useRealTimers();
    unstick(undefined);
    await vi.waitFor(async () => {
      expect(await readWorktreeSide(root, "file.txt")).toEqual({ kind: "text", text: "file\n" });
    });
  });
});

describe("readWorktreeSide while the file changes under it", () => {
  afterEach(() => {
    fileCalls.realpath = undefined;
    fileCalls.lstat = undefined;
    fileCalls.open = undefined;
  });

  async function opened(root: string, change: (handle: FileHandle) => Promise<void>) {
    fileCalls.open = async (path, flags) => {
      fileCalls.open = undefined;
      const handle = await open(path, flags);
      await change(handle);
      return handle;
    };
    return readWorktreeSide(root, "file.txt");
  }

  it("answers changing when the opened file is not the one it checked", async () => {
    const { base, root } = await worktree();
    await writeFile(join(root, "file.txt"), "file\n");
    await writeFile(join(base, "other.txt"), "file\n");
    const other = await stat(join(base, "other.txt"), { bigint: true });
    const read = await opened(root, async (handle) => {
      vi.spyOn(handle, "stat").mockResolvedValueOnce(other);
      await Promise.resolve();
    });
    expect(read).toEqual({ kind: "changing" });
  });

  it("answers changing when fewer bytes arrive than the file held", async () => {
    const { root } = await worktree();
    await writeFile(join(root, "file.txt"), "file\n");
    const read = await opened(root, async (handle) => {
      vi.spyOn(handle, "read").mockResolvedValue({ bytesRead: 0, buffer: new Uint8Array(0) });
      await Promise.resolve();
    });
    expect(read).toEqual({ kind: "changing" });
  });

  it("answers changing when the file is rewritten while read, even with its time put back", async () => {
    const { root } = await worktree();
    const file = join(root, "file.txt");
    await writeFile(file, "before\n");
    await utimes(file, 1000, 1000);
    const read = await opened(root, async (handle) => {
      const first = await handle.stat({ bigint: true });
      vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
        await writeFile(file, "after!\n");
        await utimes(file, 1000, 1000);
        return first;
      });
    });
    expect(read).toEqual({ kind: "changing" });
  });

  it("refuses when a parent folder turns into a link during the read", async () => {
    const { base, root } = await worktree();
    await writeFile(join(root, "file.txt"), "file\n");
    const read = await opened(root, async () => {
      fileCalls.realpath = () => Promise.resolve(base);
      await Promise.resolve();
    });
    expect(read).toEqual({ kind: "refused" });
  });

  it.skipIf(process.platform === "win32")(
    "never follows a link that replaced the file after its check",
    async () => {
      const { base, root } = await worktree();
      await writeFile(join(base, "secret.txt"), "secret\n");
      await symlink(join(base, "secret.txt"), join(root, "file.txt"));
      fileCalls.lstat = (path) => stat(path, { bigint: true });
      expect(await readWorktreeSide(root, "file.txt")).toEqual({ kind: "refused" });
    },
  );

  it.skipIf(process.platform === "win32")(
    "never blocks on a pipe that replaced the file after its check",
    { timeout: 3000 },
    async () => {
      const { base, root } = await worktree();
      await writeFile(join(base, "plain.txt"), "plain\n");
      await run("mkfifo", [join(root, "file.txt")]);
      fileCalls.lstat = () => stat(join(base, "plain.txt"), { bigint: true });
      try {
        expect(await readWorktreeSide(root, "file.txt")).toEqual({ kind: "changing" });
      } finally {
        fileCalls.lstat = undefined;
      }
    },
  );
});

describe("readWorktreeSide on macOS", () => {
  it.skipIf(process.platform !== "darwin")(
    "reads a folder stored decomposed through the composed name git prints",
    async () => {
      const { root } = await worktree();
      await mkdir(join(root, "cafe\u0301"));
      await writeFile(join(root, "cafe\u0301", "menu.txt"), "menu\n");
      expect(await readWorktreeSide(root, "caf\u00e9/menu.txt")).toEqual({
        kind: "text",
        text: "menu\n",
      });
    },
  );
});

describe("readBlobSide", { timeout: 30_000 }, () => {
  it("reads a committed blob, refuses a made-up object name and answers not-local for a missing one", async () => {
    const base = await scratch();
    const repo = join(base, "repo");
    const config = join(base, "gitconfig");
    await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
    const env = gitEnvironment(config);
    const git = (args: string[]) => run("git", ["-C", repo, ...args], { env });
    await run("git", ["init", "-q", "-b", "main", repo], { env });
    await writeFile(join(repo, "file.txt"), "one\r\ntwo\n");
    await writeFile(join(repo, "data.bin"), Buffer.from([1, 0, 2]));
    await writeFile(join(repo, "lines.txt"), "a\n".repeat(20_001));
    await writeFile(join(repo, "latin.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    await git(["add", "."]);
    await git(["commit", "-q", "-m", "one"]);
    const oid = async (spec: string) => (await git(["rev-parse", spec])).stdout.trim();
    expect(await readBlobSide(repo, await oid("HEAD:file.txt"))).toEqual({
      kind: "text",
      text: "one\r\ntwo\n",
    });
    expect(await readBlobSide(repo, await oid("HEAD:data.bin"))).toEqual({ kind: "binary" });
    expect(await readBlobSide(repo, await oid("HEAD:latin.txt"))).toEqual({ kind: "not-utf8" });
    expect(await readBlobSide(repo, await oid("HEAD:lines.txt"))).toEqual({ kind: "large" });
    expect(await readBlobSide(repo, await oid("HEAD"))).toEqual({ kind: "gone" });
    expect(await readBlobSide(repo, "1".repeat(40))).toEqual({ kind: "not-local" });
    for (const name of [
      "0".repeat(40),
      "0".repeat(64),
      "HEAD",
      "--help",
      "--filters",
      "HEAD:file.txt",
      (await oid("HEAD:file.txt")).toUpperCase(),
      (await oid("HEAD:file.txt")).slice(0, 7),
      `${await oid("HEAD:file.txt")}\n`,
    ]) {
      expect(await readBlobSide(repo, name)).toEqual({ kind: "refused" });
    }
  });

  it("decides binary on the first 8000 bytes, as git and the worktree side do", async () => {
    const base = await scratch();
    const repo = join(base, "repo");
    const config = join(base, "gitconfig");
    await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
    const env = gitEnvironment(config);
    const git = (args: string[]) => run("git", ["-C", repo, ...args], { env });
    await run("git", ["init", "-q", "-b", "main", repo], { env });
    const late = Buffer.concat([Buffer.from("€".repeat(3000)), Buffer.from([0])]);
    const early = Buffer.concat([
      Buffer.from("€".repeat(2666)),
      Buffer.from("x"),
      Buffer.from([0]),
    ]);
    await writeFile(join(repo, "late.txt"), late);
    await writeFile(join(repo, "early.txt"), early);
    await git(["add", "."]);
    await git(["commit", "-q", "-m", "one"]);
    const numstat = (
      await git(["diff", "--numstat", "4b825dc642cb6eb9a060e54bf8d69288fbee4904", "HEAD"])
    ).stdout;
    expect(numstat).toBe("-\t-\tearly.txt\n1\t0\tlate.txt\n");
    const expected: [string, string][] = [
      ["late.txt", "text"],
      ["early.txt", "binary"],
    ];
    for (const [name, kind] of expected) {
      const blob = (await git(["rev-parse", `HEAD:${name}`])).stdout.trim();
      expect((await readBlobSide(repo, blob)).kind).toBe(kind);
      expect((await readWorktreeSide(repo, name)).kind).toBe(kind);
    }
  });

  it("refuses a name of the other hash length, which git would read as a ref", async () => {
    const base = await scratch();
    const config = join(base, "gitconfig");
    await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
    const env = gitEnvironment(config);
    const formats: [string, string][] = [
      ["sha1", "a".repeat(64)],
      ["sha256", "a".repeat(40)],
    ];
    for (const [format, other] of formats) {
      const repo = join(base, format);
      const git = (args: string[]) => run("git", ["-C", repo, ...args], { env });
      await run("git", ["init", "-q", "-b", "main", `--object-format=${format}`, repo], { env });
      await writeFile(join(repo, "file.txt"), "secret\n");
      await git(["add", "."]);
      await git(["commit", "-q", "-m", "one"]);
      const blob = (await git(["rev-parse", "HEAD:file.txt"])).stdout.trim();
      await git(["update-ref", `refs/tags/${other}`, blob]);
      expect(await readBlobSide(repo, blob)).toEqual({ kind: "text", text: "secret\n" });
      expect(await readBlobSide(repo, other)).toEqual({ kind: "refused" });
    }
  });

  it.skipIf(!hasNoLazyFetch)(
    "answers not-local for a blob a partial clone left on its remote, without fetching it",
    async () => {
      const base = await scratch();
      const upstream = join(base, "upstream");
      const clone = join(base, "clone");
      const config = join(base, "gitconfig");
      await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
      const env = gitEnvironment(config);
      const git = (folder: string, args: string[]) => run("git", ["-C", folder, ...args], { env });
      await run("git", ["init", "-q", "-b", "main", upstream], { env });
      await git(upstream, ["config", "uploadpack.allowFilter", "true"]);
      await writeFile(join(upstream, "file.txt"), "one\n");
      await git(upstream, ["add", "."]);
      await git(upstream, ["commit", "-q", "-m", "one"]);
      const url = `file://${upstream.replaceAll("\\", "/")}`;
      await run("git", ["clone", "-q", "--no-checkout", "--filter=blob:none", url, clone], { env });
      const oid = (await git(clone, ["rev-parse", "HEAD:file.txt"])).stdout.trim();
      expect(await readBlobSide(clone, oid)).toEqual({ kind: "not-local" });
      const local = run("git", ["--no-lazy-fetch", "-C", clone, "cat-file", "-e", oid], { env });
      await expect(local).rejects.toThrow();
    },
  );
});
