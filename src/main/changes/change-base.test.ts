import { execFile } from "node:child_process";
import { chmod, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { currentBranch, headOid, mergeBase, resolveBase } from "./change-base.ts";

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

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-base-")));
  const config = join(base, "gitconfig");
  await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  const env = { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
  const git = async (folder: string, ...args: string[]) =>
    (await run("git", ["-C", folder, ...args], { env })).stdout.trim();
  const repository = async (name: string) => {
    const folder = join(base, name);
    await run("git", ["init", "-q", "-b", "main", folder], { env });
    await writeFile(join(folder, "file.txt"), `${name}\n`);
    await git(folder, "add", ".");
    await git(folder, "commit", "-q", "-m", name);
    return folder;
  };
  return { base, env, git, repository };
}

describe("resolveBase", { timeout: 30_000 }, () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "answers failed, never another branch, when the remote's default cannot be read",
    async () => {
      const { base, env, git, repository } = await sandbox();
      const upstream = await repository("upstream");
      const clone = join(base, "clone");
      await run("git", ["clone", "-q", upstream, clone], { env });
      const head = join(clone, ".git", "refs", "remotes", "origin", "HEAD");
      await chmod(head, 0o000);
      expect(await git(clone, "branch", "--show-current")).toBe("main");
      expect(await resolveBase(clone, clone)).toEqual({ kind: "failed" });
      await chmod(head, 0o600);
    },
  );

  it("compares with the remote's default branch when git knows it", async () => {
    const { base, env, git, repository } = await sandbox();
    const upstream = await repository("upstream");
    const clone = join(base, "clone");
    await run("git", ["clone", "-q", upstream, clone], { env });
    const folder = join(base, "work");
    await git(clone, "worktree", "add", "-q", "-b", "work", folder);
    const oid = await git(clone, "rev-parse", "refs/remotes/origin/main");
    const expected = {
      kind: "base",
      base: { ref: "refs/remotes/origin/main", name: "origin/main", oid },
    };
    expect(await resolveBase(clone, folder)).toEqual(expected);
    expect(await resolveBase(clone, clone)).toEqual(expected);
    await git(clone, "update-ref", "-d", "refs/remotes/origin/main");
    expect(await resolveBase(clone, folder)).toEqual({ kind: "none", why: "gone" });
  });

  it("falls back to the main folder's branch without a remote", async () => {
    const { base, git, repository } = await sandbox();
    const root = await repository("root");
    const folder = join(base, "work");
    await git(root, "worktree", "add", "-q", "-b", "work", folder);
    await writeFile(join(folder, "file.txt"), "changed\n");
    await git(folder, "commit", "-q", "-am", "work");
    expect(await resolveBase(root, folder)).toEqual({
      kind: "base",
      base: { ref: "refs/heads/main", name: "main", oid: await git(root, "rev-parse", "main") },
    });
    expect(await currentBranch(folder)).toBe("work");
    await git(root, "switch", "-q", "--detach");
    expect(await currentBranch(root)).toBeNull();
    expect(await resolveBase(root, folder)).toEqual({ kind: "none", why: "main-detached" });
  });

  it("has no base for the main workspace without a remote", async () => {
    const { git, repository } = await sandbox();
    const root = await repository("root");
    expect(await resolveBase(root, root)).toEqual({ kind: "none", why: "main-workspace" });
    await git(root, "remote", "add", "origin", "https://example.invalid/repo.git");
    expect(await resolveBase(root, root)).toEqual({ kind: "none", why: "main-workspace" });
  });
});

describe("mergeBase", { timeout: 30_000 }, () => {
  it("answers unrelated histories as no merge base", async () => {
    const { base, env, git, repository } = await sandbox();
    const root = await repository("root");
    const first = await git(root, "rev-parse", "HEAD");
    await git(root, "switch", "-q", "--orphan", "other");
    await writeFile(join(root, "other.txt"), "other\n");
    await git(root, "add", "other.txt");
    await git(root, "commit", "-q", "-m", "other");
    const second = await git(root, "rev-parse", "HEAD");
    expect(await mergeBase(root, first, second)).toBeNull();
    expect(await mergeBase(root, first, first)).toBe(first);
    expect(await mergeBase(root, "HEAD", first)).toBeUndefined();
    expect(await mergeBase(root, "1".repeat(40), first)).toBeUndefined();
    const empty = join(base, "empty");
    await run("git", ["init", "-q", "-b", "main", empty], { env });
    expect(await headOid(empty)).toBeNull();
    expect(await headOid(root)).toBe(second);
  });
});
