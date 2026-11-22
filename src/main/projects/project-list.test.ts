import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BridgeOwner } from "../bridge/registry.ts";
import { workspaceHandlers } from "../workspaces/workspace-handlers.ts";
import { createProjects, parentName, shownProjectName } from "./project-list.ts";
import type { StoredProject, StoredWorkspace } from "./projects-file.ts";

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

function projectsIn(
  home: string,
  stopSessions: (folder: string) => Promise<void> = () => Promise.resolve(),
) {
  return createProjects({
    home,
    chooseFolder: () => Promise.resolve(undefined),
    window: () => undefined,
    stopSessions,
    recorded: () => undefined,
  });
}

describe("parentName and shownProjectName", () => {
  it("never names the user's home folder as a project's parent", () => {
    const home = join(tmpdir(), "home-of-someone");
    expect(parentName(join(home, "app"), home)).toBe("your home folder");
    expect(parentName(join(home, "work", "app"), home)).toBe("work");
  });

  it("knows the home folder through a link, in any case where case is ignored, and as a project", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-home-")));
    const real = join(base, "someone");
    await mkdir(join(real, "work"), { recursive: true });
    const linked = join(base, "linked-someone");
    await symlink(real, linked, "junction");
    expect(parentName(join(real, "app"), linked)).toBe("your home folder");
    expect(parentName(join(real, "work", "app"), linked)).toBe("work");
    expect(shownProjectName(real, linked)).toBe("your home folder");
    expect(shownProjectName(join(real, "work"), linked)).toBe("work");
    if (process.platform !== "linux") {
      expect(parentName(join(real.toUpperCase(), "app"), linked)).toBe("your home folder");
    }
    const gone = join(base, "nobody");
    expect(parentName(join(gone, "app"), gone)).toBe("your home folder");
    expect(shownProjectName(join(base, "elsewhere"), gone)).toBe("elsewhere");
    await rm(base, { recursive: true, force: true });
  });
});

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
      stopSessions: () => Promise.resolve(),
      recorded: () => undefined,
    });
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const answer = handlers["projects.list"]({}, owner);
      const { projects } = await answer;
      expect(projects[0]?.missing).toBe("folder");
    }
    expect(hung.calls).toBe(1);
  });

  it("lets workspace requests on a folder that never answers hold one read", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-project-list-"));
    const projectId = "8a6e0804-2bd0-4e1f-9b5a-6b1b6c3c2f10";
    hung.path = join(home, "hung");
    hung.calls = 0;
    await writeFile(
      join(home, "projects.json"),
      JSON.stringify({ version: 1, projects: [{ id: projectId, path: hung.path }] }),
    );
    const { store } = projectsIn(home);
    const sessions = { countInside: () => 0, stopInside: () => Promise.resolve() };
    const { handlers } = workspaceHandlers({ home, store, sessions });
    const unavailable = {
      code: "refused",
      message: "hung isn't available right now, so Satellite can't make a workspace in it.",
    };
    for (let request = 0; request < 3; request += 1) {
      await expect(handlers["workspaces.prepare"]({ projectId }, owner)).rejects.toMatchObject(
        unavailable,
      );
      await expect(
        handlers["workspaces.create"](
          { operationId: randomUUID(), projectId, name: "fix", start: { kind: "default" } },
          owner,
        ),
      ).rejects.toMatchObject(unavailable);
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
      stopSessions: () => Promise.resolve(),
      recorded: () => undefined,
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
  it("refuses to add a project over a file a newer Satellite saved, leaving it as it was", async () => {
    const { base, home } = await repoWithWorkspace();
    const other = join(base, "other");
    await mkdir(other);
    await run("git", ["init", "-q", "-b", "main", other]);
    const saved = JSON.stringify({ version: 3, projects: [{ id: randomUUID(), future: true }] });
    await writeFile(join(home, "projects.json"), saved);
    const { handlers } = projectsIn(home);
    await expect(handlers["projects.drop"]({ path: other }, owner)).rejects.toThrow(
      "Your projects were saved by a newer Satellite, so this one won't change them. Open that newer version to add or remove a project.",
    );
    expect(await readFile(join(home, "projects.json"), "utf8")).toBe(saved);
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

  it("stops the sessions of a workspace it drops, so no claude runs on in a deleted folder", async () => {
    const { home, workspace } = await repoWithWorkspace();
    const stopSessions = vi.fn((folder: string) => {
      expect(folder).toBeTypeOf("string");
      return Promise.resolve();
    });
    const projects = projectsIn(home, stopSessions);
    await projects.handlers["projects.list"]({}, owner);
    expect(stopSessions).not.toHaveBeenCalled();
    await rm(workspace.path, { recursive: true, force: true });
    await projects.handlers["projects.list"]({}, owner);
    expect(stopSessions.mock.calls).toEqual([[workspace.path]]);
  });

  it("drops every workspace of a project whose worktrees folder was deleted, in one sentence", async () => {
    const { home, repo, gitIn, workspace } = await repoWithWorkspace();
    const more: StoredWorkspace[] = [];
    for (const name of ["w-a", "w-b", "w-c"]) {
      const path = join(home, "worktrees", "repo", name);
      await gitIn(repo, ["worktree", "add", "-q", "-b", name, path]);
      more.push({ id: randomUUID(), name, path: await realpath(path), branch: name });
    }
    await writeFile(
      join(home, "projects.json"),
      JSON.stringify({
        version: 2,
        projects: [{ id: randomUUID(), path: repo, workspaces: [workspace, ...more] }],
      }),
    );
    await rm(join(home, "worktrees", "repo"), { recursive: true, force: true });
    const answer = await projectsIn(home).handlers["projects.list"]({}, owner);
    expect(answer.dropped).toEqual([
      "4 workspaces left repo because they were removed outside Satellite, fix-login, w-a, w-b and w-c. git still counts some of their branches as checked out until you run git worktree prune.",
    ]);
    expect(answer.projects[0]?.workspaces.map((view) => view.key)).toEqual(["main"]);
    expect(await storedWorkspaceIds(home)).toEqual([]);
  });

  it("replaces a record whose folder a new workspace now holds, so no folder is saved twice", async () => {
    const { home, workspace, projects } = await repoWithWorkspace();
    const listed = await projects.handlers["projects.list"]({}, owner);
    const fresh = { ...workspace, id: randomUUID() };
    await projects.store.addWorkspace(listed.projects[0]?.id ?? "", fresh);
    await projects.flush();
    expect(await storedWorkspaceIds(home)).toEqual([fresh.id]);
    const reread = await projectsIn(home).handlers["projects.list"]({}, owner);
    expect(reread.notice).toBeNull();
  });

  it("drops a workspace when Satellite's whole worktrees folder was deleted", async () => {
    const { home, projects } = await repoWithWorkspace();
    await rm(join(home, "worktrees"), { recursive: true, force: true });
    const answer = await projects.handlers["projects.list"]({}, owner);
    expect(answer.dropped).toEqual([
      "fix-login left repo because its folder was deleted outside Satellite. git still counts fix-login as checked out there until you run git worktree prune.",
    ]);
    expect(await storedWorkspaceIds(home)).toEqual([]);
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

  it.each([
    ["the worktree's .git file is gone", (repo: string, folder: string) => [join(folder, ".git")]],
    [
      "the repository no longer knows the worktree",
      (repo: string) => [join(repo, ".git", "worktrees", "fix-login")],
    ],
  ])(
    "forgets workspaces git no longer counts when %s, and keeps their folders",
    async (_, gone) => {
      const { home, repo, workspace, projects } = await repoWithWorkspace();
      for (const path of gone(repo, workspace.path)) await rm(path, { recursive: true });
      const [project] = (await projects.handlers["projects.list"]({}, owner)).projects;
      expect(
        await projects.handlers["projects.remove"]({ projectId: project?.id ?? "" }, owner),
      ).toEqual({ forgotWorkspaces: 1 });
      expect(await storedWorkspaceIds(home)).toEqual([]);
      expect(await stat(join(workspace.path, "a")).then((entry) => entry.isFile())).toBe(true);
    },
  );

  it("forgets workspaces of a repository another one replaced, and keeps their folders", async () => {
    const { base, home, repo, gitIn, workspace, projects } = await repoWithWorkspace();
    const [project] = (await projects.handlers["projects.list"]({}, owner)).projects;
    await rename(repo, join(base, "repo-aside"));
    await mkdir(repo);
    await gitIn(repo, ["init", "-q", "-b", "main"]);
    expect(
      await projects.handlers["projects.remove"]({ projectId: project?.id ?? "" }, owner),
    ).toEqual({ forgotWorkspaces: 1 });
    expect(await storedWorkspaceIds(home)).toEqual([]);
    expect(await stat(join(workspace.path, "a")).then((entry) => entry.isFile())).toBe(true);
  });

  it("forgets a missing project with its workspaces and stops the sessions in each", async () => {
    const { home, repo, workspace } = await repoWithWorkspace();
    const stopSessions = vi.fn((folder: string) => {
      expect(folder).toBeTypeOf("string");
      return Promise.resolve();
    });
    const projects = projectsIn(home, stopSessions);
    await rm(repo, { recursive: true, force: true });
    const [project] = (await projects.handlers["projects.list"]({}, owner)).projects;
    expect(project?.missing).toBe("folder");
    expect(project?.worktrees).toBe("worktrees/repo");
    expect(
      await projects.handlers["projects.remove"]({ projectId: project?.id ?? "" }, owner),
    ).toEqual({ forgotWorkspaces: 1 });
    expect(await storedWorkspaceIds(home)).toEqual([]);
    expect(stopSessions.mock.calls.map(([folder]) => folder).sort()).toEqual(
      [repo, workspace.path].sort(),
    );
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

  async function listsWithStoredPath(home: string, from: string, to: string) {
    const stored = join(home, "projects.json");
    const original = await readFile(stored, "utf8");
    await writeFile(stored, original.replace(JSON.stringify(from), JSON.stringify(to)));
    expect(await readFile(stored, "utf8")).toContain(JSON.stringify(to));
    return projectsIn(home).handlers["projects.list"]({}, owner);
  }

  it("keeps a workspace whose stored path reaches git's by a link", async () => {
    const { base, home, workspace } = await repoWithWorkspace();
    await symlink(join(home, "worktrees"), join(base, "linked"), "junction");
    const linked = join(base, "linked", "repo", "fix-login");
    const answer = await listsWithStoredPath(home, workspace.path, linked);
    expect(answer.dropped).toEqual([]);
    expect(await storedWorkspaceIds(home)).toEqual([workspace.id]);
  });

  it("keeps a workspace whose stored path differs from git's by case where the volume ignores case", async (context) => {
    const { home, workspace } = await repoWithWorkspace();
    const upper = workspace.path.replace("fix-login", "FIX-LOGIN");
    const ignoresCase = await stat(upper).then(
      () => true,
      () => false,
    );
    if (!ignoresCase) context.skip();
    const answer = await listsWithStoredPath(home, workspace.path, upper);
    expect(answer.dropped).toEqual([]);
    expect(await storedWorkspaceIds(home)).toEqual([workspace.id]);
  });

  it("adopts a worktree left in its own folder with no record, but never while one is made", async () => {
    const { home, repo, gitIn, projects } = await repoWithWorkspace();
    const leftover = join(home, "worktrees", "repo", "left-over");
    await gitIn(repo, ["worktree", "add", "-q", "-b", "left-over", leftover]);
    const first = await projects.handlers["projects.list"]({}, owner);
    const projectId = first.projects[0]?.id ?? "";
    expect(first.projects[0]?.workspaces.map((workspace) => workspace.name)).toEqual([
      null,
      "fix-login",
      "left-over",
    ]);
    const stored = await storedWorkspaceIds(home);
    expect(stored).toHaveLength(2);
    const again = await projectsIn(home).handlers["projects.list"]({}, owner);
    expect(again.projects[0]?.workspaces.map((workspace) => workspace.key).slice(1)).toEqual(
      stored,
    );
    const making = join(home, "worktrees", "repo", "being-made");
    await gitIn(repo, ["worktree", "add", "-q", "-b", "being-made", making]);
    projects.store.creating.add(projectId);
    const during = await projects.handlers["projects.list"]({}, owner);
    expect(during.projects[0]?.workspaces.map((workspace) => workspace.name)).not.toContain(
      "being-made",
    );
    expect(await storedWorkspaceIds(home)).toEqual(stored);
  });

  it("never adopts a worktree whose checkout was cut off, and names its folder once", async () => {
    const { home, repo, gitIn, projects } = await repoWithWorkspace();
    await writeFile(join(repo, ".gitattributes"), "cut.txt filter=cut\n");
    await writeFile(join(repo, "cut.txt"), "cut\n");
    await gitIn(repo, ["add", ".gitattributes", "cut.txt"]);
    await gitIn(repo, ["commit", "-q", "-m", "two"]);
    await gitIn(repo, ["config", "filter.cut.smudge", "kill -9 0"]);
    const half = join(home, "worktrees", "repo", "half-made");
    const cut = spawn("git", ["-C", repo, "worktree", "add", "-q", "-b", "half-made", half], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, LC_ALL: "C" },
    });
    const signal = await new Promise<NodeJS.Signals | null>((resolve) => {
      cut.on("exit", (_code, killedBy) => {
        resolve(killedBy);
      });
    });
    expect(signal).toBe("SIGKILL");
    const lock = await readFile(join(repo, ".git", "worktrees", "half-made", "locked"), "utf8");
    expect(lock.trim()).toBe("initializing");
    const first = await projects.handlers["projects.list"]({}, owner);
    expect(first.projects[0]?.workspaces.map((workspace) => workspace.name)).toEqual([
      null,
      "fix-login",
    ]);
    expect(first.dropped).toEqual([
      "Making half-made in repo stopped halfway, so Satellite leaves worktrees/repo/half-made in the Satellite home out of the list. git worktree remove --force --force on it clears it.",
    ]);
    expect(await storedWorkspaceIds(home)).toHaveLength(1);
    expect((await projects.handlers["projects.list"]({}, owner)).dropped).toEqual([]);
    expect(await stat(half).then((entry) => entry.isDirectory())).toBe(true);
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

  it("reports the recorded list only when projects.json was really read", async () => {
    const readHome = await homeWith([]);
    const setAsideHome = await mkdtemp(join(tmpdir(), "satellite-project-list-"));
    await writeFile(join(setAsideHome, "projects.json"), "{ not json");
    const missingHome = await mkdtemp(join(tmpdir(), "satellite-project-list-"));
    const reported = async (home: string) => {
      const recorded = vi.fn<(projects: readonly StoredProject[]) => void>();
      const projects = createProjects({
        home,
        chooseFolder: () => Promise.resolve(undefined),
        window: () => undefined,
        stopSessions: () => Promise.resolve(),
        recorded,
      });
      await projects.handlers["projects.list"]({}, owner);
      return recorded.mock.calls.length;
    };
    expect(await reported(readHome)).toBe(1);
    expect(await reported(setAsideHome)).toBe(0);
    expect(await reported(missingHome)).toBe(0);
  });
});
