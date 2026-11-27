import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { ProjectStore } from "../projects/project-list.ts";
import type { StoredProject } from "../projects/projects-file.ts";
import { sessionFolder } from "./session-folder.ts";

const run = promisify(execFile);
const projectId = "0b9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e";
const workspaceId = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const gone = {
  code: "not-found",
  message: "That folder is gone, so Claude Code can't start there.",
};

async function setUp() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-session-folder-")));
  const home = join(base, "home");
  const repo = join(base, "repo");
  const worktree = join(home, "worktrees", "repo", "fix");
  await mkdir(repo);
  await mkdir(worktree, { recursive: true });
  return { base, home, repo, worktree };
}

function storeOf(...answers: StoredProject[]): ProjectStore {
  let calls = 0;
  return {
    list: () => Promise.resolve(answers),
    project: () => {
      const answer = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      return answer === undefined
        ? Promise.reject(new Error("no project"))
        : Promise.resolve(answer);
    },
    available: () => Promise.resolve(true),
    addWorkspace: () => Promise.resolve(),
    writable: () => Promise.resolve(true),
    removeWorkspace: () => Promise.resolve(),
    busy: new Set(),
    creating: new Set(),
  };
}

function project(repo: string, workspacePath: string): StoredProject {
  return {
    id: projectId,
    path: repo,
    workspaces: [{ id: workspaceId, name: "fix", path: workspacePath, branch: "fix" }],
  };
}

describe("sessionFolder", () => {
  it("answers the project's folder for main and the recorded worktree for a workspace", async () => {
    const { home, repo, worktree } = await setUp();
    const store = storeOf(project(repo, worktree));
    expect(await sessionFolder(home, store, { projectId, workspace: "main" })).toBe(repo);
    expect(await sessionFolder(home, store, { projectId, workspace: workspaceId })).toBe(worktree);
  });

  it("refuses a workspace that is not recorded or is being archived", async () => {
    const { home, repo, worktree } = await setUp();
    const store = storeOf(project(repo, worktree));
    await expect(
      sessionFolder(home, store, { projectId, workspace: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a" }),
    ).rejects.toMatchObject({ code: "not-found" });
    store.busy.add(workspaceId);
    await expect(
      sessionFolder(home, store, { projectId, workspace: workspaceId }),
    ).rejects.toMatchObject({ code: "refused" });
  });

  it("refuses a workspace folder outside the worktrees folder or reached through a link", async () => {
    const { base, home, repo, worktree } = await setUp();
    const outside = join(base, "outside");
    await mkdir(outside);
    const linked = join(home, "worktrees", "repo", "linked");
    await symlink(worktree, linked, "junction");
    for (const path of [outside, linked, join(home, "worktrees", "repo", "missing")]) {
      await expect(
        sessionFolder(home, storeOf(project(repo, path)), { projectId, workspace: workspaceId }),
      ).rejects.toMatchObject(gone);
    }
  });

  it("refuses a folder whose record changed while it was checked", async () => {
    const { home, repo, worktree } = await setUp();
    const other = join(home, "worktrees", "repo", "other");
    await mkdir(other);
    const store = storeOf(project(repo, worktree), project(repo, other));
    await expect(
      sessionFolder(home, store, { projectId, workspace: workspaceId }),
    ).rejects.toMatchObject(gone);
  });

  it("answers a worktree an agent made outside the Satellite home, only of this repository", async () => {
    const { base, home, repo } = await setUp();
    await mkdir(home, { recursive: true });
    const config = join(base, "gitconfig");
    await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
    );
    const git = (folder: string, args: string[]) =>
      run("git", ["-C", folder, ...args], {
        env: { ...env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" },
      });
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["commit", "-q", "--allow-empty", "-m", "one"]);
    const agent = join(repo, ".claude", "worktrees", "agent");
    await git(repo, ["worktree", "add", "-q", "-b", "agent", agent]);
    const other = join(base, "other");
    await mkdir(other);
    await git(other, ["init", "-q", "-b", "main"]);
    const ref = { projectId, workspace: workspaceId };
    expect(await sessionFolder(home, storeOf(project(repo, agent)), ref)).toBe(agent);
    await expect(sessionFolder(home, storeOf(project(repo, other)), ref)).rejects.toMatchObject(
      gone,
    );
  });
});
