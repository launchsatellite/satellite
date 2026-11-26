import { execFile, execFileSync } from "node:child_process";
import type { BigIntStats } from "node:fs";
import { renameSync, symlinkSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { changesLimits } from "../../shared/bridge-contract.ts";
import { gitReadMs } from "../workspaces/git-command.ts";
import { parseDiff, parseUnmerged, parseUntracked, readChangeList } from "./change-list.ts";
import { readWorktreeSide } from "./file-sides.ts";

const stampedByGit = vi.hoisted(() => /(?:[\\/]repo|[\\/]\.git(?:[\\/].*)?)$/s);

const fileCalls = vi.hoisted(() => {
  const calls: { lstat?: ((path: string) => Promise<BigIntStats> | undefined) | undefined } = {};
  return calls;
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: (path: string, options: { bigint: true }) =>
      (stampedByGit.test(path) ? undefined : fileCalls.lstat?.(path)) ??
      actual.lstat(path, options),
  };
});

const gitCalls = vi.hoisted(() => {
  const calls: {
    stop?: "time" | "stuck" | undefined;
    diff?: string | undefined;
    untrackedOverflow?: boolean;
    seen: string[][];
  } = { seen: [] };
  return calls;
});

vi.mock("../workspaces/git-command.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workspaces/git-command.ts")>();
  return {
    ...actual,
    readGit: (...args: Parameters<typeof actual.readGit>) => {
      gitCalls.seen.push([...args[1]]);
      if (gitCalls.diff !== undefined && args[1].includes("--raw")) {
        return Promise.resolve({ exitCode: 0, stdout: gitCalls.diff, stderr: "" });
      }
      if (gitCalls.untrackedOverflow === true && args[1].includes("--others")) {
        return Promise.resolve("output" as const);
      }
      return gitCalls.stop === undefined ? actual.readGit(...args) : Promise.resolve(gitCalls.stop);
    },
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
const zero = "0".repeat(40);
const one = "3e757656cf36eca53338e520d134963a44f793f8";
const two = "de980441c3ab03a8c07dda1ad27b8a11f39deb1e";
const three = "b2f931a67315c95c5daab3aac6de62e534808476";
const sub = "90fde2c914965fe2a6423cbd3f083e6d4cfc9410";

function raw(modes: string, from: string, to: string, status: string, ...paths: string[]) {
  return [`:${modes} ${from} ${to} ${status}`, ...paths];
}

function stat(added: string, removed: string, ...paths: string[]) {
  const [first = "", second] = paths;
  return second === undefined
    ? [`${added}\t${removed}\t${first}`]
    : [`${added}\t${removed}\t`, first, second];
}

function output(...records: string[][]): string {
  return records
    .flat()
    .map((field) => `${field}\0`)
    .join("");
}

function change(path: string, extra: Record<string, unknown>) {
  return {
    path,
    from: null,
    tracked: true,
    kind: "text",
    sourceOid: null,
    targetOid: null,
    ...extra,
  };
}

async function scratch(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "satellite-list-")));
}

async function repository() {
  const base = await scratch();
  const repo = join(base, "repo");
  const config = join(base, "gitconfig");
  await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  const env = { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
  await run("git", ["init", "-q", "-b", "main", repo], { env });
  const git = async (...args: string[]) =>
    (await run("git", ["-C", repo, ...args], { env })).stdout.trim();
  const index = (lines: string[]) => {
    execFileSync("git", ["-C", repo, "update-index", "--index-info"], {
      env,
      input: lines.join("\n"),
    });
  };
  return { repo, git, env, index };
}

async function listed(folder: string, compareWith: string) {
  const read = await readChangeList(folder, compareWith, new AbortController().signal);
  if (read.kind !== "files") throw new Error(`the list answered ${read.reason}`);
  return read;
}

describe("parseDiff shapes", () => {
  it("marks a mode-only change and a link", () => {
    const stdout = output(
      raw("100644 100755", one, one, "M", "run.sh"),
      raw("000000 120000", zero, two, "A", "ln"),
      raw("100644 100644", one, three, "M", "edit.txt"),
      raw("100644 100755", one, one, "R100", "was.sh", "now.sh"),
      stat("0", "0", "run.sh"),
      stat("1", "0", "ln"),
      stat("1", "1", "edit.txt"),
      stat("0", "0", "was.sh", "now.sh"),
    );
    const found = parseDiff(stdout)?.records.map((record) => [record.path, record.shape]);
    expect(found).toEqual([
      ["run.sh", "mode"],
      ["ln", "link"],
      ["edit.txt", undefined],
      ["now.sh", "mode"],
    ]);
  });
});

describe("parseDiff", () => {
  it("reads an edit, an addition, a deletion and a rename with their letters and counts", () => {
    const stdout = output(
      raw("000000 100644", zero, one, "A", "added.txt"),
      raw("100644 000000", two, zero, "D", "deleted.txt"),
      raw("100644 100644", three, zero, "M", "edit.txt"),
      raw("100644 100644", one, one, "R100", "old.txt", "new.txt"),
      stat("1", "0", "added.txt"),
      stat("0", "1", "deleted.txt"),
      stat("2", "1", "edit.txt"),
      stat("0", "0", "old.txt", "new.txt"),
    );
    expect(parseDiff(stdout)).toEqual({
      records: [
        change("added.txt", { letter: "A", added: 1, removed: 0, targetOid: one }),
        change("deleted.txt", { letter: "D", added: 0, removed: 1, sourceOid: two }),
        change("edit.txt", { letter: "M", added: 2, removed: 1, sourceOid: three }),
        change("new.txt", {
          from: "old.txt",
          letter: "R",
          added: 0,
          removed: 0,
          sourceOid: one,
          targetOid: one,
        }),
      ],
      more: 0,
    });
    expect(parseDiff("")).toEqual({ records: [], more: 0 });
  });

  it("keeps names with spaces, quotes, unicode, newlines, colons and a leading dash whole", () => {
    const names = [
      ":start.txt",
      "-dash.txt",
      "with space .txt",
      'it\'s "quoted".txt',
      "café ☕.md",
      "tab\t1\t2\tlike numstat",
      "a -> b",
      ":100644 100644 x",
    ];
    const stdout = output(
      ...names.map((name) => raw("100644 100644", one, zero, "M", name)),
      raw("100644 100644", one, one, "R087", "old name.txt", "new\nname.txt"),
      ...names.map((name) => stat("3", "4", name)),
      stat("1", "2", "old name.txt", "new\nname.txt"),
    );
    const parsed = parseDiff(stdout);
    expect(parsed?.records.map((record) => [record.from, record.path])).toEqual([
      ...names.map((name) => [null, name]),
      ["old name.txt", "new\nname.txt"],
    ]);
    expect(parsed?.records.map((record) => [record.added, record.removed])).toEqual([
      ...names.map(() => [3, 4]),
      [1, 2],
    ]);
  });

  it("keeps the first records in UTF-16 order when a list passes the cap", () => {
    const names = Array.from(
      { length: changesLimits.parsed - 1 },
      (_, index) => `a${String(index).padStart(5, "0")}`,
    );
    const gitOrder = [...names, "\u{ffff}", "\u{10000}"];
    const stdout = output(
      ...gitOrder.map((path) => raw("100644 100644", one, two, "M", path)),
      ...gitOrder.map((path) => stat("1", "1", path)),
    );
    const parsed = parseDiff(stdout);
    expect(parsed?.more).toBe(1);
    expect(parsed?.records.at(-1)?.path).toBe("\u{10000}");
    expect(parsed?.records.map((record) => record.path)).not.toContain("\u{ffff}");
  });

  it("marks binary files and submodules", () => {
    const stdout = output(
      raw("100644 100644", one, zero, "M", "image.png"),
      raw("160000 160000", sub, zero, "M", "module"),
      raw("000000 160000", zero, sub, "A", "added-module"),
      stat("-", "-", "image.png"),
      stat("1", "1", "module"),
      stat("1", "0", "added-module"),
    );
    expect(parseDiff(stdout)?.records).toEqual([
      change("image.png", {
        letter: "M",
        kind: "binary",
        added: null,
        removed: null,
        sourceOid: one,
        statDirty: true,
      }),
      change("module", {
        letter: "M",
        kind: "submodule",
        added: null,
        removed: null,
        sourceOid: sub,
      }),
      change("added-module", {
        letter: "A",
        kind: "submodule",
        added: null,
        removed: null,
        targetOid: sub,
      }),
    ]);
  });

  it("reads a copy, a type change and a file in a merge", () => {
    const stdout = output(
      raw("100644 100644", one, one, "C075", "source.txt", "copy.txt"),
      raw("120000 100644", two, zero, "T", "link"),
      raw("000000 000000", zero, zero, "U", "conflict.txt"),
      raw("100644 100644", one, two, "X", "unknown.txt"),
      raw("100644 100644", one, two, "B", "other.txt"),
      stat("2", "0", "source.txt", "copy.txt"),
      stat("1", "1", "link"),
      stat("0", "0", "conflict.txt"),
      stat("1", "1", "unknown.txt"),
      stat("1", "1", "other.txt"),
    );
    expect(parseDiff(stdout)?.records).toEqual([
      change("copy.txt", {
        from: "source.txt",
        letter: "C",
        added: 2,
        removed: 0,
        sourceOid: one,
        targetOid: one,
      }),
      change("link", { letter: "T", added: 1, removed: 1, sourceOid: two, shape: "link" }),
      change("conflict.txt", { letter: "U", added: null, removed: null }),
    ]);
  });

  it("skips a stat-only entry that numstat leaves out and caps counts", () => {
    const stdout = output(
      raw("100644 100644", one, zero, "M", "touched.txt"),
      raw("100644 100644", one, zero, "M", "huge.txt"),
      stat("12345678901234567890", "1000001", "huge.txt"),
    );
    expect(parseDiff(stdout)?.records).toEqual([
      change("huge.txt", { letter: "M", added: 1_000_000, removed: 1_000_000, sourceOid: one }),
    ]);
  });

  it("refuses output that is cut off or whose counts do not match its records", () => {
    const edit = raw("100644 100644", one, zero, "M", "edit.txt");
    const rename = raw("100644 100644", one, one, "R100", "old.txt", "new.txt");
    const whole = output(edit, stat("1", "1", "edit.txt"));
    for (const stdout of [
      whole.slice(0, -1),
      whole.slice(0, whole.indexOf("edit.txt")),
      output(raw("100755 100644", one, zero, "M", "edit.txt")),
      output(raw("100644 000000", one, zero, "D", "gone.txt")),
      output(edit, stat("1", "1", "edit.txt"), stat("1", "1", "extra.txt")),
      output(edit, stat("1", "1", "other.txt")),
      output(edit, stat("1", "-", "edit.txt")),
      output(edit, stat("x", "1", "edit.txt")),
      output(edit, ["1\t1"]),
      output(rename, stat("0", "0", "new.txt")),
      output(rename, stat("0", "0", "old.txt", "renamed.txt")),
      output(rename, ["0\t0\t", "old.txt"]),
      output(raw("100644 100644", one, one, "R100", "old.txt")),
      output(
        raw("100644 100644", one.slice(0, 7), zero, "M", "edit.txt"),
        stat("1", "1", "edit.txt"),
      ),
      output(
        raw("100644 100644", one, "0".repeat(64), "M", "edit.txt"),
        stat("1", "1", "edit.txt"),
      ),
      output(raw("100644 100644", one, zero, "M", ""), stat("1", "1", "")),
      output([`:100644 100644 ${one} ${zero} M\tedit.txt`], stat("1", "1", "edit.txt")),
      output(["junk"]),
      "\0",
    ]) {
      expect(parseDiff(stdout), JSON.stringify(stdout)).toBeUndefined();
    }
  });

  it("keeps the first records it may parse and counts the rest", () => {
    const names = Array.from({ length: 5003 }, (_, index) => `f${String(index)}`);
    const stdout = output(
      ...names.map((name) => raw("100644 100644", one, zero, "M", name)),
      ...names.map((name) => stat("1", "1", name)),
    );
    const parsed = parseDiff(stdout);
    expect(parsed?.records).toHaveLength(5000);
    expect(parsed?.more).toBe(3);
  });
});

describe("parseUntracked", () => {
  it("lists a nested repository as a folder of its own", () => {
    expect(parseUntracked("a.txt\0nested/\0new\nline.txt\0")).toEqual([
      "a.txt",
      "nested/",
      "new\nline.txt",
    ]);
    expect(parseUntracked("")).toEqual([]);
    expect(parseUntracked("a.txt\0cut")).toBeUndefined();
  });
});

describe("parseUnmerged", () => {
  it("names each file in a merge once and refuses output that is cut off", () => {
    const stages = [
      `100644 ${one} 1\tboth\tname.txt`,
      `100644 ${two} 2\tboth\tname.txt`,
      `100644 ${three} 3\tboth\tname.txt`,
      `100644 ${two} 2\tnew\nline.txt`,
    ];
    expect(parseUnmerged(output(stages))).toEqual(["both\tname.txt", "new\nline.txt"]);
    expect(parseUnmerged("")).toEqual([]);
    for (const cut of [
      `100644 ${one} 1\tcut.txt`,
      output([`100644 ${one} 4\tstage.txt`]),
      output([`100644 ${one.slice(0, 7)} 1\tshort.txt`]),
      output([`100644 ${one} 1\t`]),
      output([`100644 ${one} 1 path.txt`]),
    ]) {
      expect(parseUnmerged(cut)).toBeUndefined();
    }
  });
});

describe("readChangeList", { timeout: 60_000 }, () => {
  it("lists a file in the middle of a merge as U, whichever view asks", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "clash.txt"), "base\n");
    await writeFile(join(repo, "calm.txt"), "calm\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "base");
    const fork = await git("rev-parse", "HEAD");
    await git("switch", "-q", "-c", "other");
    await writeFile(join(repo, "clash.txt"), "theirs\n");
    await writeFile(join(repo, "added both.txt"), "theirs\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "other");
    await git("switch", "-q", "main");
    await writeFile(join(repo, "clash.txt"), "ours\n");
    await writeFile(join(repo, "added both.txt"), "ours\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "main");
    await expect(git("merge", "-q", "other")).rejects.toThrow();
    for (const compareWith of [await git("rev-parse", "HEAD"), fork]) {
      const list = await listed(repo, compareWith);
      expect(list.records.map((record) => [record.path, record.letter, record.added])).toEqual([
        ["added both.txt", "U", null],
        ["clash.txt", "U", null],
      ]);
    }
  });

  it("lists a nested repository as a folder of its own", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "tracked.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await run("git", ["init", "-q", join(repo, "nested")]);
    await writeFile(join(repo, "nested", "inside.txt"), "inside\n");
    const list = await listed(repo, await git("rev-parse", "HEAD"));
    expect(list.records).toHaveLength(1);
    expect(list.records[0]).toMatchObject({
      path: "nested",
      letter: "A",
      tracked: false,
      kind: "repository",
      added: null,
      removed: null,
    });
    expect(list.records[0]?.stamp).toMatch(/^new:\d+:\d+:\d+$/);
  });

  it("counts untracked lines only within its budget", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "tracked.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    const head = await git("rev-parse", "HEAD");
    await mkdir(join(repo, "many"));
    for (let index = 0; index < 201; index += 1) {
      await writeFile(join(repo, "many", `f${String(index).padStart(3, "0")}.txt`), "line\n");
    }
    const many = await listed(repo, head);
    expect(many.records.slice(0, 200).every((record) => record.added === 1)).toBe(true);
    expect(many.records[200]).toMatchObject({ path: "many/f200.txt", added: null, removed: null });

    const big = await repository();
    await writeFile(join(big.repo, "tracked.txt"), "one\n");
    await big.git("add", ".");
    await big.git("commit", "-q", "-m", "one");
    for (let index = 0; index < 9; index += 1) {
      await writeFile(join(big.repo, `big-${String(index)}.txt`), `${"x".repeat(1_048_575)}\n`);
    }
    await writeFile(join(big.repo, "data.bin"), Buffer.from([1, 0, 2]));
    const bigList = await listed(big.repo, await big.git("rev-parse", "HEAD"));
    expect(bigList.records.map((record) => [record.path, record.kind, record.added])).toEqual([
      ...Array.from({ length: 8 }, (_, index) => [`big-${String(index)}.txt`, "text", 1]),
      ["big-8.txt", "text", null],
      ["data.bin", "text", null],
    ]);
    await writeFile(join(big.repo, "big-0.txt"), Buffer.from([1, 0, 2]));
    const binaryList = await listed(big.repo, await big.git("rev-parse", "HEAD"));
    expect(binaryList.records[0]).toMatchObject({
      path: "big-0.txt",
      kind: "binary",
      added: null,
    });
  });

  it("lists commits and uncommitted work against the merge base in one list", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "base.txt"), "base\n");
    await writeFile(join(repo, "edit.txt"), "a\nb\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "base");
    const fork = await git("rev-parse", "HEAD");
    await git("switch", "-q", "-c", "work");
    await writeFile(join(repo, "committed.txt"), "one\ntwo\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "work");
    await writeFile(join(repo, "edit.txt"), "a\nB\nc\n");
    await writeFile(join(repo, "untracked file.txt"), "new\n");
    await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
    await writeFile(join(repo, "ignored.txt"), "ignored\n");
    const list = await listed(repo, fork);
    expect(
      list.records.map((record) => [
        record.path,
        record.letter,
        record.tracked,
        record.added,
        record.removed,
      ]),
    ).toEqual([
      [".gitignore", "A", false, 1, 0],
      ["committed.txt", "A", true, 2, 0],
      ["edit.txt", "M", true, 2, 1],
      ["untracked file.txt", "A", false, 1, 0],
    ]);
    expect(list.more).toBe(0);
    expect(list.records[2]?.stamp).toMatch(/^[0-9a-f]{40}:\d+:\d+:\d+$/);
    expect(await readChangeList(repo, "HEAD", new AbortController().signal)).toEqual({
      kind: "unavailable",
      reason: "failed",
    });
  });

  it.skipIf(!hasNoLazyFetch)(
    "answers not-local for a list whose objects a partial clone never downloaded, without fetching them",
    async () => {
      const upstream = await repository();
      await upstream.git("config", "uploadpack.allowFilter", "true");
      await writeFile(join(upstream.repo, "file.txt"), "one\n");
      await upstream.git("add", ".");
      await upstream.git("commit", "-q", "-m", "one");
      const clone = join(upstream.repo, "..", "clone");
      const url = `file://${upstream.repo.replaceAll("\\", "/")}`;
      await upstream.git("clone", "-q", "--no-checkout", "--filter=blob:none", url, clone);
      const head = (
        await run("git", ["-C", clone, "rev-parse", "HEAD"], { env: upstream.env })
      ).stdout.trim();
      const signal = new AbortController().signal;
      expect(await readChangeList(clone, head, signal)).toEqual({
        kind: "unavailable",
        reason: "not-local",
      });
      const blob = (
        await run("git", ["-C", clone, "rev-parse", "HEAD:file.txt"], { env: upstream.env })
      ).stdout.trim();
      const local = run("git", ["--no-lazy-fetch", "-C", clone, "cat-file", "-e", blob], {
        env: upstream.env,
      });
      await expect(local).rejects.toThrow();
      await writeFile(join(clone, ".git", "index"), "not an index");
      expect(await readChangeList(clone, head, signal)).toEqual({
        kind: "unavailable",
        reason: "failed",
      });
    },
  );

  it("lists a file once when git names it as deleted and as untracked", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "kept.txt"), "kept\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await git("rm", "-q", "--cached", "kept.txt");
    const list = await listed(repo, await git("rev-parse", "HEAD"));
    expect(list.records.map((record) => [record.path, record.letter, record.tracked])).toEqual([
      ["kept.txt", "D", true],
    ]);
  });

  it("counts a path too long to name instead of failing the list", async () => {
    const { repo, git, index } = await repository();
    await writeFile(join(repo, "short.txt"), "short\n");
    await git("add", ".");
    const blob = await git("rev-parse", ":short.txt");
    const long = `${"d".repeat(changesLimits.pathChars)}/x.txt`;
    index([`100644 ${blob}\t${long}`]);
    await git("commit", "-q", "-m", "one");
    const list = await listed(repo, await git("rev-parse", "HEAD"));
    expect(list.records.map((record) => record.path)).toEqual([]);
    expect(list.longPaths).toBe(1);
  });

  it("keeps every edited tracked file when untracked files pass the cap", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "z.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await writeFile(join(repo, "z.txt"), "two\n");
    await mkdir(join(repo, "a"));
    for (let at = 0; at < changesLimits.files; at += 1) {
      await writeFile(join(repo, "a", `${String(at).padStart(4, "0")}.out`), "");
    }
    const list = await listed(repo, await git("rev-parse", "HEAD"));
    expect(list.records).toHaveLength(changesLimits.files);
    expect(list.records.at(-1)?.path).toBe("z.txt");
    expect(list.records[0]?.path).toBe("a/0000.out");
    expect(list.more).toBe(1);
  });

  it("keeps the tracked edits when the untracked names are too many to read", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "edited.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await writeFile(join(repo, "edited.txt"), "two\n");
    await writeFile(join(repo, "new.txt"), "new\n");
    gitCalls.untrackedOverflow = true;
    try {
      const list = await listed(repo, await git("rev-parse", "HEAD"));
      expect(list.records.map((record) => [record.path, record.letter])).toEqual([
        ["edited.txt", "M"],
      ]);
      expect(list.untrackedLeftOut).toBe(true);
    } finally {
      gitCalls.untrackedOverflow = false;
    }
    expect((await listed(repo, await git("rev-parse", "HEAD"))).untrackedLeftOut).toBe(false);
  });

  it("answers too-many for a list longer than Satellite reads", async () => {
    const { repo, git, index } = await repository();
    await writeFile(join(repo, "short.txt"), "short\n");
    await git("add", ".");
    const blob = await git("rev-parse", ":short.txt");
    const folder = `${"f".repeat(3980)}/`;
    index(
      Array.from(
        { length: 2100 },
        (_, at) => `100644 ${blob}\t${folder}${String(at).padStart(5, "0")}.txt`,
      ),
    );
    await git("commit", "-q", "-m", "many");
    expect(
      await readChangeList(repo, await git("rev-parse", "HEAD"), new AbortController().signal),
    ).toEqual({ kind: "unavailable", reason: "too-many" });
  });

  it("leaves out a binary file whose bytes are unchanged and lists one whose bytes changed", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "same.dat"), Buffer.from([97, 0, 98]));
    await writeFile(join(repo, "other.dat"), Buffer.from([97, 0, 98]));
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    const later = new Date(Date.now() + 60_000);
    await utimes(join(repo, "same.dat"), later, later);
    await writeFile(join(repo, "other.dat"), Buffer.from([97, 0, 99]));
    const list = await listed(repo, await git("rev-parse", "HEAD"));
    expect(list.records.map((record) => [record.path, record.letter, record.kind])).toEqual([
      ["other.dat", "M", "binary"],
    ]);
  });

  it("lists a text file bigger than a side as binary, so git never loads it whole", async () => {
    const { repo, git } = await repository();
    const lines = (count: number, word: string) => `${word}\n`.repeat(count);
    await writeFile(join(repo, "big.txt"), lines(300_000, "line"));
    await writeFile(join(repo, "small.txt"), lines(10, "line"));
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await writeFile(join(repo, "big.txt"), lines(300_000, "edit"));
    await writeFile(join(repo, "small.txt"), lines(10, "edit"));
    const list = await listed(repo, await git("rev-parse", "HEAD"));
    expect(list.records.map((record) => [record.path, record.kind, record.added])).toEqual([
      ["big.txt", "binary", null],
      ["small.txt", "text", 10],
    ]);
  });

  it("hashes a touched binary file once while its stamp does not move", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "same.dat"), Buffer.from([97, 0, 98]));
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    const later = new Date(Date.now() + 60_000);
    await utimes(join(repo, "same.dat"), later, later);
    const head = await git("rev-parse", "HEAD");
    gitCalls.seen = [];
    await listed(repo, head);
    await listed(repo, head);
    expect(gitCalls.seen.filter((args) => args.includes("hash-object"))).toHaveLength(1);
  });

  it("asks git for nothing when the commit name is not this repository's length", async () => {
    const { repo } = await repository();
    gitCalls.seen = [];
    const read = await readChangeList(repo, "a".repeat(64), new AbortController().signal);
    expect(read).toEqual({ kind: "unavailable", reason: "failed" });
    expect(gitCalls.seen.filter((args) => args.includes("diff"))).toEqual([]);
  });

  it("never stamps a file through a folder that is a link to outside", async () => {
    const { repo, git } = await repository();
    await mkdir(join(repo, "dir"));
    await writeFile(join(repo, "dir", "hosts"), "inside\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    const outside = join(repo, "..", "outside");
    await mkdir(outside);
    await writeFile(join(outside, "hosts"), "twenty one bytes long");
    await rename(join(repo, "dir"), join(repo, "..", "moved"));
    await symlink(outside, join(repo, "dir"), "junction");
    const list = await listed(repo, await git("rev-parse", "HEAD"));
    const deleted = ["dir/hosts", "D", expect.stringMatching(/^[0-9a-f]{40}:gone$/)];
    const rows = list.records.map((record) => [record.path, record.letter, record.stamp]);
    if (process.platform === "win32") expect(rows).toEqual([deleted]);
    else expect(rows).toEqual([["dir", "A", expect.stringMatching(/^new:\d+:\d+:\d+$/)], deleted]);
  });

  it("lists a file git read through a link as deleted, with no counts from outside", async () => {
    const { repo, git } = await repository();
    await mkdir(join(repo, "dir"));
    await writeFile(join(repo, "dir", "hosts"), "inside\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    const outside = join(repo, "..", "outside");
    await mkdir(outside);
    await writeFile(join(outside, "hosts"), "one\ntwo\nthree\n");
    await writeFile(join(outside, "fresh"), "x\n");
    await rename(join(repo, "dir"), join(repo, "..", "moved"));
    await symlink(outside, join(repo, "dir"), "junction");
    const head = await git("rev-parse", "HEAD");
    const oid = await git("rev-parse", "HEAD:dir/hosts");
    gitCalls.diff = output(
      raw("100644 100644", oid, zero, "M", "dir/hosts"),
      stat("3", "1", "dir/hosts"),
    );
    try {
      const list = await listed(repo, head);
      const rows = list.records.filter((record) => record.path.startsWith("dir/"));
      expect(
        rows.map((record) => [record.path, record.letter, record.added, record.removed]),
      ).toEqual([["dir/hosts", "D", null, null]]);
    } finally {
      gitCalls.diff = undefined;
    }
  });

  it("never stamps through a folder swapped for a link while the stamps are read", async () => {
    const { repo, git } = await repository();
    await mkdir(join(repo, "dir"));
    await writeFile(join(repo, "dir", "a.txt"), "a\n");
    await writeFile(join(repo, "dir", "b.txt"), "b\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await writeFile(join(repo, "dir", "a.txt"), "a2\n");
    await writeFile(join(repo, "dir", "b.txt"), "b2\n");
    const outside = join(repo, "..", "outside");
    await mkdir(outside);
    await writeFile(join(outside, "b.txt"), "twenty one bytes long");
    const head = await git("rev-parse", "HEAD");
    fileCalls.lstat = (path) => {
      if (path.endsWith(join("dir", "a.txt"))) {
        fileCalls.lstat = undefined;
        renameSync(join(repo, "dir"), join(repo, "..", "moved"));
        symlinkSync(outside, join(repo, "dir"), "junction");
      }
      return undefined;
    };
    try {
      const list = await listed(repo, head);
      const stamp = list.records.find((record) => record.path === "dir/b.txt")?.stamp;
      expect(stamp).toMatch(/^[0-9a-f]{40}:gone$/);
    } finally {
      fileCalls.lstat = undefined;
    }
  });

  it("stops a stamp pass that ran out of time after the call in flight", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "edit.txt"), "one\n");
    await writeFile(join(repo, "other.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await writeFile(join(repo, "edit.txt"), "two\n");
    await writeFile(join(repo, "other.txt"), "two\n");
    const head = await git("rev-parse", "HEAD");
    const { promise: reached, resolve: reach } = Promise.withResolvers<undefined>();
    const { promise: held, resolve: release } = Promise.withResolvers<undefined>();
    const touched: string[] = [];
    fileCalls.lstat = (path) => {
      touched.push(path);
      if (!path.endsWith("edit.txt")) return undefined;
      reach(undefined);
      return held.then(() => {
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      });
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const reading = readChangeList(repo, head, new AbortController().signal);
      await reached;
      await vi.advanceTimersByTimeAsync(gitReadMs);
      await reading;
      release(undefined);
      await vi.advanceTimersByTimeAsync(50);
      expect(touched.filter((path) => path.endsWith("other.txt"))).toEqual([]);
      fileCalls.lstat = undefined;
      expect((await readWorktreeSide(repo, "edit.txt")).kind).toBe("text");
    } finally {
      fileCalls.lstat = undefined;
      vi.useRealTimers();
    }
  });

  it("stops counting untracked lines as soon as the list is stopped", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "kept.txt"), "kept\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    const names = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
    for (const name of names) await writeFile(join(repo, name), "new\n");
    const head = await git("rev-parse", "HEAD");
    const stop = new AbortController();
    const touched: string[] = [];
    fileCalls.lstat = (path) => {
      if (names.some((name) => path.endsWith(name))) touched.push(path);
      stop.abort();
      return undefined;
    };
    try {
      expect(await readChangeList(repo, head, stop.signal)).toEqual({
        kind: "unavailable",
        reason: "failed",
      });
    } finally {
      fileCalls.lstat = undefined;
    }
    expect(touched).toHaveLength(1);
  });

  it("answers hung when git times out or is stuck in the folder", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "edit.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    const head = await git("rev-parse", "HEAD");
    await listed(repo, head);
    try {
      for (const stop of ["time", "stuck"] as const) {
        gitCalls.stop = stop;
        expect(await readChangeList(repo, head, new AbortController().signal)).toEqual({
          kind: "unavailable",
          reason: "hung",
        });
      }
    } finally {
      gitCalls.stop = undefined;
    }
  });

  it("stamps within its time and marks the stamps it could not read as late", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "edit.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await writeFile(join(repo, "edit.txt"), "two\n");
    const head = await git("rev-parse", "HEAD");
    const { promise: reached, resolve: reach } = Promise.withResolvers<undefined>();
    fileCalls.lstat = () => {
      reach(undefined);
      return new Promise<BigIntStats>(() => undefined);
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const reading = readChangeList(repo, head, new AbortController().signal);
      await reached;
      await vi.advanceTimersByTimeAsync(gitReadMs);
      const stampsOf = (list: Awaited<typeof reading>) =>
        list.kind === "files" ? list.records.map((record) => record.stamp) : [];
      const first = stampsOf(await reading);
      expect(first).toEqual([expect.stringMatching(/^[0-9a-f]{40}:late:\d+$/)]);
      expect(await readWorktreeSide(repo, "edit.txt")).toEqual({ kind: "hung" });
      const again = stampsOf(await readChangeList(repo, head, new AbortController().signal));
      expect(again).toEqual([expect.stringMatching(/^[0-9a-f]{40}:late:\d+$/)]);
      expect(again).not.toEqual(first);
    } finally {
      fileCalls.lstat = undefined;
      vi.useRealTimers();
    }
  });

  it.skipIf(process.platform === "win32")(
    "keeps a file whose name the reader refuses, with its own letter and a refused stamp",
    async () => {
      const { repo, git } = await repository();
      await writeFile(join(repo, "tracked\\name.txt"), "one\n");
      await git("add", ".");
      await git("commit", "-q", "-m", "one");
      await writeFile(join(repo, "tracked\\name.txt"), "two\n");
      await writeFile(join(repo, "new\\file.sh"), "x\n");
      await writeFile(join(repo, "plain.txt"), "y\n");
      const list = await listed(repo, await git("rev-parse", "HEAD"));
      expect(list.records.map((record) => [record.path, record.letter])).toEqual([
        ["new\\file.sh", "A"],
        ["plain.txt", "A"],
        ["tracked\\name.txt", "M"],
      ]);
      expect(list.records[0]?.stamp).toMatch(/:refused$/);
      expect(list.records[2]?.stamp).toMatch(/:refused$/);
    },
  );

  it("counts names that decode to the same text instead of collapsing them silently", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "a.txt"), "a\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    gitCalls.diff = output(
      raw("100644 100644", one, zero, "M", "a\ufffd.txt"),
      raw("100644 100644", one, zero, "M", "a\ufffd.txt"),
      raw("100644 100644", one, zero, "M", "a\ufffd.txt"),
      stat("1", "1", "a\ufffd.txt"),
      stat("1", "1", "a\ufffd.txt"),
      stat("1", "1", "a\ufffd.txt"),
    );
    try {
      const list = await listed(repo, await git("rev-parse", "HEAD"));
      expect(list.records.map((record) => record.path)).toEqual(["a\ufffd.txt"]);
      expect(list.more).toBe(2);
    } finally {
      gitCalls.diff = undefined;
    }
  });

  it("keeps a binary file in the middle of a merge in the list", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "b.bin"), Buffer.from([0, 1, 2, 3]));
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await git("switch", "-q", "-c", "other");
    await writeFile(join(repo, "b.bin"), Buffer.from([0, 9, 9, 9]));
    await git("commit", "-q", "-am", "other");
    await git("switch", "-q", "main");
    await writeFile(join(repo, "b.bin"), Buffer.from([0, 7, 7, 7]));
    await git("commit", "-q", "-am", "main");
    await expect(git("merge", "other")).rejects.toThrow();
    const list = await listed(repo, await git("rev-parse", "HEAD"));
    expect(list.records.map((record) => [record.path, record.letter])).toEqual([["b.bin", "U"]]);
  });

  it("gives a file a new stamp when it is rewritten to the same size with its time put back", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "f.txt"), "safe = 2\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await writeFile(join(repo, "f.txt"), "safe = 3\n");
    const when = new Date("2020-01-01T00:00:00Z");
    await utimes(join(repo, "f.txt"), when, when);
    const head = await git("rev-parse", "HEAD");
    const first = (await listed(repo, head)).records[0]?.stamp;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(join(repo, "f.txt"), "evil = 9\n");
    await utimes(join(repo, "f.txt"), when, when);
    expect((await listed(repo, head)).records[0]?.stamp).not.toBe(first);
  });

  it.skipIf(!hasNoLazyFetch)(
    "answers not-local when a partial clone lacks an object and fetching is off",
    async () => {
      const { repo, git } = await repository();
      await writeFile(join(repo, "a.txt"), "a\n");
      await git("add", ".");
      await git("commit", "-q", "-m", "one");
      const oid = await git("rev-parse", "HEAD:a.txt");
      await git("remote", "add", "origin", "ssh://probe.invalid/x.git");
      await git("config", "extensions.partialClone", "origin");
      await git("config", "remote.origin.promisor", "true");
      await writeFile(join(repo, "a.txt"), "b\n");
      const object = join(repo, ".git", "objects", oid.slice(0, 2), oid.slice(2));
      await chmod(object, 0o600);
      await rename(object, join(repo, "..", "kept-object"));
      const read = await readChangeList(
        repo,
        await git("rev-parse", "HEAD"),
        new AbortController().signal,
      );
      expect(read).toEqual({ kind: "unavailable", reason: "not-local" });
    },
  );
});
