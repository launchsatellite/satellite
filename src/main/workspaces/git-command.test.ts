import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { gitArgs, gitReadMs, readGit, runGit } from "./git-command.ts";

const git = vi.hoisted(() => ({
  folders: new Array<string>(),
  exit: (): void => undefined,
}));

vi.mock("../platform/tools.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/tools.ts")>();
  return {
    ...actual,
    runTool: (...args: Parameters<typeof actual.runTool>) => {
      const [, toolArgs] = args;
      git.folders.push(toolArgs[2] ?? "");
      const exited = new Promise<void>((resolve) => {
        git.exit = resolve;
      });
      return Promise.reject(new actual.AbandonedRun("git did not finish in time", exited));
    },
  };
});

vi.mock("./repository-config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repository-config.ts")>()),
  refusePartialClone: () => Promise.resolve(),
}));

describe("runGit", () => {
  it("answers at once for a git that never exits, and starts none in that folder until it does", async () => {
    const stuck = join(tmpdir(), "code", "stuck");
    const other = join(tmpdir(), "code", "other");
    expect(await runGit(stuck, ["status"], gitReadMs)).toBeUndefined();
    const release = git.exit;
    expect(await runGit(stuck, ["status"], gitReadMs)).toBeUndefined();
    expect(git.folders).toEqual([stuck]);
    expect(await runGit(other, ["status"], gitReadMs)).toBeUndefined();
    expect(git.folders).toEqual([stuck, other]);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await runGit(stuck, ["status"], gitReadMs);
    expect(git.folders).toEqual([stuck, other, stuck]);
  });

  it("names a git that never exits as stuck", async () => {
    const folder = join(tmpdir(), "code", "named");
    expect(await readGit(folder, ["status"], gitReadMs)).toBe("stuck");
    expect(await readGit(folder, ["status"], gitReadMs)).toBe("stuck");
    git.exit();
  });
});

describe("gitArgs", () => {
  it("refuses a folder that would run git somewhere else", () => {
    const repo = join(tmpdir(), "repo");
    for (const folder of ["", ".", "repo", "../repo"]) {
      expect(() => gitArgs(folder, ["status"])).toThrow();
    }
    expect(gitArgs(repo, ["status"]).slice(0, 3)).toEqual(["--no-optional-locks", "-C", repo]);
  });
});
