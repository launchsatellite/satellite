import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BridgeOwner } from "../bridge/registry.ts";
import { createProjects } from "./project-list.ts";
import type { StoredWorkspace } from "./projects-file.ts";

const owner: BridgeOwner = { id: 1, emit: () => undefined, onGone: () => undefined };
const hung = vi.hoisted(() => {
  const release: (() => void)[] = [];
  return {
    path: "",
    paths: new Set<string>(),
    calls: 0,
    writes: false,
    failWrites: false,
    release,
  };
});
const timers = vi.hoisted(() => ({ instant: true, real: false }));
const git = vi.hoisted(() => ({ runs: 0, abandon: false, exits: false, olderThanNul: false }));
const run = promisify(execFile);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => {
      const path = String(args[0]);
      if (path !== hung.path && !hung.paths.has(path)) return actual.stat(...args);
      hung.calls += 1;
      return new Promise<never>((_resolve, reject) => {
        hung.release.push(() => {
          reject(new Error("the share went away"));
        });
      });
    },
    open: (...args: Parameters<typeof actual.open>) => {
      if (hung.writes && args[1] === "wx") return new Promise<never>(() => undefined);
      if (hung.failWrites && args[1] === "wx") {
        return Promise.reject(new Error("the disk refused the write"));
      }
      return actual.open(...args);
    },
  };
});

vi.mock("../platform/tools.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/tools.ts")>();
  return {
    ...actual,
    runTool: (...args: Parameters<typeof actual.runTool>) => {
      const [, toolArgs] = args;
      if (git.olderThanNul && toolArgs.includes("worktree") && toolArgs.includes("-z")) {
        return Promise.resolve({ exitCode: 129, stdout: "", stderr: "error: unknown switch `z'" });
      }
      if (!git.abandon) return actual.runTool(...args);
      git.runs += 1;
      const exited = git.exits ? Promise.resolve() : new Promise<void>(() => undefined);
      return Promise.reject(new actual.AbandonedRun("git did not finish in time", exited));
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

vi.mock("node:timers/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:timers/promises")>();
  return {
    setTimeout: (...args: Parameters<typeof actual.setTimeout>) => {
      if (timers.real) return actual.setTimeout(...args);
      return timers.instant
        ? Promise.resolve()
        : new Promise((resolve) => {
            setTimeout(resolve, 200);
          });
    },
  };
});

afterEach(() => {
  timers.instant = true;
  timers.real = false;
  git.abandon = false;
  git.exits = false;
  vi.unstubAllEnvs();
});

async function homeWith(paths: string[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "satellite-project-list-"));
  await writeFile(
    join(home, "projects.json"),
    JSON.stringify({ version: 1, projects: paths.map((path) => ({ id: randomUUID(), path })) }),
  );
  return home;
}

function gitEnvironment(config: string): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  return { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
}

async function repoWithWorkspace(options: { cloned?: boolean } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-project-workspaces-")));
  const config = join(base, "gitconfig");
  await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", config);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  const repo = join(base, "repo");
  const home = join(base, "home");
  const gitIn = (folder: string, args: string[]) =>
    run("git", ["-C", folder, ...args], { env: gitEnvironment(config) });
  const first = options.cloned === true ? join(base, "upstream") : repo;
  await mkdir(first);
  await mkdir(home);
  await gitIn(first, ["init", "-q", "-b", "main"]);
  await writeFile(join(first, "a"), "a\n");
  await gitIn(first, ["add", "a"]);
  await gitIn(first, ["commit", "-q", "-m", "one"]);
  if (options.cloned === true) await gitIn(base, ["clone", "-q", first, repo]);
  await gitIn(repo, ["branch", "--no-track", "fix-login", "HEAD"]);
  const folder = join(home, "worktrees", "repo", "fix-login");
  await gitIn(repo, ["worktree", "add", "-q", folder, "fix-login"]);
  const workspace: StoredWorkspace = {
    id: randomUUID(),
    name: "fix-login",
    path: await realpath(folder),
    branch: "fix-login",
  };
  await writeFile(
    join(home, "projects.json"),
    JSON.stringify({
      version: 2,
      projects: [{ id: randomUUID(), path: repo, workspaces: [workspace] }],
    }),
  );
  timers.real = true;
  return { base, home, repo, gitIn, workspace, projects: projectsIn(home) };
}

const storedFile = z.object({
  projects: z.array(z.object({ workspaces: z.array(z.object({ id: z.string() })) })),
});

async function storedWorkspaceIds(home: string): Promise<string[]> {
  const file = storedFile.parse(JSON.parse(await readFile(join(home, "projects.json"), "utf8")));
  return file.projects.flatMap((project) => project.workspaces.map((workspace) => workspace.id));
}

function projectsIn(home: string) {
  return createProjects({
    home,
    chooseFolder: () => Promise.resolve(undefined),
    window: () => undefined,
  });
}

describe("createProjects", () => {
  it("keeps healthy projects healthy while folders hang, and bounds the hung reads", async () => {
    const base = await mkdtemp(join(tmpdir(), "satellite-project-hung-"));
    const stuck = ["a", "b", "c"].map((name) => join(base, name));
    const healthy = ["d", "e"].map((name) => join(base, name));
    for (const folder of healthy) await mkdir(folder);
    hung.paths = new Set(stuck);
    hung.calls = 0;
    hung.release = [];
    timers.instant = false;
    try {
      const { handlers } = projectsIn(await homeWith([...stuck, ...healthy]));
      const states = async () =>
        (await handlers["projects.list"]({}, owner)).projects.map((project) => project.missing);
      expect(await states()).toEqual(["folder", "folder", "folder", "repository", "repository"]);
      expect(hung.calls).toBe(3);
      for (const release of hung.release.splice(0)) release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await states()).toEqual(["folder", "folder", "folder", "repository", "repository"]);
      expect(hung.calls).toBe(5);
    } finally {
      timers.instant = true;
      hung.paths = new Set();
      for (const release of hung.release.splice(0)) release();
    }
  });

  it("settles a change whose save never finishes, and the next change too", async () => {
    const base = await mkdtemp(join(tmpdir(), "satellite-project-save-"));
    const home = await homeWith([join(base, "a"), join(base, "b")]);
    const { handlers } = projectsIn(home);
    const { projects } = await handlers["projects.list"]({}, owner);
    hung.writes = true;
    try {
      for (const project of projects) {
        await expect(handlers["projects.remove"]({ projectId: project.id }, owner)).rejects.toThrow(
          "Satellite couldn't save the project list. Nothing changed.",
        );
      }
    } finally {
      hung.writes = false;
    }
  });

  it("starts no new git for a project while an abandoned one is still running", async () => {
    const base = await mkdtemp(join(tmpdir(), "satellite-project-git-"));
    const folder = join(base, "repo");
    await mkdir(join(folder, ".git"), { recursive: true });
    const { handlers } = projectsIn(await homeWith([folder]));
    git.abandon = true;
    git.runs = 0;
    try {
      for (let refresh = 0; refresh < 3; refresh += 1) {
        await handlers["projects.list"]({}, owner);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(git.runs).toBe(1);
    } finally {
      git.abandon = false;
    }
  });

  it("reads a folder that never answers once, however often the list is asked for", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-project-list-"));
    hung.path = join(home, "hung");
    hung.calls = 0;
    await writeFile(
      join(home, "projects.json"),
      JSON.stringify({
        version: 1,
        projects: [{ id: "8a6e0804-2bd0-4e1f-9b5a-6b1b6c3c2f10", path: hung.path }],
      }),
    );
    const { handlers } = createProjects({
      home,
      chooseFolder: () => Promise.resolve(undefined),
      window: () => undefined,
    });
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const answer = handlers["projects.list"]({}, owner);
      const { projects } = await answer;
      expect(projects[0]?.missing).toBe("folder");
    }
    expect(hung.calls).toBe(1);
  });

  it("adds one folder at a time and refuses a new add while a folder read never answers", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-project-add-")));
    hung.path = join(base, "hung");
    await mkdir(hung.path);
    await mkdir(join(base, "home"));
    const { handlers } = createProjects({
      home: join(base, "home"),
      chooseFolder: () => Promise.resolve(base),
      window: () => undefined,
    });
    const first = handlers["projects.drop"]({ path: hung.path }, owner);
    const second = handlers["projects.choose"]({}, owner);
    await expect(second).rejects.toThrow("Satellite is still adding the last folder.");
    await expect(first).rejects.toThrow(
      "That folder didn't answer within 6 seconds. Check the drive it's on, then try again.",
    );
    await expect(handlers["projects.drop"]({ path: base }, owner)).rejects.toThrow(
      "Satellite is still waiting on a folder that didn't answer. Try again in a moment.",
    );
  });
  it("lists a workspace with its branch and changed files", async () => {
    const { workspace, projects } = await repoWithWorkspace();
    await writeFile(join(workspace.path, "new"), "new\n");
    const answer = await projects.handlers["projects.list"]({}, owner);
    expect(answer.dropped).toEqual([]);
    expect(answer.projects[0]?.workspaces).toEqual([
      { key: "main", name: null, branch: "main", ahead: null, behind: null, changed: 0 },
      {
        key: workspace.id,
        name: "fix-login",
        branch: "fix-login",
        ahead: null,
        behind: null,
        changed: 1,
      },
    ]);
  });

  it("drops a workspace whose folder was deleted and says why", async () => {
    const { home, workspace, projects } = await repoWithWorkspace();
    await rm(workspace.path, { recursive: true, force: true });
    const answer = await projects.handlers["projects.list"]({}, owner);
    expect(answer.dropped).toEqual([
      "fix-login left repo because its folder was deleted outside Satellite. git still counts fix-login as checked out there until you run git worktree prune.",
    ]);
    expect(answer.projects[0]?.workspaces.map((view) => view.key)).toEqual(["main"]);
    expect(await storedWorkspaceIds(home)).toEqual([]);
  });

  it("keeps a workspace whose folder sits on a drive that is gone", async () => {
    const { home, workspace, projects } = await repoWithWorkspace();
    await rm(join(home, "worktrees"), { recursive: true, force: true });
    const answer = await projects.handlers["projects.list"]({}, owner);
    expect(answer.dropped).toEqual([]);
    expect(answer.projects[0]?.workspaces[1]).toMatchObject({ key: workspace.id, branch: null });
    expect(await storedWorkspaceIds(home)).toEqual([workspace.id]);
  });

  it("explains a dropped workspace whose branch is checked out elsewhere", async () => {
    const { repo, gitIn, workspace, projects } = await repoWithWorkspace();
    await gitIn(repo, ["worktree", "remove", workspace.path]);
    await gitIn(repo, ["switch", "-q", "fix-login"]);
    const answer = await projects.handlers["projects.list"]({}, owner);
    expect(answer.dropped).toEqual([
      "fix-login left repo because its worktree was removed outside Satellite. Its branch fix-login is checked out in repo now.",
    ]);
  });

  it("keeps a workspace that is being archived", async () => {
    const { home, repo, gitIn, workspace, projects } = await repoWithWorkspace();
    await gitIn(repo, ["worktree", "remove", workspace.path]);
    projects.store.busy.add(workspace.id);
    const answer = await projects.handlers["projects.list"]({}, owner);
    expect(answer.dropped).toEqual([]);
    expect(answer.projects[0]?.workspaces[1]).toMatchObject({ key: workspace.id, branch: null });
    expect(await storedWorkspaceIds(home)).toEqual([workspace.id]);
  });

  it("keeps every record when git cannot list worktrees", async () => {
    const { home, repo, gitIn, workspace, projects } = await repoWithWorkspace();
    await gitIn(repo, ["worktree", "remove", workspace.path]);
    git.abandon = true;
    git.exits = true;
    const failed = await projects.handlers["projects.list"]({}, owner);
    expect(failed.dropped).toEqual([]);
    expect(failed.projects[0]?.workspaces.map((view) => [view.key, view.branch])).toEqual([
      ["main", null],
      [workspace.id, null],
    ]);
    git.exits = false;
    timers.real = false;
    timers.instant = false;
    const hung = await projectsIn(home).handlers["projects.list"]({}, owner);
    expect(hung.dropped).toEqual([]);
    expect(hung.projects[0]?.workspaces.map((view) => view.key)).toEqual(["main", workspace.id]);
    expect(await storedWorkspaceIds(home)).toEqual([workspace.id]);
  });

  it("refuses to remove a project that has workspaces", async () => {
    const { home, projects } = await repoWithWorkspace();
    const [project] = (await projects.handlers["projects.list"]({}, owner)).projects;
    await expect(
      projects.handlers["projects.remove"]({ projectId: project?.id ?? "" }, owner),
    ).rejects.toThrow("repo still has 1 workspace. Archive it first, then remove the project.");
    expect(await storedWorkspaceIds(home)).toHaveLength(1);
  });

  it("forgets a missing project with its workspaces", async () => {
    const { home, repo, projects } = await repoWithWorkspace();
    await rm(repo, { recursive: true, force: true });
    const [project] = (await projects.handlers["projects.list"]({}, owner)).projects;
    expect(project?.missing).toBe("folder");
    expect(
      await projects.handlers["projects.remove"]({ projectId: project?.id ?? "" }, owner),
    ).toEqual({ forgotWorkspaces: 1 });
    expect(await storedWorkspaceIds(home)).toEqual([]);
  });

  it("counts commits on no remote as ahead when a branch has no upstream", async () => {
    const { gitIn, workspace, projects } = await repoWithWorkspace({ cloned: true });
    await gitIn(workspace.path, ["commit", "-q", "--allow-empty", "-m", "two"]);
    await gitIn(workspace.path, ["commit", "-q", "--allow-empty", "-m", "three"]);
    const answer = await projects.handlers["projects.list"]({}, owner);
    expect(answer.projects[0]?.workspaces.map(({ ahead, behind }) => [ahead, behind])).toEqual([
      [0, 0],
      [2, null],
    ]);
  });

  it("keeps a workspace git leaves out while its folder is still there", async () => {
    const { home, repo, workspace, projects } = await repoWithWorkspace();
    await rm(join(repo, ".git", "worktrees", "fix-login"), { recursive: true, force: true });
    const answer = await projects.handlers["projects.list"]({}, owner);
    expect(answer.dropped).toEqual([]);
    expect(answer.projects[0]?.workspaces[1]).toMatchObject({ key: workspace.id, branch: null });
    expect(await storedWorkspaceIds(home)).toEqual([workspace.id]);
  });

  it("keeps a workspace whose stored path differs from git's by a link or by case", async () => {
    const { base, home, workspace } = await repoWithWorkspace();
    await symlink(join(home, "worktrees"), join(base, "linked"));
    const spellings = [
      join(base, "linked", "repo", "fix-login"),
      workspace.path.replace("fix-login", "FIX-LOGIN"),
    ];
    const stored = join(home, "projects.json");
    const original = await readFile(stored, "utf8");
    for (const path of spellings) {
      await writeFile(
        stored,
        original.replace(JSON.stringify(workspace.path), JSON.stringify(path)),
      );
      expect(await readFile(stored, "utf8")).toContain(JSON.stringify(path));
      const answer = await projectsIn(home).handlers["projects.list"]({}, owner);
      expect(answer.dropped).toEqual([]);
      expect(await storedWorkspaceIds(home)).toEqual([workspace.id]);
    }
  });

  it("shows a dropped workspace again when its record could not be forgotten", async () => {
    const { home, workspace, projects } = await repoWithWorkspace();
    await rm(workspace.path, { recursive: true, force: true });
    hung.failWrites = true;
    try {
      const answer = await projects.handlers["projects.list"]({}, owner);
      expect(answer.dropped).toEqual([]);
      expect(answer.projects[0]?.workspaces[1]).toMatchObject({ key: workspace.id, branch: null });
    } finally {
      hung.failWrites = false;
    }
    expect(await storedWorkspaceIds(home)).toEqual([workspace.id]);
  });

  it("never drops a workspace when git is too old to separate paths safely", async () => {
    const { home, repo, gitIn, workspace, projects } = await repoWithWorkspace();
    await gitIn(repo, ["worktree", "remove", workspace.path]);
    git.olderThanNul = true;
    const answer = await projects.handlers["projects.list"]({}, owner);
    expect(answer.dropped).toEqual([]);
    expect(answer.projects[0]?.workspaces[0]?.branch).toBe("main");
    expect(await storedWorkspaceIds(home)).toEqual([workspace.id]);
  });
});
