import { describe, expect, it, vi } from "vitest";
import { gitReadMs, runGit } from "./git-command.ts";

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

describe("runGit", () => {
  it("answers at once for a git that never exits, and starts none in that folder until it does", async () => {
    const stuck = "/Users/<name>/code/stuck";
    expect(await runGit(stuck, ["status"], gitReadMs)).toBeUndefined();
    const release = git.exit;
    expect(await runGit(stuck, ["status"], gitReadMs)).toBeUndefined();
    expect(git.folders).toEqual([stuck]);
    expect(await runGit("/Users/<name>/code/other", ["status"], gitReadMs)).toBeUndefined();
    expect(git.folders).toEqual([stuck, "/Users/<name>/code/other"]);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await runGit(stuck, ["status"], gitReadMs);
    expect(git.folders).toEqual([stuck, "/Users/<name>/code/other", stuck]);
  });
});
