import { execFile } from "node:child_process";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conflictCheck } from "./conflict-check.ts";

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
const windows = process.platform === "win32";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-conflict-")));
  const config = join(base, "gitconfig");
  await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
  process.env["GIT_CONFIG_GLOBAL"] = config;
  process.env["GIT_CONFIG_NOSYSTEM"] = "1";
  const home = join(base, "home");
  await mkdir(home);
  const repo = join(base, "repo");
  const git = async (...args: string[]) => (await run("git", ["-C", repo, ...args])).stdout.trim();
  await run("git", ["init", "-q", "-b", "main", repo]);
  const write = (path: string, text: string | Buffer) => writeFile(join(repo, path), text);
  const commit = async (message: string) => {
    await git("add", "-A");
    await git("commit", "-q", "-m", message);
  };
  const tips = async (branch: string) => [
    await git("rev-parse", "HEAD"),
    await git("rev-parse", branch),
  ];
  return { base, home, repo, git, write, commit, tips };
}

async function diverge(
  box: Awaited<ReturnType<typeof sandbox>>,
  start: () => Promise<void>,
  onBranch: () => Promise<void>,
  onMain: () => Promise<void>,
) {
  await start();
  await box.commit("first");
  await box.git("switch", "-q", "-c", "alpha");
  await onBranch();
  await box.commit("alpha");
  await box.git("switch", "-q", "main");
  await onMain();
  await box.commit("main moves");
  await box.git("switch", "-q", "alpha");
  const [head, base] = await box.tips("main");
  return { head: head ?? "", base: base ?? "" };
}

async function tree(folder: string): Promise<string[]> {
  const listed: string[] = [];
  const walk = async (path: string) => {
    for (const name of (await readdir(path)).sort()) {
      const entry = join(path, name);
      const info = await lstat(entry);
      listed.push(`${entry} ${String(info.size)} ${String(info.mtimeMs)}`);
      if (info.isDirectory()) await walk(entry);
    }
  };
  await walk(folder);
  return listed;
}

const twoLines = (second: string) => `one\n${second}\nthree\n`;

afterEach(() => {
  delete process.env["SATELLITE_GIT"];
});

describe("conflictCheck", { timeout: 60_000 }, () => {
  it("counts and names the files that conflict with the base", async () => {
    const box = await sandbox();
    const { head, base } = await diverge(
      box,
      () => box.write("shared.txt", twoLines("two")).then(() => box.write("fine.txt", "x\n")),
      () => box.write("shared.txt", twoLines("alpha")),
      () => box.write("shared.txt", twoLines("main")),
    );
    expect(await conflictCheck(box.home, box.repo, head, base)).toEqual({
      kind: "files",
      files: 1,
      names: ["shared.txt"],
    });
  });

  it("still checks when the user's config demands an explicit git directory for bare repositories", async () => {
    const box = await sandbox();
    const config = process.env["GIT_CONFIG_GLOBAL"] ?? "";
    await appendFile(config, "[safe]\n\tbareRepository = explicit\n");
    const { head, base } = await diverge(
      box,
      () => box.write("shared.txt", twoLines("two")),
      () => box.write("shared.txt", twoLines("alpha")),
      () => box.write("shared.txt", twoLines("main")),
    );
    expect(await conflictCheck(box.home, box.repo, head, base)).toMatchObject({ kind: "files" });
  });

  it("reads none of the user's config, so a global merge setting cannot abort it or run the user's driver", async () => {
    const box = await sandbox();
    const marker = join(box.base, "driver-ran");
    const attributes = join(box.base, "attributes");
    await writeFile(attributes, "* merge=mine\n");
    const config = process.env["GIT_CONFIG_GLOBAL"] ?? "";
    await appendFile(
      config,
      `[merge]\n\trenormalize = true\n[merge "mine"]\n\tdriver = touch ${marker}\n[core]\n\tattributesFile = ${attributes}\n`,
    );
    const { head, base } = await diverge(
      box,
      () => box.write("shared.txt", twoLines("two")),
      () => box.write("shared.txt", twoLines("alpha")),
      () => box.write("shared.txt", twoLines("main")),
    );
    expect(await conflictCheck(box.home, box.repo, head, base)).toMatchObject({ kind: "files" });
    expect(await exists(marker)).toBe(false);
  });

  it("answers none for a base that merges cleanly, and for a branch already merged", async () => {
    const box = await sandbox();
    const { head, base } = await diverge(
      box,
      () => box.write("a.txt", "a\n").then(() => box.write("b.txt", "b\n")),
      () => box.write("a.txt", "alpha\n"),
      () => box.write("b.txt", "main\n"),
    );
    expect(await conflictCheck(box.home, box.repo, head, base)).toEqual({ kind: "none" });
    expect(await conflictCheck(box.home, box.repo, base, head)).toEqual({ kind: "none" });
    expect(await conflictCheck(box.home, box.repo, head, head)).toEqual({ kind: "none" });
  });

  it("answers nothing for histories that share no commit", async () => {
    const box = await sandbox();
    await box.write("a.txt", "a\n");
    await box.commit("one");
    await box.git("switch", "-q", "--orphan", "other");
    await box.write("b.txt", "b\n");
    await box.commit("two");
    const head = await box.git("rev-parse", "HEAD");
    const base = await box.git("rev-parse", "main");
    expect(await conflictCheck(box.home, box.repo, head, base)).toBeNull();
  });

  it("answers nothing for a name that is not a commit of this repository", async () => {
    const box = await sandbox();
    await box.write("a.txt", "a\n");
    await box.commit("one");
    const head = await box.git("rev-parse", "HEAD");
    expect(await conflictCheck(box.home, box.repo, head, "b".repeat(64))).toBeNull();
    expect(await conflictCheck(box.home, box.repo, head, "b".repeat(40))).toBeNull();
  });

  it("names every kind of conflict", async () => {
    const box = await sandbox();
    const { head, base } = await diverge(
      box,
      async () => {
        await box.write("edited.txt", "a\nb\nc\n");
        await box.write("deleted.txt", "x\ny\nz\n");
        await box.write("moved.txt", "line one\nline two\nline three\nline four\n");
        await box.write("image.bin", Buffer.from([0, 1, 2, 3]));
        await box.write("script.sh", "echo\n");
        await box.write("both.txt", "same\n");
      },
      async () => {
        await box.write("edited.txt", "a\nalpha\nc\n");
        await box.write("deleted.txt", "x\nalpha\nz\n");
        await box.git("mv", "moved.txt", "moved-alpha.txt");
        await box.write("image.bin", Buffer.from([0, 1, 2, 4]));
        await box.git("rm", "-q", "script.sh");
        await mkdir(join(box.repo, "script.sh"));
        await box.write("script.sh/inner.txt", "x\n");
        await box.git("update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},module`);
      },
      async () => {
        await box.write("edited.txt", "a\nmain\nc\n");
        await box.git("rm", "-q", "deleted.txt");
        await box.git("mv", "moved.txt", "moved-main.txt");
        await box.write("image.bin", Buffer.from([0, 1, 2, 5]));
        await box.write("script.sh", "echo changed\n");
        await box.git("update-index", "--add", "--cacheinfo", `160000,${"2".repeat(40)},module`);
      },
    );
    const found = await conflictCheck(box.home, box.repo, head, base);
    expect(found?.kind).toBe("files");
    if (found?.kind !== "files") return;
    const expected = [
      "deleted.txt",
      "edited.txt",
      "image.bin",
      "module",
      "moved-alpha.txt",
      "moved-main.txt",
      "script.sh",
    ];
    expect(found.files).toBe(expected.length);
    expect(found.names).toHaveLength(5);
    expect(found.names.every((name) => expected.includes(name))).toBe(true);
  });

  it("writes nothing into the repository, and leaves nothing under the home", async () => {
    const box = await sandbox();
    const { head, base } = await diverge(
      box,
      () => box.write("shared.txt", twoLines("two")),
      () => box.write("shared.txt", twoLines("alpha")),
      () => box.write("shared.txt", twoLines("main")),
    );
    const before = await tree(join(box.repo, ".git"));
    const homeBefore = await tree(box.home);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await conflictCheck(box.home, box.repo, head, base))?.kind).toBe("files");
    expect(await tree(join(box.repo, ".git"))).toEqual(before);
    expect(await readdir(join(box.home, "quarantine"))).toEqual([]);
    expect(homeBefore).toEqual([]);
  });

  it.skipIf(windows)("runs no program the repository names", async () => {
    const box = await sandbox();
    const marker = join(box.base, "marker.sh");
    const log = join(box.base, "ran.log");
    await writeFile(marker, `#!/bin/sh\necho "$0 $*" >> "${log}"\nexit 1\n`);
    await chmod(marker, 0o755);
    const hooks = join(box.base, "hooks");
    await mkdir(hooks);
    for (const name of [
      "pre-merge-commit",
      "post-merge",
      "reference-transaction",
      "post-index-change",
    ]) {
      await writeFile(join(hooks, name), `#!/bin/sh\necho hook ${name} >> "${log}"\n`);
      await chmod(join(hooks, name), 0o755);
    }
    const globalAttributes = join(box.base, "attributes");
    await writeFile(globalAttributes, "* merge=evil2\n");
    const { head, base } = await diverge(
      box,
      async () => {
        await box.write("shared.txt", twoLines("two"));
        await box.write(".gitattributes", "shared.txt merge=evil\n* filter=evilf diff=evild\n");
      },
      () => box.write("shared.txt", twoLines("alpha")),
      () => box.write("shared.txt", twoLines("main")),
    );
    await mkdir(join(box.repo, ".git", "info"), { recursive: true });
    await writeFile(join(box.repo, ".git", "info", "attributes"), "* merge=evil2 filter=evilf\n");
    const settings: [string, string][] = [
      ["merge.evil.driver", `${marker} %O %A %B`],
      ["merge.evil2.driver", `${marker} %O %A %B`],
      ["merge.renormalize", "true"],
      ["filter.evilf.clean", `${marker} clean`],
      ["filter.evilf.smudge", `${marker} smudge`],
      ["filter.evilf.process", `${marker} process`],
      ["diff.evild.textconv", `${marker} textconv`],
      ["diff.external", `${marker} external`],
      ["core.hooks" + "Path", hooks],
      ["core.pager", `${marker} pager`],
      ["pager.merge-tree", "true"],
      ["core.editor", `${marker} editor`],
      ["credential.helper", `!${marker} credential`],
      ["core.askPass", `${marker} askpass`],
      ["core.sshCommand", `${marker} ssh`],
      ["core.attributesFile", globalAttributes],
      ["core.fsmonitor", marker],
    ];
    for (const [key, value] of settings) await box.git("config", key, value);

    const control = await run("git", [
      "-C",
      box.repo,
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--no-messages",
      "-z",
      head,
      base,
    ]).catch((error: unknown) => error);
    expect(control).toBeDefined();
    const ran = await readFile(log, "utf8").catch(() => "");
    expect(ran, "the hostile setup must start a program when git runs in the repository").toMatch(
      /marker\.sh/,
    );
    await writeFile(log, "");

    expect((await conflictCheck(box.home, box.repo, head, base))?.kind).toBe("files");
    expect(await readFile(log, "utf8")).toBe("");
  });

  it.skipIf(windows)("sweeps what a crash left, and never follows a link", async () => {
    const box = await sandbox();
    await box.write("a.txt", "a\n");
    await box.commit("one");
    const head = await box.git("rev-parse", "HEAD");
    const outside = join(box.base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep\n");
    const left = join(box.home, "quarantine", "leftover");
    await mkdir(left, { recursive: true });
    await writeFile(join(left, "object"), "x");
    await symlink(outside, join(left, "link"));
    await conflictCheck(box.home, box.repo, head, head);
    expect(await readdir(join(box.home, "quarantine"))).toEqual([]);
    expect((await stat(join(outside, "keep.txt"))).isFile()).toBe(true);
  });

  it("leaves nothing behind when the check is stopped", async () => {
    const box = await sandbox();
    const { head, base } = await diverge(
      box,
      () => box.write("shared.txt", twoLines("two")),
      () => box.write("shared.txt", twoLines("alpha")),
      () => box.write("shared.txt", twoLines("main")),
    );
    const stopper = new AbortController();
    stopper.abort(new Error("stopped"));
    await expect(conflictCheck(box.home, box.repo, head, base, stopper.signal)).rejects.toThrow();
    const left = await readdir(join(box.home, "quarantine")).catch(() => []);
    expect(left).toEqual([]);
  });

  it.skipIf(windows)("says nothing is checked on a git older than 2.38", async () => {
    vi.resetModules();
    const box = await sandbox();
    const shim = join(box.base, "shim.mjs");
    await writeFile(
      shim,
      `import { spawnSync } from "node:child_process";\nconst args = process.argv.slice(2);\nif (args.includes("--version")) { process.stdout.write("git version 2.35.0\\n"); process.exit(0); }\nconst out = spawnSync("git", args, { stdio: "inherit" });\nprocess.exit(out.status ?? 1);\n`,
    );
    process.env["SATELLITE_GIT"] = JSON.stringify([process.execPath, shim]);
    const fresh = await import("./conflict-check.ts");
    const { head, base } = await diverge(
      box,
      () => box.write("shared.txt", twoLines("two")),
      () => box.write("shared.txt", twoLines("alpha")),
      () => box.write("shared.txt", twoLines("main")),
    );
    expect(await fresh.conflictCheck(box.home, box.repo, head, base)).toEqual({ kind: "old-git" });
    expect(await readdir(join(box.home, "quarantine")).catch(() => [])).toEqual([]);
  });
});
