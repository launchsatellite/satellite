import { execFile } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { isPushed } from "./pushed-branch.ts";

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
const signal = new AbortController().signal;

async function repository() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-pushed-")));
  const repo = join(base, "repo");
  const remote = join(base, "remote.git");
  const config = join(base, "gitconfig");
  await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  const env = { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
  await run("git", ["init", "-q", "--bare", "-b", "main", remote], { env });
  await run("git", ["init", "-q", "-b", "main", repo], { env });
  const git = (...args: string[]) => run("git", ["-C", repo, ...args], { env });
  await git("commit", "-q", "--allow-empty", "-m", "one");
  await git("remote", "add", "origin", remote);
  return { repo, git };
}

describe("isPushed", { timeout: 30_000 }, () => {
  it("a branch with an upstream is pushed", async () => {
    const { repo, git } = await repository();
    await git("push", "-q", "-u", "origin", "main");
    expect(await isPushed(repo, "main", signal)).toBe(true);
  });

  it("a branch whose upstream is configured is pushed even before a fetch", async () => {
    const { repo, git } = await repository();
    await git("checkout", "-q", "-b", "topic");
    expect(await isPushed(repo, "topic", signal)).toBe(false);
    await git("config", "branch.topic.remote", "origin");
    await git("config", "branch.topic.merge", "refs/heads/topic");
    expect(await isPushed(repo, "topic", signal)).toBe(true);
  });

  it("a branch pushed without an upstream is pushed", async () => {
    const { repo, git } = await repository();
    await git("checkout", "-q", "-b", "topic");
    await git("push", "-q", "origin", "topic");
    expect(await isPushed(repo, "topic", signal)).toBe(true);
  });

  it("a branch with a slash is found", async () => {
    const { repo, git } = await repository();
    await git("checkout", "-q", "-b", "feat/deep/topic");
    await git("push", "-q", "origin", "feat/deep/topic");
    expect(await isPushed(repo, "feat/deep/topic", signal)).toBe(true);
    await git("checkout", "-q", "-b", "topic");
    expect(await isPushed(repo, "topic", signal)).toBe(false);
  });

  it("a new local branch is not", async () => {
    const { repo, git } = await repository();
    await git("push", "-q", "origin", "main");
    await git("checkout", "-q", "-b", "fresh");
    expect(await isPushed(repo, "fresh", signal)).toBe(false);
  });

  it("a detached head is not", async () => {
    const { repo } = await repository();
    expect(await isPushed(repo, null, signal)).toBe(false);
  });

  it("answers undefined for a name git would read as an option", async () => {
    const { repo } = await repository();
    expect(await isPushed(repo, "--all", signal)).toBeUndefined();
  });
});
