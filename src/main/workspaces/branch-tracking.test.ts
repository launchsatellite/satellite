import { execFile } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTrack, readTracking } from "./branch-tracking.ts";

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

function gitEnvironment(config: string): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  return { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseTrack", () => {
  it("reads ahead and behind from every track shape", () => {
    expect(parseTrack("")).toEqual({ ahead: 0, behind: 0 });
    expect(parseTrack("ahead 2")).toEqual({ ahead: 2, behind: 0 });
    expect(parseTrack("behind 1")).toEqual({ ahead: 0, behind: 1 });
    expect(parseTrack("ahead 2, behind 1")).toEqual({ ahead: 2, behind: 1 });
    expect(parseTrack("gone")).toBeNull();
    expect(parseTrack("ahead 9999999")).toEqual({ ahead: 1_000_000, behind: 0 });
    expect(parseTrack(`behind ${"9".repeat(400)}`)).toEqual({ ahead: 0, behind: 1_000_000 });
    for (const unreadable of [
      "[ahead 2]",
      "ahead",
      "ahead -1",
      "behind 1, ahead 2",
      "ahead 2,",
      " ahead 2",
      "ahead 2\n",
    ]) {
      expect(parseTrack(unreadable)).toBeNull();
    }
  });
});

describe("readTracking", () => {
  it("reads only the branches it was asked for", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-tracking-")));
    const repo = join(base, "repo");
    const config = join(base, "gitconfig");
    await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const git = (args: string[]) =>
      run("git", ["-C", repo, ...args], { env: gitEnvironment(config) });
    await run("git", ["init", "-q", "-b", "main", repo], { env: gitEnvironment(config) });
    await writeFile(join(repo, "a"), "a\n");
    await git(["add", "a"]);
    await git(["commit", "-q", "-m", "one"]);
    await git(["branch", "w1/inner"]);
    await git(["branch", "--set-upstream-to=main", "w1/inner"]);
    await git(["checkout", "-q", "-b", "w2"]);
    await git(["commit", "-q", "--allow-empty", "-m", "two"]);
    await git(["branch", "--set-upstream-to=main", "w2"]);
    expect(await readTracking(repo, ["w2", "main", "w2", "w1", "missing"])).toEqual(
      new Map([
        ["main", null],
        ["w2", { ahead: 1, behind: 0 }],
      ]),
    );
    expect(await readTracking(repo, [])).toEqual(new Map());
    expect(await readTracking(join(base, "absent"), ["main"])).toEqual(new Map());
  });
});
