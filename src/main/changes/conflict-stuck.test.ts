import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { conflictCheck } from "./conflict-check.ts";

const stuck = vi.hoisted(() => ({ released: Promise.resolve(), refused: 1 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: (path: string, options?: Parameters<typeof actual.rm>[1]) => {
      if (path.includes("quarantine") && /[0-9a-f]{8}-/.test(path) && stuck.refused > 0) {
        stuck.refused -= 1;
        return Promise.reject(new Error("the folder is in use"));
      }
      return actual.rm(path, options);
    },
  };
});

vi.mock("../workspaces/git-command.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workspaces/git-command.ts")>();
  return {
    ...actual,
    readGit: (...call: Parameters<typeof actual.readGit>) =>
      call[1].includes("merge-tree") ? Promise.resolve("stuck" as const) : actual.readGit(...call),
    whenGitExits: () => stuck.released,
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

describe("a stuck trial merge", { timeout: 30_000 }, () => {
  it("leaves its scratch folder removed once git has exited", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-stuck-")));
    const config = join(base, "gitconfig");
    await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
    process.env["GIT_CONFIG_GLOBAL"] = config;
    process.env["GIT_CONFIG_NOSYSTEM"] = "1";
    const home = join(base, "home");
    await mkdir(home);
    const repo = join(base, "repo");
    await run("git", ["init", "-q", "-b", "main", repo]);
    const git = async (...args: string[]) =>
      (await run("git", ["-C", repo, ...args])).stdout.trim();
    await writeFile(join(repo, "a.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    const head = await git("rev-parse", "HEAD");
    let finish: () => void = () => undefined;
    stuck.released = new Promise<void>((settle) => {
      finish = settle;
    });
    expect(await conflictCheck(home, repo, head, head)).toEqual({ kind: "slow" });
    finish();
    await vi.waitFor(async () => {
      expect(await readdir(join(home, "quarantine"))).toEqual([]);
    });
  });
});
