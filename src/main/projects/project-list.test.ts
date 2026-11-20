import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BridgeOwner } from "../bridge/registry.ts";
import { createProjects } from "./project-list.ts";

const owner: BridgeOwner = { id: 1, emit: () => undefined, onGone: () => undefined };
const hung = vi.hoisted(() => ({ path: "", paths: new Set<string>(), calls: 0, writes: false }));
const git = vi.hoisted(() => ({ runs: 0, abandon: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => {
      const path = String(args[0]);
      if (path !== hung.path && !hung.paths.has(path)) return actual.stat(...args);
      hung.calls += 1;
      return new Promise<never>(() => undefined);
    },
    open: (...args: Parameters<typeof actual.open>) => {
      if (hung.writes && args[1] === "wx") return new Promise<never>(() => undefined);
      return actual.open(...args);
    },
  };
});

vi.mock("../platform/tools.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/tools.ts")>();
  return {
    ...actual,
    runTool: (...args: Parameters<typeof actual.runTool>) => {
      if (!git.abandon) return actual.runTool(...args);
      git.runs += 1;
      return Promise.reject(
        new actual.AbandonedRun("git did not finish in time", new Promise(() => undefined)),
      );
    },
  };
});

vi.mock("node:timers/promises", () => ({ setTimeout: () => Promise.resolve() }));

async function homeWith(paths: string[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "satellite-project-list-"));
  await writeFile(
    join(home, "projects.json"),
    JSON.stringify({ version: 1, projects: paths.map((path) => ({ id: randomUUID(), path })) }),
  );
  return home;
}

function projectsIn(home: string) {
  return createProjects({
    home,
    chooseFolder: () => Promise.resolve(undefined),
    window: () => undefined,
  });
}

describe("createProjects", () => {
  it("lets hung folders hold at most two file reads, whatever the list holds", async () => {
    const base = await mkdtemp(join(tmpdir(), "satellite-project-hung-"));
    const folders = ["a", "b", "c", "d", "e"].map((name) => join(base, name));
    hung.paths = new Set(folders.slice(0, 4));
    hung.calls = 0;
    const { handlers } = projectsIn(await homeWith(folders));
    const { projects } = await handlers["projects.list"]({}, owner);
    expect(projects.map((project) => project.missing)).toEqual(Array(5).fill("folder"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hung.calls).toBe(2);
    hung.paths = new Set();
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
});
