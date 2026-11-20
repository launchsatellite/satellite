import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectStore } from "../projects/project-list.ts";
import type { StoredProject } from "../projects/projects-file.ts";
import { sessionFolder } from "./session-folder.ts";

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
});
