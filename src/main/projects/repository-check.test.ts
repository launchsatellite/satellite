import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { checkRepository, parseRevParse } from "./repository-check.ts";

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
const isWindows = process.platform === "win32";
const notARepository = "fatal: not a git repository (or any of the parent directories): .git\n";
const notAWorkTree = "fatal: this operation must be run in a work tree\n";

let base = "";
let home = "";

function git(cwd: string, args: string[]) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  );
  return run("git", args, {
    cwd,
    env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(base, "gitconfig") },
  });
}

async function makeRepository(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await git(folder, ["init", "-q", "-b", "main"]);
  await git(folder, ["commit", "-q", "--allow-empty", "-m", "first commit"]);
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "satellite-repository-")));
  home = join(base, "home");
  await writeFile(
    join(base, "gitconfig"),
    "[user]\n\tname = Satellite Test\n\temail = test@satellite.invalid\n",
  );
  await makeRepository(join(base, "repo"));
  await makeRepository(join(base, "-dash repo"));
  await mkdir(join(base, "repo", "src"));
  await mkdir(join(base, "plain"));
  await mkdir(join(home, "inner"), { recursive: true });
  await writeFile(join(base, "notes.txt"), "notes");
  await git(base, ["init", "-q", "--bare", "bare.git"]);
  await git(join(base, "repo"), ["worktree", "add", "-q", join(base, "linked")]);
  await git(base, ["clone", "-q", "--bare", join(base, "repo"), "shared.git"]);
  await git(join(base, "shared.git"), ["worktree", "add", "-q", join(base, "from-bare")]);
  await mkdir(join(base, "borrower"));
  await writeFile(join(base, "borrower", ".git"), "gitdir: ../repo/.git\n");
  await makeRepository(join(base, "aimed"));
  await git(join(base, "aimed"), ["config", "core.worktree", join(base, "plain")]);
}, 30_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("parseRevParse", () => {
  it("reads the root of a working tree", () => {
    expect(
      parseRevParse({
        exitCode: 0,
        stdout:
          "false\nfalse\n/Users/<name>/repo/.git\n/Users/<name>/repo/.git\n/Users/<name>/repo\n",
        stderr: "",
      }),
    ).toEqual({
      kind: "work-tree",
      toplevel: "/Users/<name>/repo",
      gitDir: "/Users/<name>/repo/.git",
      commonDir: "/Users/<name>/repo/.git",
      linked: false,
    });
  });

  it("reads a subfolder's toplevel", () => {
    expect(
      parseRevParse({
        exitCode: 0,
        stdout:
          "false\nfalse\n/Users/<name>/repo/.git\n/Users/<name>/repo/.git\n/Users/<name>/repo\n",
        stderr: "",
      }),
    ).toMatchObject({ kind: "work-tree", toplevel: "/Users/<name>/repo" });
  });

  it("recognises a bare repository", () => {
    expect(
      parseRevParse({
        exitCode: 128,
        stdout: "true\ntrue\n/Users/<name>/bare.git\n/Users/<name>/bare.git\n",
        stderr: notAWorkTree,
      }),
    ).toEqual({ kind: "bare" });
  });

  it("recognises the inside of a .git folder", () => {
    expect(
      parseRevParse({
        exitCode: 128,
        stdout: "false\ntrue\n/Users/<name>/repo/.git\n/Users/<name>/repo/.git\n",
        stderr: notAWorkTree,
      }),
    ).toEqual({ kind: "git-dir" });
  });

  it("recognises a linked worktree", () => {
    expect(
      parseRevParse({
        exitCode: 0,
        stdout:
          "false\nfalse\n/Users/<name>/repo/.git/worktrees/linked\n/Users/<name>/repo/.git\n/Users/<name>/linked\n",
        stderr: "",
      }),
    ).toEqual({
      kind: "work-tree",
      toplevel: "/Users/<name>/linked",
      gitDir: "/Users/<name>/repo/.git/worktrees/linked",
      commonDir: "/Users/<name>/repo/.git",
      linked: true,
    });
  });

  it("recognises a folder that is not a repository", () => {
    expect(parseRevParse({ exitCode: 128, stdout: "", stderr: notARepository })).toEqual({
      kind: "not-a-repository",
    });
  });

  it("recognises a git too old for absolute paths", () => {
    expect(
      parseRevParse({
        exitCode: 0,
        stdout: "--path-format=absolute\nfalse\nfalse\n.git\n.git\n/Users/<name>/repo\n",
        stderr: "",
      }),
    ).toEqual({ kind: "outdated" });
  });

  it("recognises a folder owned by another user", () => {
    expect(
      parseRevParse({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: detected dubious ownership in repository at '/srv/repo'\n",
      }),
    ).toEqual({ kind: "untrusted" });
  });

  it("reads Windows paths", () => {
    expect(
      parseRevParse({
        exitCode: 0,
        stdout:
          "false\r\nfalse\r\nC:/Users/<name>/repo/.git\r\nC:/Users/<name>/repo/.git\r\nC:/Users/<name>/repo\r\n",
        stderr: "",
      }),
    ).toEqual({
      kind: "work-tree",
      toplevel: "C:/Users/<name>/repo",
      gitDir: "C:/Users/<name>/repo/.git",
      commonDir: "C:/Users/<name>/repo/.git",
      linked: false,
    });
  });
});

describe("checkRepository", () => {
  it("refuses each kind of folder with its sentence", { timeout: 30_000 }, async () => {
    const refusals: [string, string][] = [
      [join(base, "repo", "src"), "src is inside the repository repo. Add repo itself instead."],
      [
        join(base, "plain"),
        "plain is not a git repository. Choose the folder a repository was cloned into.",
      ],
      [
        join(base, "bare.git"),
        "bare.git is a bare repository with no working files. Satellite needs a repository with its own checkout.",
      ],
      [
        join(base, "from-bare"),
        "from-bare is a worktree of a bare repository. Satellite needs a repository with its own checkout.",
      ],
      [
        join(base, "repo", ".git"),
        "That folder is inside a repository's .git folder. Add the repository's own folder instead.",
      ],
      [
        join(base, "linked"),
        "linked is a worktree of another repository. Add the repository's main folder instead.",
      ],
      [
        join(base, "borrower"),
        "borrower uses a .git folder from somewhere else. Satellite needs a repository with its own .git folder inside it.",
      ],
      [
        join(base, "aimed"),
        "aimed keeps its working files in another folder. Satellite needs a repository with its own checkout.",
      ],
      [join(base, "gone"), "That folder no longer exists. Choose another one."],
      [join(base, "notes.txt"), "Drop a folder, not a file."],
      [parse(base).root, "That's a whole drive. Choose the folder a repository was cloned into."],
      ["repo", "That folder no longer exists. Choose another one."],
      [
        join(home, "inner"),
        "That folder belongs to Satellite itself. Add a repository from somewhere else.",
      ],
      [home, "That folder belongs to Satellite itself. Add a repository from somewhere else."],
    ];
    for (const [folder, refusal] of refusals) {
      expect(await checkRepository(folder, home), folder).toEqual({ ok: false, refusal });
    }
    expect(await checkRepository(join(base, "repo"), home)).toEqual({
      ok: true,
      root: await realpath(join(base, "repo")),
    });
    expect(await checkRepository(join(base, "-dash repo") + "/", home)).toEqual({
      ok: true,
      root: await realpath(join(base, "-dash repo")),
    });
  });

  it("adds a repository holding Satellite's home only once git ignores the home", async () => {
    const dotfiles = join(base, "dotfiles");
    await makeRepository(dotfiles);
    const inner = join(dotfiles, "config", ".satellite");
    await mkdir(inner, { recursive: true });
    expect(await checkRepository(dotfiles, inner)).toEqual({
      ok: false,
      refusal:
        "dotfiles holds Satellite's home, config/.satellite, and git doesn't ignore it there. Add config/.satellite/ to the .gitignore in dotfiles, then add it again.",
    });
    await writeFile(join(dotfiles, ".gitignore"), "/config/.satellite/\n");
    expect(await checkRepository(dotfiles, inner)).toEqual({ ok: true, root: dotfiles });
  });

  it("refuses a plain folder with its sentence under a German locale", async () => {
    vi.stubEnv("LANG", "de_DE.UTF-8");
    vi.stubEnv("LC_ALL", "de_DE.UTF-8");
    vi.stubEnv("LANGUAGE", "de");
    expect(await checkRepository(join(base, "plain"), home)).toEqual({
      ok: false,
      refusal: "plain is not a git repository. Choose the folder a repository was cloned into.",
    });
  });

  it.skipIf(isWindows)(
    "refuses a folder whose name holds a newline without misreading it",
    { timeout: 30_000 },
    async () => {
      const folder = join(base, "two\nlines");
      await makeRepository(folder);
      expect(await checkRepository(folder, home)).toEqual({
        ok: false,
        refusal: "git couldn't read two\nlines. Nothing was added.",
      });
    },
  );
});
