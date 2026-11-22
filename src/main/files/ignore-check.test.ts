import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkIgnored } from "./ignore-check.ts";
import { readNames } from "./name-index.ts";
import {
  git,
  isolateGit,
  makeRepository,
  mockedEnvironment,
  put,
  scratch,
} from "./repository.test-fixture.ts";

vi.mock("../platform/user-environment.ts", () => ({
  userEnvironment: () => mockedEnvironment(),
}));

beforeEach(isolateGit);
afterEach(() => {
  vi.unstubAllEnvs();
});

async function ignoredAmong(root: string, paths: string[]): Promise<string[] | string> {
  const check = await checkIgnored(root, paths);
  return check.kind === "checked" ? [...check.ignored].sort() : check.kind;
}

describe("checkIgnored", () => {
  it("reports an ignored file and an ignored folder and leaves a tracked file that matches a pattern", async () => {
    const root = await makeRepository();
    await put(root, {
      ".gitignore": "*.log\nbuild/\ncache/\n!keep.log\n",
      "debug.log": "x",
      "keep.log": "x",
      "cache/a.txt": "x",
      "build/forced.js": "x",
      "build/other.js": "x",
      "src/app.ts": "x",
    });
    await git(root, "add", "-f", "build/forced.js", "keep.log", "src/app.ts", ".gitignore");
    const paths = [
      "debug.log",
      "keep.log",
      "cache",
      "cache/a.txt",
      "build",
      "build/forced.js",
      "build/other.js",
      "src",
      "src/app.ts",
      "gone.log",
      "cache/never-made",
    ];
    expect(await ignoredAmong(root, paths)).toEqual([
      "build/other.js",
      "cache",
      "cache/a.txt",
      "cache/never-made",
      "debug.log",
      "gone.log",
    ]);
  });

  it("fails closed on a path git cannot vouch for", async () => {
    const root = await makeRepository();
    expect(await ignoredAmong(root, ["a\0b"])).toBe("failed");
    expect(await ignoredAmong(root, [""])).toBe("failed");
    expect(
      await ignoredAmong(
        root,
        Array.from({ length: 5001 }, (_, at) => `f${String(at)}`),
      ),
    ).toBe("failed");
    expect(await ignoredAmong(join(root, "missing"), ["a"])).toBe("failed");
    expect(await ignoredAmong(root, [])).toEqual([]);
  });

  it("answers failed for a path inside a submodule and checked for the folder itself", async () => {
    const root = await makeRepository();
    const inner = join(await scratch(), "inner");
    await mkdir(inner);
    await git(inner, "init", "-q");
    await git(inner, "config", "user.email", "test@example.com");
    await git(inner, "config", "user.name", "Test");
    await writeFile(join(inner, "s.txt"), "x");
    await git(inner, "add", "s.txt");
    await git(inner, "commit", "-qm", "s");
    await git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", inner, "subm");
    expect(await ignoredAmong(root, ["subm/s.txt"])).toBe("failed");
    expect(await ignoredAmong(root, ["subm"])).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("starts no program the repository chose", async () => {
    const root = await makeRepository();
    const marks = join(await scratch(), "marks");
    await mkdir(marks);
    const program = join(await scratch(), "marker.sh");
    await writeFile(program, `#!/bin/sh\necho "$1" >> "${join(marks, "ran")}"\n`);
    await chmod(program, 0o755);
    const roles = [
      "core.fsmonitor",
      "core.pager",
      "core.editor",
      "core.sshCommand",
      "core.gitProxy",
      "diff.external",
      "diff.marker.textconv",
      "filter.marker.clean",
      "filter.marker.smudge",
      "filter.marker.process",
      "credential.helper",
      "core.askPass",
    ];
    for (const role of roles) await git(root, "config", role, `${program} ${role}`);
    await put(root, {
      ".gitattributes": "* filter=marker diff=marker\n",
      ".gitignore": "*.log\n",
      "a.log": "x",
      "b.txt": "x",
    });
    await mkdir(join(root, ".git", "hooks"), { recursive: true });
    for (const hook of ["post-index-change", "pre-commit", "reference-transaction"]) {
      const file = join(root, ".git", "hooks", hook);
      await writeFile(file, `#!/bin/sh\necho ${hook} >> "${join(marks, "ran")}"\n`);
      await chmod(file, 0o755);
    }
    const control = await git(root, "status", "--porcelain").then(
      () => readdir(marks),
      () => [],
    );
    expect(control).toContain("ran");
    await writeFile(join(marks, "ran"), "");
    expect(await ignoredAmong(root, ["a.log", "b.txt"])).toEqual(["a.log"]);
    expect(await readNames(root)).toMatchObject({ kind: "names" });
    expect(await readFile(join(marks, "ran"), "utf8")).toBe("");
  });
});
