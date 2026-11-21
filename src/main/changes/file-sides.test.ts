import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { isChangePath, readBlobSide, readWorktreeSide } from "./file-sides.ts";

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
    expect(await readWorktreeSide(root, "../outside/secret.txt")).toEqual({ kind: "refused" });
    expect(await readWorktreeSide(join(root, "linked"), "secret.txt")).toEqual({
      kind: "text",
      text: "secret\n",
    });
  });

  it("refuses anything under .git, whatever its case", async () => {
    const { root } = await worktree();
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "config"), "[core]\n");
    expect(await readWorktreeSide(root, ".git/config")).toEqual({ kind: "refused" });
    expect(await readWorktreeSide(root, ".GIT/config")).toEqual({ kind: "refused" });
  });

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

  it("keeps line endings, a byte order mark and invalid bytes visible", async () => {
    const { root } = await worktree();
    await writeFile(
      join(root, "mixed.txt"),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("a\r\nb\n"),
        Buffer.from([0xff]),
      ]),
    );
    expect(await readWorktreeSide(root, "mixed.txt")).toEqual({
      kind: "text",
      text: "\ufeffa\r\nb\n\ufffd",
    });
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
  it("reads a committed blob and refuses a made-up object name", async () => {
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
    await git(["add", "."]);
    await git(["commit", "-q", "-m", "one"]);
    const oid = async (spec: string) => (await git(["rev-parse", spec])).stdout.trim();
    expect(await readBlobSide(repo, await oid("HEAD:file.txt"))).toEqual({
      kind: "text",
      text: "one\r\ntwo\n",
    });
    expect(await readBlobSide(repo, await oid("HEAD:data.bin"))).toEqual({ kind: "binary" });
    expect(await readBlobSide(repo, await oid("HEAD:lines.txt"))).toEqual({ kind: "large" });
    expect(await readBlobSide(repo, await oid("HEAD"))).toEqual({ kind: "gone" });
    expect(await readBlobSide(repo, "1".repeat(40))).toEqual({ kind: "gone" });
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
