import { randomUUID } from "node:crypto";
import { lstat, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BrowserWindow } from "electron";
import type { ProjectView } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers } from "../bridge/registry.ts";
import { samePath } from "../platform/paths.ts";
import { createProjectsFile, projectLimit, type StoredProject } from "./projects-file.ts";
import { checkRepository, folderReadMs } from "./repository-check.ts";
import { mainWorkspace } from "./workspaces.ts";

type Missing = NonNullable<ProjectView["missing"]>;

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

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
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

async function readProject(project: StoredProject): Promise<ProjectView> {
  if (!(await isFolder(project.path))) return unavailable(project);
  if (!(await exists(join(project.path, ".git")))) return unavailable(project, "repository");
  return {
    ...unavailable(project),
    missing: null,
    workspaces: [await mainWorkspace(project.path)],
  };
}

async function boundedView(
  project: StoredProject,
  read: Promise<ProjectView>,
): Promise<ProjectView> {
  const controller = new AbortController();
  const expired = delay(folderReadMs, undefined, { signal: controller.signal }).then(
    () => unavailable(project),
    () => unavailable(project),
  );
  try {
    return await Promise.race([read, expired]);
  } finally {
    controller.abort();
  }
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
  const projectView = (project: StoredProject) => {
    let read = pendingReads.get(project.id);
    if (read === undefined) {
      read = readProject(project).finally(() => {
        pendingReads.delete(project.id);
      });
      pendingReads.set(project.id, read);
    }
    return boundedView(project, read);
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
        await file.save(projects);
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
      "projects.drop": async ({ path }) => ({ project: await addOne(path) }),
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
