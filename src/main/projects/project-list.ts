import { randomUUID } from "node:crypto";
import { lstat, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BrowserWindow } from "electron";
import type { ProjectView } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers } from "../bridge/registry.ts";
import { isDevicePath, isNetworkPath, samePath } from "../platform/paths.ts";
import { createProjectsFile, projectLimit, type StoredProject } from "./projects-file.ts";
import { answerWithin, checkRepository, folderReadMs } from "./repository-check.ts";
import { mainWorkspace } from "./workspaces.ts";

type Missing = NonNullable<ProjectView["missing"]>;
type Slot = <T>(work: () => Promise<T>) => Promise<T>;

interface ProjectsOptions {
  home: string;
  chooseFolder: (window: BrowserWindow | undefined) => Promise<string | undefined>;
  window: () => BrowserWindow | undefined;
}
export interface Projects {
  handlers: Pick<
    BridgeHandlers,
    "projects.list" | "projects.choose" | "projects.drop" | "projects.remove"
  >;
  flush(): Promise<void>;
}

const branchReads = 8;
const folderReadSlots = 2;
const saveBoundMs = 10_000;
const nameLimit = 255;
const saveFailure = "Satellite couldn't save the project list. Nothing changed.";
const deviceDrop =
  "That's a Windows device path, not a folder. Drop the repository's folder instead.";
const networkDrop =
  "Network folders can't be dropped on Satellite. Use Add a project to choose this one.";

function projectName(path: string): string {
  return (basename(path) || path).slice(0, nameLimit);
}

function createSlots(size: number): Slot {
  let free = size;
  const waiting: (() => void)[] = [];
  return async (work) => {
    if (free > 0) free -= 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next === undefined) free += 1;
      else next();
    }
  };
}

async function isFolder(path: string, inSlot: Slot): Promise<boolean> {
  return inSlot(() => stat(path)).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
}

async function exists(path: string, inSlot: Slot): Promise<boolean> {
  return inSlot(() => lstat(path)).then(
    () => true,
    () => false,
  );
}

function unavailable(project: StoredProject, missing: Missing = "folder"): ProjectView {
  return {
    id: project.id,
    name: projectName(project.path),
    parent: projectName(dirname(project.path)),
    missing,
    workspaces: [{ key: "main", branch: null }],
  };
}

async function readProject(project: StoredProject, inSlot: Slot): Promise<ProjectView> {
  if (!(await isFolder(project.path, inSlot))) return unavailable(project);
  if (!(await exists(join(project.path, ".git"), inSlot))) {
    return unavailable(project, "repository");
  }
  return {
    ...unavailable(project),
    missing: null,
    workspaces: [await mainWorkspace(project.path)],
  };
}

function direct<T>(work: () => Promise<T>): Promise<T> {
  return work();
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
  let adding = false;
  let changing: Promise<unknown> = Promise.resolve();
  let listing: { list: StoredProject[]; views: Promise<ProjectView[]> } | undefined;
  const pendingReads = new Map<string, Promise<ProjectView>>();
  const inHungSlot = createSlots(folderReadSlots);
  const timedOut = new Set<string>();
  const projectView = async (project: StoredProject) => {
    let read = pendingReads.get(project.id);
    if (read === undefined) {
      const inSlot = timedOut.has(project.id) ? inHungSlot : direct;
      read = readProject(project, inSlot).finally(() => {
        pendingReads.delete(project.id);
      });
      pendingReads.set(project.id, read);
    }
    const answer = await answerWithin(read, folderReadMs);
    if (answer === "late") {
      timedOut.add(project.id);
      return unavailable(project);
    }
    timedOut.delete(project.id);
    return answer;
  };
  const current = async () => {
    const loaded = await file.load();
    projects ??= [...loaded.projects];
    return projects;
  };
  const replace = (change: (list: StoredProject[]) => StoredProject[]) => {
    const run = changing.then(async () => {
      const list = await current();
      projects = change(list);
      try {
        if ((await answerWithin(file.save(projects), saveBoundMs)) === "late") {
          throw new Error(`projects.json took longer than ${String(saveBoundMs)} ms to save`);
        }
      } catch (error) {
        projects = list;
        console.error("Satellite could not write projects.json", error);
        throw new BridgeFailure("failed", saveFailure);
      }
    });
    changing = run.catch(() => undefined);
    return run;
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
    await replace((latest) => [...latest, project]);
    return projectView(project);
  };
  const addOne = async (folder: string) => {
    if (adding) throw new BridgeFailure("refused", "Satellite is still adding the last folder.");
    adding = true;
    try {
      return await add(folder);
    } finally {
      adding = false;
    }
  };
  return {
    flush: () => file.flush(),
    handlers: {
      "projects.list": async () => {
        const list = await current();
        const { notice } = await file.load();
        const shown = noticeGiven ? null : notice;
        noticeGiven = true;
        if (listing?.list !== list) {
          const views = inBatches(list, branchReads, projectView).finally(() => {
            if (listing?.views === views) listing = undefined;
          });
          listing = { list, views };
        }
        return { projects: await listing.views, notice: shown };
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
        return { outcome: "added", project: await addOne(folder) };
      },
      "projects.drop": async ({ path }) => {
        if (isDevicePath(path)) throw new BridgeFailure("refused", deviceDrop);
        if (isNetworkPath(path)) throw new BridgeFailure("refused", networkDrop);
        return { project: await addOne(path) };
      },
      "projects.remove": async ({ projectId }) => {
        const list = await current();
        const removed = list.find((project) => project.id === projectId);
        if (removed === undefined) {
          throw new BridgeFailure("not-found", "That project is not in Satellite.");
        }
        await replace((latest) => latest.filter((project) => project.id !== projectId));
        return {};
      },
    },
  };
}
