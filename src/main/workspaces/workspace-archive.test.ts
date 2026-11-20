import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
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
import { archiveWorkspace, inspectWorkspace } from "./workspace-archive.ts";
import { listWorktrees } from "./worktree-list.ts";

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

function removeCalls(): string[][] {
  return vi
    .mocked(runGit)
    .mock.calls.map(([, args]) => [...args])
    .filter((args) => args[0] === "worktree" && args[1] === "remove");
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
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("inspectWorkspace", () => {
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

describe("archiveWorkspace", () => {
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

  it("refuses a worktree with a submodule checked out, so its history stays", async () => {
    const library = await repository("library", false);
    const project = await repository("repo", true);
    await git(project.path, ["submodule", "add", "-q", library.path, "lib"]);
    await git(project.path, ["commit", "-q", "-m", "add lib"]);
    const record = await workspace(project, "with-lib");
    await git(record.path, ["submodule", "update", "-q", "--init"]);
    await commit(join(record.path, "lib"), "local.txt", "only in the submodule\n");
    await writeFile(join(record.path, "notes.md"), "unclean too\n");
    const { fingerprint } = await inspectWorkspace(home, project, record, 0);
    await expect(
      archiveWorkspace(home, project, record, fingerprint, sessionsStub()),
    ).rejects.toMatchObject({
      code: "refused",
      message:
        "with-lib has submodules checked out, and git would delete their own history with it, so Satellite won't archive it.",
    });
    expect(removeCalls().some((args) => args.includes("--force"))).toBe(false);
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
    expect(vi.mocked(runGit)).not.toHaveBeenCalled();
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

  it.runIf(onUnix)("deletes what git left without following a link out of it", async () => {
    const project = await repository("repo", true);
    const record = await workspace(project, "stuck");
    const outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.md"), "Mine.\n");
    const held = join(record.path, "held");
    await mkdir(held);
    await writeFile(join(held, "file.txt"), "in use\n");
    await symlink(outside, join(held, "link"));
    await chmod(held, 0o500);
    beforeRemove.hook = () => chmod(held, 0o700);
    const { fingerprint } = await inspectWorkspace(home, project, record, 0);
    expect(await archiveWorkspace(home, project, record, fingerprint, sessionsStub())).toEqual({
      leftover: null,
    });
    expect(await exists(record.path)).toBe(false);
    expect(await readdir(outside)).toEqual(["keep.md"]);
  });
});
