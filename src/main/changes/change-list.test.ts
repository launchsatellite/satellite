import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { parseDiff, parseUntracked, readChangeList } from "./change-list.ts";

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
  return { repo, git };
}

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
      change("link", { letter: "T", added: 1, removed: 1, sourceOid: two }),
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

describe("readChangeList", { timeout: 60_000 }, () => {
  it("lists a nested repository as a folder of its own", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "tracked.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await run("git", ["init", "-q", join(repo, "nested")]);
    await writeFile(join(repo, "nested", "inside.txt"), "inside\n");
    const list = await readChangeList(
      repo,
      await git("rev-parse", "HEAD"),
      new AbortController().signal,
    );
    expect(list?.records).toHaveLength(1);
    expect(list?.records[0]).toMatchObject({
      path: "nested",
      letter: "A",
      tracked: false,
      kind: "repository",
      added: null,
      removed: null,
    });
    expect(list?.records[0]?.stamp).toMatch(/^new:\d+:\d+$/);
  });

  it("counts untracked lines only within its budget", async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, "tracked.txt"), "one\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    const head = await git("rev-parse", "HEAD");
    const signal = new AbortController().signal;
    await mkdir(join(repo, "many"));
    for (let index = 0; index < 201; index += 1) {
      await writeFile(join(repo, "many", `f${String(index).padStart(3, "0")}.txt`), "line\n");
    }
    const many = await readChangeList(repo, head, signal);
    expect(many?.records.slice(0, 200).every((record) => record.added === 1)).toBe(true);
    expect(many?.records[200]).toMatchObject({ path: "many/f200.txt", added: null, removed: null });

    const big = await repository();
    await writeFile(join(big.repo, "tracked.txt"), "one\n");
    await big.git("add", ".");
    await big.git("commit", "-q", "-m", "one");
    for (let index = 0; index < 9; index += 1) {
      await writeFile(join(big.repo, `big-${String(index)}.txt`), `${"x".repeat(1_048_575)}\n`);
    }
    await writeFile(join(big.repo, "data.bin"), Buffer.from([1, 0, 2]));
    const bigList = await readChangeList(big.repo, await big.git("rev-parse", "HEAD"), signal);
    expect(bigList?.records.map((record) => [record.path, record.kind, record.added])).toEqual([
      ...Array.from({ length: 8 }, (_, index) => [`big-${String(index)}.txt`, "text", 1]),
      ["big-8.txt", "text", null],
      ["data.bin", "text", null],
    ]);
    await writeFile(join(big.repo, "big-0.txt"), Buffer.from([1, 0, 2]));
    const binaryList = await readChangeList(big.repo, await big.git("rev-parse", "HEAD"), signal);
    expect(binaryList?.records[0]).toMatchObject({
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
    const list = await readChangeList(repo, fork, new AbortController().signal);
    expect(
      list?.records.map((record) => [
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
    expect(list?.more).toBe(0);
    expect(list?.records[2]?.stamp).toMatch(/^[0-9a-f]{40}:\d+:\d+$/);
    expect(await readChangeList(repo, "HEAD", new AbortController().signal)).toBeUndefined();
  });
});
