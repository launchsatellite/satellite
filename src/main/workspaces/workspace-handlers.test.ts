import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeEvents, type BridgeEventPayload } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeOwner } from "../bridge/registry.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import type { StoredProject, StoredWorkspace } from "../projects/projects-file.ts";
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
    const { handlers } = workspaceHandlers({ home: join(base, "home"), store });
    const create = handlers["workspaces.create"];
    const { owner } = recordingOwner();
    const [first, again] = await Promise.allSettled([
      create(request(projects[0]?.id ?? "", "same-one"), owner),
      create(request(projects[0]?.id ?? "", "same-two"), owner),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(again).toMatchObject({
      status: "rejected",
      reason: { code: "refused", message: "Satellite is already making a workspace in one." },
    });
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
    const { handlers } = workspaceHandlers({ home: join(base, "home"), store });
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
    const { handlers } = workspaceHandlers({ home: join(base, "home"), store });
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
    });
    const { owner } = recordingOwner();
    for (const answer of [
      handlers["workspaces.prepare"]({ projectId: project.id }, owner),
      handlers["workspaces.create"](request(project.id, "nowhere"), owner),
    ]) {
      await expect(answer).rejects.toMatchObject({
        code: "refused",
        message: "gone isn't available right now, so Satellite can't make a workspace in it.",
      });
    }
  });
});
