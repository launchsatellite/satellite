import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { BrowserWindow } from "electron";
import type { ProjectView } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers } from "../bridge/registry.ts";
import { samePath } from "../platform/paths.ts";
import { createProjectsFile, projectLimit, type StoredProject } from "./projects-file.ts";
import { checkRepository } from "./repository-check.ts";
import { mainWorkspace } from "./workspaces.ts";

interface ProjectsOptions {
  home: string;
  chooseFolder: (window: BrowserWindow | undefined) => Promise<string | undefined>;
  window: () => BrowserWindow | undefined;
}
export interface Projects {
  handlers: Pick<BridgeHandlers, "projects.list" | "projects.choose" | "projects.remove">;
  add(folder: string): Promise<ProjectView>;
  flush(): Promise<void>;
}

const branchReads = 8;
const nameLimit = 255;
const saveFailure = "Satellite couldn't save the project list. Nothing changed.";

function projectName(path: string): string {
  return (basename(path) || path).slice(0, nameLimit);
}

async function isFolder(path: string): Promise<boolean> {
  return stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
}

async function projectView(project: StoredProject): Promise<ProjectView> {
  const missing = !(await isFolder(project.path));
  return {
    id: project.id,
    name: projectName(project.path),
    missing,
    workspaces: [missing ? { key: "main", branch: null } : await mainWorkspace(project.path)],
  };
}

async function inBatches<T, R>(items: readonly T[], size: number, map: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(map))));
  }
  return results;
}

export function createProjects({ home, chooseFolder, window }: ProjectsOptions): Projects {
  const file = createProjectsFile(home);
  let projects: StoredProject[] | undefined;
  let noticeGiven = false;
  let choosing = false;
  const current = async () => {
    const loaded = await file.load();
    projects ??= [...loaded.projects];
    return projects;
  };
  const replace = async (next: StoredProject[], undo: () => StoredProject[]) => {
    projects = next;
    try {
      await file.save(next);
    } catch (error) {
      projects = undo();
      console.error("Satellite could not write projects.json", error);
      throw new BridgeFailure("failed", saveFailure);
    }
  };
  const add = async (folder: string) => {
    const checked = await checkRepository(folder, home);
    if (!checked.ok) throw new BridgeFailure("refused", checked.refusal);
    const list = await current();
    if (list.some((project) => samePath(project.path, checked.root))) {
      throw new BridgeFailure("refused", `${projectName(checked.root)} is already in Satellite.`);
    }
    if (list.length >= projectLimit) {
      throw new BridgeFailure(
        "limit",
        "Satellite holds up to 200 projects. Remove one, then add this one.",
      );
    }
    const project = { id: randomUUID(), path: checked.root };
    await replace([...list, project], () =>
      (projects ?? []).filter((candidate) => candidate.id !== project.id),
    );
    return projectView(project);
  };
  return {
    add,
    flush: () => file.flush(),
    handlers: {
      "projects.list": async () => {
        const list = await current();
        const { notice } = await file.load();
        const shown = noticeGiven ? null : notice;
        noticeGiven = true;
        return { projects: await inBatches(list, branchReads, projectView), notice: shown };
      },
      "projects.choose": async () => {
        if (choosing) throw new BridgeFailure("refused", "The folder dialog is already open.");
        choosing = true;
        let folder: string | undefined;
        try {
          folder = await chooseFolder(window());
        } finally {
          choosing = false;
        }
        if (folder === undefined) return { outcome: "canceled" };
        return { outcome: "added", project: await add(folder) };
      },
      "projects.remove": async ({ projectId }) => {
        const list = await current();
        const removed = list.find((project) => project.id === projectId);
        if (removed === undefined) {
          throw new BridgeFailure("not-found", "That project is not in Satellite.");
        }
        await replace(
          list.filter((project) => project !== removed),
          () => [...(projects ?? []), removed],
        );
        return {};
      },
    },
  };
}
