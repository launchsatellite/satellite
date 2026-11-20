import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeEvents, type BridgeEventPayload } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeOwner } from "../bridge/registry.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import type { StoredProject, StoredWorkspace } from "../projects/projects-file.ts";
import type { WorkspaceSessions } from "../terminal/terminal-sessions.ts";
import { workspaceHandlers } from "./workspace-handlers.ts";

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
const noSessions: WorkspaceSessions = {
  countInside: () => 0,
  stopInside: () => Promise.resolve(),
};

let base = "";
let config = "";

function gitEnvironment(): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  return { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
}

async function repository(name: string): Promise<StoredProject> {
  const path = join(base, name);
  const env = gitEnvironment();
  await run("git", ["init", "-q", "-b", "main", path], { env });
  await writeFile(join(path, "a"), "a\n");
  await run("git", ["-C", path, "add", "-A"], { env });
  await run("git", ["-C", path, "commit", "-q", "-m", "first"], { env });
  return { id: randomUUID(), path, workspaces: [] };
}

function fakeStore(projects: StoredProject[]): ProjectStore {
  return {
    busy: new Set(),
    available: (project) =>
      stat(project.path).then(
        (info) => info.isDirectory(),
        () => false,
      ),
    creating: new Set(),
    project(projectId) {
      const found = projects.find((project) => project.id === projectId);
      if (found === undefined) {
        return Promise.reject(new BridgeFailure("not-found", "That project is not in Satellite."));
      }
      return Promise.resolve(found);
    },
    addWorkspace(projectId, workspace: StoredWorkspace) {
      projects.find((project) => project.id === projectId)?.workspaces.push(workspace);
      return Promise.resolve();
    },
    removeWorkspace: () => Promise.resolve(),
    writable: () => Promise.resolve(true),
  };
}

function recordingOwner() {
  const events: BridgeEventPayload<"workspaces.step">[] = [];
  const owner: BridgeOwner = {
    id: 1,
    emit(event, payload) {
      expect(event).toBe("workspaces.step");
      events.push(bridgeEvents["workspaces.step"].parse(payload));
    },
    onGone: () => undefined,
  };
  return { owner, events };
}

function request(projectId: string, name: string) {
  return { operationId: randomUUID(), projectId, name, start: { kind: "default" as const } };
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "satellite-handlers-")));
  config = join(base, "gitconfig");
  await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
  await mkdir(join(base, "home"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", config);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("workspaceHandlers", () => {
  it("runs one creation per project and four at once, even when asked together", async () => {
    const projects = await Promise.all(
      ["one", "two", "three", "four", "five"].map((name) => repository(name)),
    );
    const store = fakeStore(projects);
    const { handlers } = workspaceHandlers({
      home: join(base, "home"),
      store,
      sessions: noSessions,
    });
    const create = handlers["workspaces.create"];
    const { owner } = recordingOwner();
    const same = await Promise.allSettled([
      create(request(projects[0]?.id ?? "", "same-one"), owner),
      create(request(projects[0]?.id ?? "", "same-two"), owner),
    ]);
    expect(same.filter((answer) => answer.status === "fulfilled")).toHaveLength(1);
    expect(same.filter((answer) => answer.status === "rejected")).toMatchObject([
      {
        reason: { code: "refused", message: "Satellite is already making a workspace in one." },
      },
    ]);
    const answers = await Promise.allSettled(
      projects.map((project) => create(request(project.id, "parallel"), owner)),
    );
    expect(answers.filter((answer) => answer.status === "fulfilled")).toHaveLength(4);
    expect(answers.filter((answer) => answer.status === "rejected")).toMatchObject([
      {
        reason: {
          code: "refused",
          message: "Satellite is making four workspaces already. Try again when one is done.",
        },
      },
    ]);
    expect(store.creating.size).toBe(0);
  });

  it("refuses a taken name before any step and a full project with the limit", async () => {
    const project = await repository("repo");
    await run("git", ["-C", project.path, "branch", "taken"], { env: gitEnvironment() });
    const store = fakeStore([project]);
    const { handlers } = workspaceHandlers({
      home: join(base, "home"),
      store,
      sessions: noSessions,
    });
    const { owner, events } = recordingOwner();
    await expect(
      handlers["workspaces.create"](request(project.id, "taken"), owner),
    ).rejects.toMatchObject({
      code: "refused",
      message: "A branch named taken already exists in repo. Pick another name.",
    });
    expect(events).toEqual([]);
    project.workspaces.push(
      ...Array.from({ length: 20 }, (_, index) => ({
        id: randomUUID(),
        name: `w${String(index)}`,
        path: join(base, "home", `w${String(index)}`),
        branch: `w${String(index)}`,
      })),
    );
    await expect(
      handlers["workspaces.create"](request(project.id, "extra"), owner),
    ).rejects.toMatchObject({
      code: "limit",
      message:
        "repo has 20 workspaces, as many as Satellite holds. Archive one, then make this one.",
    });
  });

  it("reports every step and answers the new workspace", async () => {
    const project = await repository("repo");
    const store = fakeStore([project]);
    const { handlers } = workspaceHandlers({
      home: join(base, "home"),
      store,
      sessions: noSessions,
    });
    const { owner, events } = recordingOwner();
    const answer = await handlers["workspaces.create"](request(project.id, "fresh"), owner);
    expect(answer.workspace).toEqual({
      key: project.workspaces[0]?.id,
      name: "fresh",
      branch: "fresh",
      ahead: null,
      behind: null,
      changed: null,
    });
    expect(events.map((event) => `${event.step} ${event.state}`)).toEqual([
      "start running",
      "start done",
      "branch running",
      "branch done",
      "worktree running",
      "worktree done",
      "files running",
      "files done",
      "save running",
      "save done",
    ]);
  });

  it("refuses a project whose folder is gone", async () => {
    const project = { id: randomUUID(), path: join(base, "gone"), workspaces: [] };
    const { handlers } = workspaceHandlers({
      home: join(base, "home"),
      store: fakeStore([project]),
      sessions: noSessions,
    });
    const { owner } = recordingOwner();
    for (const ask of [
      () => handlers["workspaces.prepare"]({ projectId: project.id }, owner),
      () => handlers["workspaces.create"](request(project.id, "nowhere"), owner),
    ]) {
      await expect(ask()).rejects.toMatchObject({
        code: "refused",
        message: "gone isn't available right now, so Satellite can't make a workspace in it.",
      });
    }
  });

  it("archives only a recorded workspace of the project named, and one at a time", async () => {
    const [mine, theirs] = await Promise.all([repository("mine"), repository("theirs")]);
    const record = {
      id: randomUUID(),
      name: "fix-login",
      path: join(base, "home", "worktrees", "mine", "fix-login"),
      branch: "fix-login",
    };
    mine.workspaces.push(record);
    const store = fakeStore([mine, theirs]);
    const { handlers } = workspaceHandlers({
      home: join(base, "home"),
      store,
      sessions: noSessions,
    });
    const { owner } = recordingOwner();
    const ask = { workspaceId: record.id, fingerprint: "0".repeat(64) };
    const notFound = { code: "not-found", message: "That workspace is not in Satellite." };
    await expect(
      handlers["workspaces.inspect"]({ projectId: theirs.id, workspaceId: record.id }, owner),
    ).rejects.toMatchObject(notFound);
    await expect(
      handlers["workspaces.archive"]({ projectId: theirs.id, ...ask }, owner),
    ).rejects.toMatchObject(notFound);
    store.busy.add(record.id);
    await expect(
      handlers["workspaces.archive"]({ projectId: mine.id, ...ask }, owner),
    ).rejects.toMatchObject({
      code: "refused",
      message: "Satellite is already archiving that workspace.",
    });
    expect(store.busy.has(record.id)).toBe(true);
  });
  it.skipIf(process.platform === "win32")(
    "stops only the creation the same page names and undoes it",
    async () => {
      const project = await repository("repo");
      const marker = join(base, "hook-started");
      const hook = join(project.path, ".git", "hooks", "post-checkout");
      await writeFile(hook, `#!/bin/sh\ntouch "${marker}"\nsleep 30\n`);
      await chmod(hook, 0o755);
      const store = fakeStore([project]);
      const { handlers } = workspaceHandlers({
        home: join(base, "home"),
        store,
        sessions: noSessions,
      });
      const { owner, events } = recordingOwner();
      const asked = request(project.id, "stopped");
      const work = handlers["workspaces.create"](asked, owner);
      work.catch(() => undefined);
      await vi.waitFor(() => stat(marker), { timeout: 15_000, interval: 50 });
      const cancel = handlers["workspaces.cancel"];
      const operationId = asked.operationId;
      await expect(cancel({ operationId, projectId: randomUUID() }, owner)).rejects.toMatchObject({
        code: "not-found",
      });
      expect(await cancel({ operationId: randomUUID(), projectId: project.id }, owner)).toEqual({
        canceled: false,
      });
      expect(await cancel({ operationId, projectId: project.id }, { ...owner, id: 2 })).toEqual({
        canceled: false,
      });
      expect(await cancel({ operationId, projectId: project.id }, owner)).toEqual({
        canceled: true,
      });
      await expect(work).rejects.toMatchObject({
        code: "failed",
        message:
          "You stopped making the workspace. Satellite removed what it had made, so nothing changed.",
      });
      expect(events.filter((event) => event.state === "undone").map((event) => event.step)).toEqual(
        ["worktree", "branch"],
      );
      const env = gitEnvironment();
      const branches = await run("git", ["-C", project.path, "branch", "--list", "stopped"], {
        env,
      });
      expect(branches.stdout).toBe("");
      const worktrees = await run("git", ["-C", project.path, "worktree", "list", "--porcelain"], {
        env,
      });
      expect(worktrees.stdout).not.toContain("stopped");
      await expect(stat(join(base, "home", "worktrees", "repo", "stopped"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(project.workspaces).toEqual([]);
      expect(await cancel({ operationId, projectId: project.id }, owner)).toEqual({
        canceled: false,
      });
    },
    30_000,
  );

  it("says git removed the worktree when the list can't be saved afterwards", async () => {
    const project = await repository("mine");
    const parent = join(base, "home", "worktrees", "mine");
    await mkdir(parent, { recursive: true });
    const path = join(parent, "saved-late");
    await run("git", ["-C", project.path, "worktree", "add", "-q", "-b", "saved-late", path], {
      env: gitEnvironment(),
    });
    const record = { id: randomUUID(), name: "saved-late", path, branch: "saved-late" };
    project.workspaces.push(record);
    const store = {
      ...fakeStore([project]),
      removeWorkspace: () => Promise.reject(new BridgeFailure("failed", "The disk said no.")),
    };
    const { handlers } = workspaceHandlers({
      home: join(base, "home"),
      store,
      sessions: noSessions,
    });
    const { owner } = recordingOwner();
    const ask = { projectId: project.id, workspaceId: record.id };
    const { fingerprint } = await handlers["workspaces.inspect"](ask, owner);
    await expect(
      handlers["workspaces.archive"]({ ...ask, fingerprint }, owner),
    ).rejects.toMatchObject({
      code: "failed",
      message:
        "git removed saved-late, but Satellite couldn't update its list. The next list drops it.",
    });
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(store.busy.has(record.id)).toBe(false);
  });

  it("refuses a creation while the project list can't be saved, before any step", async () => {
    const project = await repository("repo");
    const store = { ...fakeStore([project]), writable: () => Promise.resolve(false) };
    const { handlers } = workspaceHandlers({
      home: join(base, "home"),
      store,
      sessions: noSessions,
    });
    const { owner, events } = recordingOwner();
    await expect(
      handlers["workspaces.create"](request(project.id, "unsaved"), owner),
    ).rejects.toMatchObject({
      code: "failed",
      message:
        "Satellite can't save its project list right now, so it won't make a workspace. Restart Satellite, then try again.",
    });
    expect(events).toEqual([]);
    expect(store.creating.size).toBe(0);
  });

  it("answers false to a cancel that arrives once the workspace is being saved", async () => {
    const project = await repository("repo");
    const saving = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const plain = fakeStore([project]);
    const store = {
      ...plain,
      async addWorkspace(projectId: string, workspace: StoredWorkspace) {
        saving.resolve(undefined);
        await release.promise;
        await plain.addWorkspace(projectId, workspace);
      },
    };
    const { handlers } = workspaceHandlers({
      home: join(base, "home"),
      store,
      sessions: noSessions,
    });
    const { owner } = recordingOwner();
    const asked = request(project.id, "kept");
    const work = handlers["workspaces.create"](asked, owner);
    await saving.promise;
    expect(
      await handlers["workspaces.cancel"](
        { operationId: asked.operationId, projectId: project.id },
        owner,
      ),
    ).toEqual({ canceled: false });
    release.resolve(undefined);
    expect((await work).workspace.name).toBe("kept");
  });

  it("holds prepare, inspect and archive to four at once between them", async () => {
    const project = await repository("repo");
    const waiting = new Promise<StoredProject>(() => undefined);
    const store = { ...fakeStore([project]), project: () => waiting };
    const { handlers } = workspaceHandlers({
      home: join(base, "home"),
      store,
      sessions: noSessions,
    });
    const { owner } = recordingOwner();
    for (let index = 0; index < 4; index += 1) {
      void handlers["workspaces.prepare"]({ projectId: randomUUID() }, owner);
    }
    const busy = { code: "refused", message: "Satellite is checking other workspaces. Try again." };
    await expect(
      handlers["workspaces.prepare"]({ projectId: randomUUID() }, owner),
    ).rejects.toMatchObject(busy);
    const workspace = { projectId: project.id, workspaceId: randomUUID() };
    await expect(handlers["workspaces.inspect"](workspace, owner)).rejects.toMatchObject(busy);
    await expect(
      handlers["workspaces.archive"]({ ...workspace, fingerprint: "0".repeat(64) }, owner),
    ).rejects.toMatchObject(busy);
  });
});
