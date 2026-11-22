import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredProject, StoredWorkspace } from "../projects/projects-file.ts";
import type { WorkspaceSessions } from "../terminal/terminal-sessions.ts";
import { runGit } from "./git-command.ts";
import { archiveWorkspace, inspectWorkspace, parseIndex } from "./workspace-archive.ts";
import { listWorktrees } from "./worktree-list.ts";
import { boundaryInside, removeWorktree } from "./worktree-removal.ts";

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
vi.mock("./git-command.ts", async (original) => {
  const actual = await original<typeof import("./git-command.ts")>();
  return { ...actual, runGit: vi.fn(actual.runGit) };
});
vi.mock("./worktree-list.ts", async (original) => {
  const actual = await original<typeof import("./worktree-list.ts")>();
  return { ...actual, listWorktrees: vi.fn(actual.listWorktrees) };
});
const duringWalk = vi.hoisted(() => {
  const state: { hook?: () => Promise<void> } = {};
  return state;
});
vi.mock("./folder-links.ts", async (original) => {
  const actual = await original<typeof import("./folder-links.ts")>();
  return {
    ...actual,
    findLinks: async (...args: Parameters<typeof actual.findLinks>) => {
      const found = await actual.findLinks(...args);
      await duringWalk.hook?.();
      return found;
    },
  };
});
const beforeRemove = vi.hoisted(() => {
  const state: { hook?: () => Promise<void> } = {};
  return state;
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      await beforeRemove.hook?.();
      return actual.rm(...args);
    },
  };
});

const run = promisify(execFile);
const realGitMs = 30_000;
const onUnix = process.platform !== "win32";

let base = "";
let home = "";
let config = "";

function asGitPrints(path: string): string {
  return path.split(sep).join("/");
}

function gitEnvironment(): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  return { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
}

async function git(folder: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", folder, ...args], { env: gitEnvironment() });
  return stdout.trim();
}

async function commit(folder: string, file: string, text: string): Promise<void> {
  await mkdir(join(folder, file, ".."), { recursive: true });
  await writeFile(join(folder, file), text);
  await git(folder, ["add", "-A"]);
  await git(folder, ["commit", "-q", "-m", text.trim()]);
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

async function repository(name: string, withRemote: boolean): Promise<StoredProject> {
  const path = join(base, name);
  if (withRemote) {
    const upstream = join(base, `${name}-upstream`);
    await run("git", ["init", "-q", "-b", "main", upstream], { env: gitEnvironment() });
    await commit(upstream, "README.md", "# repo\n");
    await commit(upstream, ".gitignore", "node_modules/\n");
    await run("git", ["clone", "-q", upstream, path], { env: gitEnvironment() });
  } else {
    await run("git", ["init", "-q", "-b", "main", path], { env: gitEnvironment() });
    await commit(path, "README.md", "# repo\n");
  }
  return { id: randomUUID(), path, workspaces: [] };
}

async function workspace(
  project: StoredProject,
  name: string,
  detached = false,
): Promise<StoredWorkspace> {
  const parent = join(home, "worktrees", "repo");
  await mkdir(parent, { recursive: true });
  const path = join(await realpath(parent), name);
  const how = detached ? ["--detach", path] : ["-b", name, path];
  await git(project.path, ["worktree", "add", "-q", ...how]);
  const record = { id: randomUUID(), name, path, branch: name };
  project.workspaces.push(record);
  return record;
}

function sessionsStub(): WorkspaceSessions & { stopped: string[] } {
  const stopped: string[] = [];
  return {
    stopped,
    countInside: () => 0,
    stopInside: (folder) => {
      stopped.push(folder);
      return Promise.resolve();
    },
  };
}

function gitCalls(): string[][] {
  return vi
    .mocked(runGit)
    .mock.calls.filter(([folder]) => folder.startsWith(base))
    .map(([, args]) => [...args]);
}

function removeCalls(): string[][] {
  return gitCalls().filter((args) => args[0] === "worktree" && args[1] === "remove");
}

async function listed(project: StoredProject): Promise<string> {
  return git(project.path, ["worktree", "list", "--porcelain"]);
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "satellite-archive-")));
  home = join(base, "home");
  await mkdir(home);
  config = join(base, "gitconfig");
  await writeFile(
    config,
    '[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n[protocol "file"]\n\tallow = always\n',
  );
  vi.stubEnv("GIT_CONFIG_GLOBAL", config);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.mocked(runGit).mockClear();
  delete beforeRemove.hook;
  delete duringWalk.hook;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseIndex", () => {
  it("counts files git skips and finds submodules, and refuses a line it can't read", () => {
    const oid = "8688a8ca6cf509b12d9b25114e11207f53ac3fd1";
    const lines = [
      `H 100644 ${oid} 0\tREADME.md`,
      `h 100644 ${oid} 0\tassumed.md`,
      `S 100644 ${oid} 0\tsparse/a.md`,
      `s 100644 ${oid} 0\tboth.md`,
      `H 160000 ${oid} 0\tlib`,
      `H 100644 ${oid} 0\tname\nwith newline`,
    ];
    expect(parseIndex(`${lines.join("\0")}\0`)).toEqual({ hidden: 3, gitlinks: ["lib"] });
    expect(parseIndex("")).toEqual({ hidden: 0, gitlinks: [] });
    expect(parseIndex("H README.md\0")).toBeUndefined();
  });
});

describe("inspectWorkspace", { timeout: realGitMs }, () => {
  it("lists uncommitted files and commits that are not pushed", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "fix-login");
    await commit(record.path, "src/login.ts", "fix the login redirect\n");
    await writeFile(join(record.path, "README.md"), "# repo\n\nLogin notes.\n");
    await writeFile(join(record.path, "notes.md"), "Ask about the timeout.\n");
    const view = await inspectWorkspace(home, project, record, 1);
    expect(view).toMatchObject({
      branch: "fix-login",
      files: [
        { code: " M", path: "README.md" },
        { code: "??", path: "notes.md" },
      ],
      moreFiles: 0,
      commits: { kind: "unpushed", count: 1, subjects: ["fix the login redirect"] },
      sessions: 1,
      locked: false,
    });
    expect(view.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says commits on a detached head would be lost", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "loose", true);
    await commit(record.path, "a.txt", "nowhere else\n");
    const view = await inspectWorkspace(home, project, record, 0);
    expect(view.branch).toBeNull();
    expect(view.commits).toEqual({ kind: "lost", count: 1, subjects: ["nowhere else"] });
  });

  it("says a repository with no remote has nothing pushed", async () => {
    const project = await repository("repo", false);
    const record = await workspace(project, "solo");
    await commit(record.path, "a.txt", "local only\n");
    expect((await inspectWorkspace(home, project, record, 0)).commits).toEqual({
      kind: "no-remote",
    });
  });

  it("shows what status leaves out, nested repositories and files git skips", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "hidden");
    await git(record.path, ["update-index", "--assume-unchanged", "README.md"]);
    await writeFile(join(record.path, "README.md"), "Changed where status can't see it.\n");
    await run("git", ["init", "-q", join(record.path, "vendor")], { env: gitEnvironment() });
    await commit(join(record.path, "vendor"), "lib.ts", "its own history\n");
    const view = await inspectWorkspace(home, project, record, 0);
    expect(view).toMatchObject({
      files: [{ code: "??", path: "vendor/" }],
      repositories: 1,
      hidden: 1,
      submodules: "none",
    });
  });

  it("answers a fingerprint that changes when a terminal starts there", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "busy");
    const before = await inspectWorkspace(home, project, record, 0);
    const after = await inspectWorkspace(home, project, record, 1);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    const sessions = { ...sessionsStub(), countInside: () => 1 };
    await expect(
      archiveWorkspace(home, project, record, before.fingerprint, sessions),
    ).rejects.toMatchObject({ code: "refused" });
    expect(sessions.stopped).toEqual([]);
  });

  it("refuses worktrees read without NUL separators", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "fix-login");
    const actual = await listWorktrees(project.path);
    vi.mocked(listWorktrees).mockResolvedValueOnce(
      actual === undefined ? undefined : { ...actual, separator: "\n" },
    );
    await expect(inspectWorkspace(home, project, record, 0)).rejects.toMatchObject({
      code: "refused",
      message:
        "Satellite archives a workspace only with git 2.36 or newer, which lists worktrees safely. Update git, then try again.",
    });
  });
});

describe("inspectWorkspace on a workspace git no longer counts", { timeout: realGitMs }, () => {
  const notCounted =
    "git no longer counts lost as a worktree, so Satellite won't archive it. Its folder stays in worktrees/repo/lost in the Satellite home, and once you move it out of there Satellite forgets the workspace.";

  it("names the folder when the worktree's .git file is gone", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "lost");
    await rm(join(record.path, ".git"));
    await expect(inspectWorkspace(home, project, record, 0)).rejects.toMatchObject({
      code: "refused",
      message: notCounted,
    });
  });

  it("names the folder when the repository no longer knows the worktree", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "lost");
    await rm(join(project.path, ".git", "worktrees", "lost"), { recursive: true });
    await expect(inspectWorkspace(home, project, record, 0)).rejects.toMatchObject({
      code: "refused",
      message: notCounted,
    });
  });

  it("names the folder when another repository took the project's place", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "lost");
    await rename(project.path, join(base, "repo-aside"));
    await repository("repo", false);
    await expect(inspectWorkspace(home, project, record, 0)).rejects.toMatchObject({
      code: "refused",
      message: notCounted,
    });
  });

  it("says the folder is gone when the Satellite home moved", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "lost");
    await rename(home, join(base, "home-moved"));
    await expect(inspectWorkspace(home, project, record, 0)).rejects.toMatchObject({
      code: "refused",
      message:
        "Satellite can't find lost's folder worktrees/repo/lost in the Satellite home, so it won't archive it.",
    });
  });
});

describe("archiveWorkspace", { timeout: realGitMs }, () => {
  it("refuses when the workspace changed since it was inspected", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "fix-login");
    const { fingerprint } = await inspectWorkspace(home, project, record, 0);
    await writeFile(join(record.path, "late.md"), "An agent wrote this after you looked.\n");
    const sessions = sessionsStub();
    await expect(
      archiveWorkspace(home, project, record, fingerprint, sessions),
    ).rejects.toMatchObject({
      code: "refused",
      message: "Something changed in fix-login since you looked. Here is the latest.",
    });
    expect(sessions.stopped).toEqual([]);
    expect(removeCalls()).toEqual([]);
    expect(await exists(join(record.path, "late.md"))).toBe(true);
  });

  it("refuses a locked worktree and never forces twice", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "fix-login");
    await git(project.path, ["worktree", "lock", record.path]);
    const view = await inspectWorkspace(home, project, record, 0);
    expect(view.locked).toBe(true);
    await expect(
      archiveWorkspace(home, project, record, view.fingerprint, sessionsStub()),
    ).rejects.toMatchObject({
      code: "refused",
      message:
        "fix-login is locked in git, so Satellite won't archive it. Run git worktree unlock on it first.",
    });
    expect(removeCalls()).toEqual([]);
    expect(await listed(project)).toContain(asGitPrints(record.path));
  });

  it("removes the worktree and keeps the branch", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "fix-login");
    await commit(record.path, "src/login.ts", "fix the login redirect\n");
    await writeFile(join(record.path, "notes.md"), "Ask about the timeout.\n");
    await mkdir(join(record.path, "node_modules"));
    await writeFile(join(record.path, "node_modules", "dep.js"), "\n");
    const { fingerprint } = await inspectWorkspace(home, project, record, 0);
    const sessions = sessionsStub();
    expect(await archiveWorkspace(home, project, record, fingerprint, sessions)).toEqual({
      leftover: null,
    });
    expect(sessions.stopped).toEqual([record.path]);
    expect(
      removeCalls().filter((args) => args.filter((arg) => arg === "--force").length > 1),
    ).toEqual([]);
    expect(await listed(project)).not.toContain(asGitPrints(record.path));
    expect(await git(project.path, ["branch", "--list", "fix-login"])).toBe("fix-login");
    expect(await git(project.path, ["log", "-1", "--format=%s", "fix-login"])).toBe(
      "fix the login redirect",
    );
    expect(await exists(record.path)).toBe(false);
  });

  it("removes a clean worktree without forcing", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "tidy");
    const { fingerprint } = await inspectWorkspace(home, project, record, 0);
    await archiveWorkspace(home, project, record, fingerprint, sessionsStub());
    expect(removeCalls()).toEqual([["worktree", "remove", "--end-of-options", record.path]]);
    expect(await exists(record.path)).toBe(false);
  });

  it("refuses when it can't tell whether submodules are checked out", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "unsure");
    const actual = await vi.importActual<typeof import("./git-command.ts")>("./git-command.ts");
    vi.mocked(runGit).mockImplementation((folder, args, ms, signal) => {
      if (args[0] === "rev-parse" && args.includes("modules")) {
        return Promise.resolve({ exitCode: 128, stdout: "", stderr: "fatal: no\n" });
      }
      return actual.runGit(folder, args, ms, signal);
    });
    try {
      const { fingerprint, submodules } = await inspectWorkspace(home, project, record, 0);
      expect(submodules).toBe("unknown");
      await expect(
        archiveWorkspace(home, project, record, fingerprint, sessionsStub()),
      ).rejects.toMatchObject({
        code: "refused",
        message:
          "Satellite couldn't check whether unsure has submodules checked out, so it won't archive it.",
      });
    } finally {
      vi.mocked(runGit).mockImplementation(actual.runGit);
    }
    expect(removeCalls()).toEqual([]);
    expect(await listed(project)).toContain(asGitPrints(record.path));
  });

  it("refuses when a file past the fiftieth one listed changed since it was inspected", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "many");
    const names = Array.from(
      { length: 60 },
      (_, index) => `f${String(index).padStart(2, "0")}.txt`,
    );
    for (const name of names) await writeFile(join(record.path, name), "first\n");
    await git(record.path, ["add", "-A"]);
    await git(record.path, ["commit", "-q", "-m", "sixty files"]);
    for (const name of names) await writeFile(join(record.path, name), "edited\n");
    const { fingerprint, moreFiles } = await inspectWorkspace(home, project, record, 0);
    expect(moreFiles).toBe(10);
    await rm(join(record.path, "f55.txt"));
    await expect(
      archiveWorkspace(home, project, record, fingerprint, sessionsStub()),
    ).rejects.toMatchObject({
      code: "refused",
      message: "Something changed in many since you looked. Here is the latest.",
    });
    expect(removeCalls()).toEqual([]);
  });

  it("leaves a folder made again at the same path after git removed the worktree", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "reborn");
    const { fingerprint } = await inspectWorkspace(home, project, record, 0);
    const actual = await vi.importActual<typeof import("./git-command.ts")>("./git-command.ts");
    vi.mocked(runGit).mockImplementation(async (folder, args, ms, signal) => {
      const answer = await actual.runGit(folder, args, ms, signal);
      if (args[0] === "worktree" && args[1] === "remove") {
        await mkdir(record.path);
        await writeFile(join(record.path, "new.md"), "Made after git removed it.\n");
      }
      return answer;
    });
    try {
      expect(await archiveWorkspace(home, project, record, fingerprint, sessionsStub())).toEqual({
        leftover: "worktrees/repo/reborn",
      });
    } finally {
      vi.mocked(runGit).mockImplementation(actual.runGit);
    }
    expect(await readFile(join(record.path, "new.md"), "utf8")).toBe(
      "Made after git removed it.\n",
    );
  });

  it.runIf(onUnix)(
    "never deletes through a worktrees folder swapped for a link after git let go",
    async () => {
      const project = await repository("repo", true);
      const record = await workspace(project, "moved");
      const { fingerprint } = await inspectWorkspace(home, project, record, 0);
      const parent = join(home, "worktrees", "repo");
      const elsewhere = join(base, "elsewhere");
      const actual = await vi.importActual<typeof import("./git-command.ts")>("./git-command.ts");
      vi.mocked(runGit).mockImplementation(async (folder, args, ms, signal) => {
        if (args[0] === "worktree" && args[1] === "remove") {
          await rm(join(project.path, ".git", "worktrees", "moved"), { recursive: true });
          await writeFile(join(record.path, "kept.md"), "Still mine.\n");
          await rename(parent, elsewhere);
          await symlink(elsewhere, parent);
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return actual.runGit(folder, args, ms, signal);
      });
      try {
        expect(await archiveWorkspace(home, project, record, fingerprint, sessionsStub())).toEqual({
          leftover: "worktrees/repo/moved",
        });
      } finally {
        vi.mocked(runGit).mockImplementation(actual.runGit);
      }
      expect(await readFile(join(elsewhere, "moved", "kept.md"), "utf8")).toBe("Still mine.\n");
    },
  );

  it("stops instead of forcing when a file appears in a clean worktree as git removes it", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "tidy");
    const { fingerprint } = await inspectWorkspace(home, project, record, 0);
    const actual = await vi.importActual<typeof import("./git-command.ts")>("./git-command.ts");
    vi.mocked(runGit).mockImplementation(async (folder, args, ms, signal) => {
      if (args[0] === "worktree" && args[1] === "remove") {
        await writeFile(join(record.path, "written-late.txt"), "Saved as git looked.\n");
      }
      return actual.runGit(folder, args, ms, signal);
    });
    try {
      await expect(
        archiveWorkspace(home, project, record, fingerprint, sessionsStub()),
      ).rejects.toMatchObject({
        code: "refused",
        message: "Something changed in tidy since you looked. Here is the latest.",
      });
    } finally {
      vi.mocked(runGit).mockImplementation(actual.runGit);
    }
    expect(removeCalls()).toEqual([["worktree", "remove", "--end-of-options", record.path]]);
    expect(await readFile(join(record.path, "written-late.txt"), "utf8")).toBe(
      "Saved as git looked.\n",
    );
  });

  it("refuses a worktree with a submodule checked out, so its history stays", async () => {
    const library = await repository("library", false);
    const project = await repository("repo", true);
    await git(project.path, ["submodule", "add", "-q", library.path, "lib"]);
    await git(project.path, ["commit", "-q", "-m", "add lib"]);
    const record = await workspace(project, "with-lib");
    await git(record.path, ["submodule", "update", "-q", "--init"]);
    await commit(join(record.path, "lib"), "local.txt", "only in the submodule\n");
    await writeFile(join(record.path, "notes.md"), "unclean too\n");
    const { fingerprint, submodules } = await inspectWorkspace(home, project, record, 0);
    expect(submodules).toBe("checked-out");
    await expect(
      archiveWorkspace(home, project, record, fingerprint, sessionsStub()),
    ).rejects.toMatchObject({
      code: "refused",
      message:
        "with-lib has submodules checked out, and git would delete their own history with it, so Satellite won't archive it.",
    });
    expect(removeCalls()).toEqual([]);
    expect(await listed(project)).toContain(asGitPrints(record.path));
    expect(await exists(join(record.path, "lib", "local.txt"))).toBe(true);
  });

  it("never touches a folder outside the worktrees folder", async () => {
    const project = await repository("repo", true);
    const outside = join(base, "outside");
    await git(project.path, ["worktree", "add", "-q", "-b", "outside", outside]);
    await writeFile(join(outside, "keep.md"), "Mine.\n");
    const record = { id: randomUUID(), name: "outside", path: outside, branch: "outside" };
    const refusal = {
      code: "failed",
      message: "Satellite couldn't read outside, so it won't archive it. Try again.",
    };
    await expect(inspectWorkspace(home, project, record, 0)).rejects.toMatchObject(refusal);
    await expect(
      archiveWorkspace(home, project, record, "0".repeat(64), sessionsStub()),
    ).rejects.toMatchObject(refusal);
    expect(gitCalls()).toEqual([]);
    expect(await readFile(join(outside, "keep.md"), "utf8")).toBe("Mine.\n");
  });

  it.runIf(onUnix)("names the folder when git leaves files it couldn't delete", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "stuck");
    const held = join(record.path, "held");
    await mkdir(held);
    await writeFile(join(held, "file.txt"), "in use\n");
    await chmod(held, 0o500);
    try {
      const { fingerprint } = await inspectWorkspace(home, project, record, 0);
      expect(await archiveWorkspace(home, project, record, fingerprint, sessionsStub())).toEqual({
        leftover: "worktrees/repo/stuck",
      });
      expect(await listed(project)).not.toContain(asGitPrints(record.path));
      expect(await git(project.path, ["branch", "--list", "stuck"])).toBe("stuck");
      expect(await exists(join(held, "file.txt"))).toBe(true);
    } finally {
      await chmod(held, 0o700);
    }
  });

  it("removes links to other folders before git runs, and never what they point to", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "linked");
    const outside = join(base, "outside");
    await mkdir(join(outside, "src"), { recursive: true });
    await writeFile(join(outside, "src", "keep.md"), "Mine.\n");
    await mkdir(join(record.path, "node_modules"));
    await symlink(outside, join(record.path, "node_modules", "shared-lib"), "junction");
    const { fingerprint } = await inspectWorkspace(home, project, record, 0);
    expect(await archiveWorkspace(home, project, record, fingerprint, sessionsStub())).toEqual({
      leftover: null,
    });
    expect(await exists(record.path)).toBe(false);
    expect(await readFile(join(outside, "src", "keep.md"), "utf8")).toBe("Mine.\n");
  });

  it.runIf(onUnix)("refuses before git runs when a link inside can't be removed", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "stuck");
    const outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.md"), "Mine.\n");
    const held = join(record.path, "held");
    await mkdir(held);
    await symlink(outside, join(held, "link"));
    await chmod(held, 0o500);
    try {
      const { fingerprint } = await inspectWorkspace(home, project, record, 0);
      await expect(
        archiveWorkspace(home, project, record, fingerprint, sessionsStub()),
      ).rejects.toMatchObject({
        code: "failed",
        message:
          "Satellite couldn't remove the link held/link inside stuck, so it won't let git delete the folder. Nothing was removed.",
      });
      expect(removeCalls()).toEqual([]);
      expect(await listed(project)).toContain(asGitPrints(record.path));
      expect(await readdir(outside)).toEqual(["keep.md"]);
    } finally {
      await chmod(held, 0o700);
    }
  });

  it("says what git left when its removal fails, times out or can't be checked", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "fragile");
    await writeFile(join(record.path, "notes.md"), "unclean\n");
    const actual = await vi.importActual<typeof import("./git-command.ts")>("./git-command.ts");
    const answers: ({ exitCode: number; stdout: string; stderr: string } | undefined)[] = [];
    vi.mocked(runGit).mockImplementation((folder, args, ms, signal) => {
      if (args[0] === "worktree" && args[1] === "remove") {
        return Promise.resolve(answers.shift());
      }
      return actual.runGit(folder, args, ms, signal);
    });
    const unclean = {
      exitCode: 128,
      stdout: "",
      stderr: `fatal: '${record.path}' contains modified or untracked files, use --force to delete it\n`,
    };
    const archive = async () => {
      const { fingerprint } = await inspectWorkspace(home, project, record, 0);
      return archiveWorkspace(home, project, record, fingerprint, sessionsStub());
    };
    try {
      answers.push({ exitCode: 128, stdout: "", stderr: "fatal: no\n" });
      await expect(archive()).rejects.toThrow(
        "git couldn't remove the worktree, so fragile stays as it was.",
      );
      answers.push(unclean, { exitCode: 255, stdout: "", stderr: "error: failed\n" });
      await expect(archive()).rejects.toThrow(
        "git couldn't finish removing the worktree, so some of fragile's files or links may be gone. The branch stays.",
      );
      answers.push(undefined);
      await expect(archive()).rejects.toThrow(
        "git didn't finish removing fragile within 2 minutes, so some of its files may be gone already. The branch stays.",
      );
      answers.push({ exitCode: 0, stdout: "", stderr: "" });
      const realList = vi.mocked(listWorktrees).getMockImplementation();
      let lists = 0;
      vi.mocked(listWorktrees).mockImplementation(async (root) => {
        lists += 1;
        return lists > 3 || realList === undefined ? undefined : realList(root);
      });
      await expect(archive()).rejects.toThrow(
        "Satellite couldn't tell whether git removed fragile. The branch stays, and the next list shows what is left.",
      );
    } finally {
      vi.mocked(runGit).mockImplementation(actual.runGit);
      const listActual =
        await vi.importActual<typeof import("./worktree-list.ts")>("./worktree-list.ts");
      vi.mocked(listWorktrees).mockImplementation(listActual.listWorktrees);
    }
    expect(await listed(project)).toContain(asGitPrints(record.path));
  });

  it("refuses when a file appears while it walks the worktree, so nothing unseen is deleted", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "busy");
    const { fingerprint } = await inspectWorkspace(home, project, record, 0);
    duringWalk.hook = () => writeFile(join(record.path, "late.md"), "Saved during the walk.\n");
    await expect(
      archiveWorkspace(home, project, record, fingerprint, sessionsStub()),
    ).rejects.toMatchObject({
      code: "refused",
      message: "Something changed in busy since you looked. Here is the latest.",
    });
    expect(removeCalls()).toEqual([]);
    expect(await readFile(join(record.path, "late.md"), "utf8")).toBe("Saved during the walk.\n");
  });

  it("refuses a worktree that belongs to a copy's original, links included", async () => {
    const original = await repository("repo", true);
    const record = await workspace(original, "shared");
    const outside = join(base, "outside");
    await mkdir(outside);
    await symlink(outside, join(record.path, "link"), "junction");
    const copyPath = join(base, "copies", "repo");
    await cp(original.path, copyPath, { recursive: true, verbatimSymlinks: true });
    const copy = { id: randomUUID(), path: await realpath(copyPath), workspaces: [] };
    expect(await listed(copy)).toContain(asGitPrints(record.path));
    await expect(inspectWorkspace(home, copy, record, 0)).rejects.toMatchObject({
      code: "failed",
      message: "Satellite couldn't read shared, so it won't archive it. Try again.",
    });
    expect(await exists(join(record.path, "link"))).toBe(true);
  });

  it("refuses a record that sits in another project's worktrees folder", async () => {
    const project = await repository("repo", true);
    const parent = join(home, "worktrees", "other");
    await mkdir(parent, { recursive: true });
    const path = join(await realpath(parent), "stray");
    await git(project.path, ["worktree", "add", "-q", "-b", "stray", path]);
    const record = { id: randomUUID(), name: "stray", path, branch: "stray" };
    await expect(inspectWorkspace(home, project, record, 0)).rejects.toMatchObject({
      code: "failed",
      message: "Satellite couldn't read stray, so it won't archive it. Try again.",
    });
    expect(gitCalls()).toEqual([]);
  });
});

describe("removeWorktree", { timeout: realGitMs }, () => {
  it("leaves a worktree that holds a folder on another device as it is, links included", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "mounted");
    const outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.md"), "Mine.\n");
    await symlink(outside, join(record.path, "linked"), "junction");
    const mounted = join(record.path, "data");
    await mkdir(mounted);
    await writeFile(join(mounted, "remote.md"), "On another drive.\n");
    const read = async (path: string) => {
      const entry = await lstat(path, { bigint: true });
      if (path === mounted) entry.dev += 1n;
      return entry;
    };
    expect(await boundaryInside(record.path, read)).toEqual({ kind: "mount", at: "data" });
    expect(await boundaryInside(record.path)).toEqual({ kind: "clear" });
    expect(
      await removeWorktree(project.path, record.path, { force: true, locked: false, read }),
    ).toEqual({ kind: "kept", kept: { kind: "mount", at: "data" }, linksRemoved: 0 });
    expect(removeCalls()).toEqual([]);
    expect(await listed(project)).toContain(asGitPrints(record.path));
    expect(await readFile(join(mounted, "remote.md"), "utf8")).toBe("On another drive.\n");
    expect(await exists(join(record.path, "linked"))).toBe(true);
  });

  it("leaves a worktree it can't see whole as it is, on every system", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "hidden");
    const outside = join(base, "outside");
    await mkdir(outside);
    await symlink(outside, join(record.path, "linked"), "junction");
    const closed = join(record.path, "closed");
    await mkdir(closed);
    const read = (path: string) =>
      path === closed
        ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
        : lstat(path, { bigint: true });
    expect(await boundaryInside(record.path, read)).toEqual({
      kind: "unchecked",
      why: "unreadable",
    });
    expect(
      await removeWorktree(project.path, record.path, { force: true, locked: false, read }),
    ).toEqual({ kind: "kept", kept: { kind: "unchecked", why: "unreadable" }, linksRemoved: 0 });
    expect(removeCalls()).toEqual([]);
    expect(await listed(project)).toContain(asGitPrints(record.path));
    expect(await exists(join(record.path, "linked"))).toBe(true);
  });
});
