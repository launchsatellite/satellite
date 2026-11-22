import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { readChangeList } from "../changes/change-list.ts";
import { readStatus } from "./changed-files.ts";
import {
  lazyFetchVerdict,
  parseConfigEntries,
  readConfigEntries,
  refusesReads,
  repositoryConfig,
} from "./repository-config.ts";

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
const probeSaid =
  "fatal: '/tmp/x/satellite-lazy-fetch-probe' does not appear to be a git repository";

function answer(exitCode: number, stderr: string) {
  return { exitCode, stdout: "", stderr };
}

describe("parseConfigEntries", () => {
  it("reads scopes, keys with spaces or equals signs, values with newlines and bare keys", () => {
    expect(
      parseConfigEntries(
        "local\0filter.a b=c.clean\nrun %f\0global\0remote.origin.promisor\0local\0x.y\nline\nnext\0",
      ),
    ).toEqual([
      { scope: "local", key: "filter.a b=c.clean", value: "run %f" },
      { scope: "global", key: "remote.origin.promisor", value: null },
      { scope: "local", key: "x.y", value: "line\nnext" },
    ]);
    expect(parseConfigEntries("")).toEqual([]);
    expect(parseConfigEntries("local\0cut")).toBeUndefined();
    expect(parseConfigEntries("local\0")).toBeUndefined();
  });
});

describe("readConfigEntries", () => {
  it("blanks only the repository's own drivers and lets them fail open", () => {
    const read = readConfigEntries([
      { scope: "local", key: "filter.x=y.clean", value: "m" },
      { scope: "worktree", key: "filter.w.process", value: "m" },
      { scope: "global", key: "filter.lfs.process", value: "git-lfs filter-process" },
    ]);
    expect(read.blanks).toEqual([
      ["filter.x=y.clean", ""],
      ["filter.x=y.process", ""],
      ["filter.x=y.required", "false"],
      ["filter.w.clean", ""],
      ["filter.w.process", ""],
      ["filter.w.required", "false"],
    ]);
    expect(read).toMatchObject({ partial: false, includes: false });
  });

  it("names a partial clone by either key, whatever the scope", () => {
    const partial = (key: string, value: string | null) =>
      readConfigEntries([{ scope: "global", key, value }]).partial;
    expect(partial("extensions.partialclone", "origin")).toBe(true);
    expect(partial("remote.origin.promisor", null)).toBe(true);
    expect(partial("remote.origin.promisor", "TRUE")).toBe(true);
    expect(partial("remote.origin.promisor", "off")).toBe(false);
    expect(partial("remote.origin.promisor", "")).toBe(false);
  });

  it("notices an include in the repository's own config only", () => {
    const includes = (scope: string, key: string) =>
      readConfigEntries([{ scope, key, value: "x" }]).includes;
    expect(includes("local", "include.path")).toBe(true);
    expect(includes("worktree", "includeif.onbranch:main.path")).toBe(true);
    expect(includes("global", "include.path")).toBe(false);
  });
});

describe("lazy fetch decision", () => {
  it("trusts a git only when the control reached the probe remote and the guarded run did not", () => {
    const control = answer(128, probeSaid);
    expect(lazyFetchVerdict(control, answer(1, ""))).toBe(true);
    expect(lazyFetchVerdict(control, answer(128, "warning: lazy fetching disabled"))).toBe(true);
    expect(lazyFetchVerdict(control, answer(128, probeSaid))).toBe(false);
    expect(lazyFetchVerdict(control, answer(0, ""))).toBe(false);
    expect(lazyFetchVerdict(answer(128, "fatal: bad config"), answer(1, ""))).toBe(false);
    expect(lazyFetchVerdict(undefined, answer(1, ""))).toBe(false);
    expect(lazyFetchVerdict(control, undefined)).toBe(false);
  });

  it("refuses reads only for a partial clone, or one it could not read, on a git that ignores the switch", () => {
    const plain = { blanks: [], partial: false, includes: false };
    const partial = { ...plain, partial: true };
    expect(refusesReads(true, partial)).toBe(false);
    expect(refusesReads(true, undefined)).toBe(false);
    expect(refusesReads(false, plain)).toBe(false);
    expect(refusesReads(false, partial)).toBe(true);
    expect(refusesReads(false, undefined)).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")(
  "filters a repository names",
  { timeout: 60_000 },
  () => {
    async function hostile() {
      const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-filters-")));
      const config = join(base, "gitconfig");
      await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
      process.env["GIT_CONFIG_GLOBAL"] = config;
      process.env["GIT_CONFIG_NOSYSTEM"] = "1";
      const repo = join(base, "repo");
      const hits = join(base, "hits");
      const marker = join(base, "marker.sh");
      await writeFile(marker, `#!/bin/sh\necho "$1" >> "${hits}"\ncat\n`);
      await chmod(marker, 0o755);
      await writeFile(hits, "");
      const git = (...args: string[]) => run("git", ["-C", repo, ...args]);
      await run("git", ["init", "-q", "-b", "main", repo]);
      await writeFile(join(repo, ".gitattributes"), "* filter=x=y\n");
      await writeFile(join(repo, "a.txt"), "a\n");
      await git("add", ".");
      await git("commit", "-q", "-m", "one");
      await git("config", "filter.x=y.clean", `${marker} clean`);
      await git("config", "filter.x=y.process", `${marker} process`);
      await git("config", "filter.x=y.required", "true");
      await writeFile(join(repo, "a.txt"), "b\n");
      const touch = async () => {
        const later = new Date(Date.now() + 10_000);
        await utimes(join(repo, "a.txt"), later, later);
        await utimes(join(repo, ".gitattributes"), later, later);
      };
      return { repo, hits, git, touch, marked: () => readFile(hits, "utf8") };
    }

    it("runs no clean or process filter on the sidebar's status or the Changes list", async () => {
      const { repo, git, touch, marked } = await hostile();
      await touch();
      await git("--no-optional-locks", "status", "--porcelain").catch(() => undefined);
      expect(await marked()).not.toBe("");
      await writeFile(join(repo, "../hits"), "");
      await touch();
      expect((await readStatus(repo))?.entries).toEqual([{ code: " M", path: "a.txt" }]);
      const head = (await git("rev-parse", "HEAD")).stdout.trim();
      expect(await readChangeList(repo, head, new AbortController().signal)).toMatchObject({
        kind: "files",
      });
      expect(await marked()).toBe("");
    });

    it("reads the config once while it stays the same, again when it changes, and every time it includes", async () => {
      const { repo, git } = await hostile();
      const first = await repositoryConfig(repo);
      expect(await repositoryConfig(repo)).toBe(first);
      await git("config", "filter.other.clean", "x");
      const changed = await repositoryConfig(repo);
      expect(changed).not.toBe(first);
      expect(changed?.blanks.map(([key]) => key)).toContain("filter.other.clean");
      await git("config", "include.path", join(repo, "..", "gitconfig"));
      const included = await repositoryConfig(repo);
      expect(included?.includes).toBe(true);
      expect(await repositoryConfig(repo)).not.toBe(included);
    });
  },
);
