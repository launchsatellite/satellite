import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BrowserWindow } from "electron";
import type { ProjectView } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers } from "../bridge/registry.ts";
import { isDevicePath, isNetworkPath, samePath } from "../platform/paths.ts";
import { userHomeFolder } from "../platform/satellite-home.ts";
import {
  blankWorkspace,
  droppedSentences,
  readWorkspaces,
  type Adoption,
  type Drop,
} from "../workspaces/workspace-reads.ts";
import {
  createProjectsFile,
  projectLimit,
  workspaceLimit,
  type StoredProject,
  type StoredWorkspace,
} from "./projects-file.ts";
import { answerWithin, checkRepository, folderReadMs } from "./repository-check.ts";
import { createSlots, type Slot } from "./slots.ts";

type Missing = NonNullable<ProjectView["missing"]>;

interface ProjectsOptions {
  home: string;
  chooseFolder: (window: BrowserWindow | undefined) => Promise<string | undefined>;
  window: () => BrowserWindow | undefined;
  stopSessions: (folder: string) => Promise<void>;
  recorded: (projects: readonly StoredProject[]) => void;
}
interface ProjectAnswer {
  view: ProjectView;
  drops: Drop[];
  adoptions: Adoption[];
}
interface ProjectRead {
  checked: Promise<Missing | null>;
  answer: Promise<ProjectAnswer>;
}
export interface ProjectStore {
  list(): Promise<StoredProject[]>;
  project(projectId: string): Promise<StoredProject>;
  available(project: StoredProject): Promise<boolean>;
  addWorkspace(projectId: string, workspace: StoredWorkspace): Promise<void>;
  writable(): Promise<boolean>;
  removeWorkspace(projectId: string, workspaceId: string): Promise<void>;
  busy: Set<string>;
  creating: Set<string>;
}
export interface Projects {
  handlers: Pick<
    BridgeHandlers,
    "projects.list" | "projects.choose" | "projects.drop" | "projects.remove"
  >;
  store: ProjectStore;
  flush(): Promise<void>;
}

const projectReads = 8;
const statusSlots = 8;
const folderReadSlots = 2;
const workspaceReadMs = 15_000;
const saveBoundMs = 10_000;
const nameLimit = 255;
const droppedLimit = 20;
const saveFailure = "Satellite couldn't save the project list. Nothing changed.";
const workspaceSaveFailure = "Satellite couldn't save the workspace list. Nothing changed.";
const notInSatellite = "That project is not in Satellite.";
const newerFile =
  "Your projects were saved by a newer Satellite, so this one won't change them. Open that newer version to add or remove a project.";
const homeFolderWords = "your home folder";

let realHome: { home: string; forms: readonly string[] } | undefined;
const deviceDrop =
  "That's a Windows device path, not a folder. Drop the repository's folder instead.";
const networkDrop =
  "Network folders can't be dropped on Satellite. Use Add a project to choose this one.";

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

async function folderChecks(project: StoredProject, inSlot: Slot): Promise<Missing | null> {
  if (!(await isFolder(project.path, inSlot))) return "folder";
  if (!(await exists(join(project.path, ".git"), inSlot))) return "repository";
  return null;
}

function unread(project: StoredProject, missing: Missing | null): ProjectView {
  return {
    id: project.id,
    name: shownProjectName(project.path),
    parent: parentName(project.path),
    missing,
    workspaces: [
      blankWorkspace("main", null),
      ...project.workspaces.map((workspace) => blankWorkspace(workspace.id, workspace.name)),
    ],
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

function stillHas(name: string, count: number): string {
  return count === 1
    ? `${name} still has 1 workspace. Archive it first, then remove the project.`
    : `${name} still has ${String(count)} workspaces. Archive them first, then remove the project.`;
}

function realOrSame(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function homeForms(home: string): readonly string[] {
  if (realHome?.home !== home) {
    realHome = { home, forms: [home, realOrSame(home)] };
  }
  return realHome.forms;
}

function isHomeFolder(path: string, home: string): boolean {
  return homeForms(home).some((form) => samePath(path, form));
}

export function shownProjectName(path: string, home = userHomeFolder()): string {
  return isHomeFolder(path, home) ? homeFolderWords : projectName(path);
}

export function parentName(path: string, home = userHomeFolder()): string {
  const parent = dirname(path);
  return isHomeFolder(parent, home) ? homeFolderWords : projectName(parent);
}

export function projectName(path: string): string {
  return (basename(path) || path).slice(0, nameLimit);
}

export function workspaceLimitSentence(project: string): string {
  return `${project} has 20 workspaces, as many as Satellite holds. Archive one, then make this one.`;
}

export function createProjects({
  home,
  chooseFolder,
  window,
  stopSessions,
  recorded,
}: ProjectsOptions): Projects {
  const file = createProjectsFile(home);
  let projects: StoredProject[] | undefined;
  let noticeGiven = false;
  let choosing = false;
  let adding = false;
  let changing: Promise<unknown> = Promise.resolve();
  let listing:
    | { list: StoredProject[]; answer: Promise<{ projects: ProjectView[]; dropped: string[] }> }
    | undefined;
  const pendingReads = new Map<string, ProjectRead>();
  const inHungSlot = createSlots(folderReadSlots);
  const inStatusSlot = createSlots(statusSlots);
  const timedOut = new Set<string>();
  const busy = new Set<string>();
  const creating = new Set<string>();
  const startRead = (project: StoredProject): ProjectRead => {
    const checked = folderChecks(project, timedOut.has(project.id) ? inHungSlot : direct);
    const answer = checked.then(async (missing): Promise<ProjectAnswer> => {
      if (missing !== null) return { view: unread(project, missing), drops: [], adoptions: [] };
      const name = projectName(project.path);
      const read = await readWorkspaces(project, name, busy, inStatusSlot, {
        home,
        blocked: () => creating.has(project.id),
      });
      return {
        view: { ...unread(project, null), workspaces: read.workspaces },
        drops: read.drops,
        adoptions: read.adoptions,
      };
    });
    const read = { checked, answer };
    pendingReads.set(project.id, read);
    const settle = () => {
      if (pendingReads.get(project.id) === read) pendingReads.delete(project.id);
    };
    answer.then(settle, settle);
    return read;
  };
  const checkedWithin = async (project: StoredProject) => {
    const read = pendingReads.get(project.id) ?? startRead(project);
    const checked = await answerWithin(read.checked, folderReadMs);
    if (checked === "late") timedOut.add(project.id);
    else timedOut.delete(project.id);
    return { read, checked };
  };
  const projectAnswer = async (project: StoredProject): Promise<ProjectAnswer> => {
    const { read, checked } = await checkedWithin(project);
    if (checked === "late") return { view: unread(project, "folder"), drops: [], adoptions: [] };
    const answer = await answerWithin(read.answer, workspaceReadMs);
    return answer === "late"
      ? { view: unread(project, checked), drops: [], adoptions: [] }
      : answer;
  };
  const current = async () => {
    const loaded = await file.load();
    if (projects === undefined) {
      projects = [...loaded.projects];
      if (loaded.read) recorded(projects);
    }
    return projects;
  };
  const replace = (
    change: (list: StoredProject[]) => StoredProject[],
    failure: string = saveFailure,
  ) => {
    const run = changing.then(async () => {
      const list = await current();
      if ((await file.load()).newer) throw new BridgeFailure("refused", newerFile);
      projects = change(list);
      try {
        if ((await answerWithin(file.save(projects), saveBoundMs)) === "late") {
          file.save(list).catch(() => undefined);
          throw new Error(`projects.json took longer than ${String(saveBoundMs)} ms to save`);
        }
      } catch (error) {
        projects = list;
        console.error("Satellite could not write projects.json", error);
        throw new BridgeFailure("failed", failure);
      }
      if ((await file.load()).read) recorded(projects);
    });
    changing = run.catch(() => undefined);
    return run;
  };
  const changeWorkspaces = (
    projectId: string,
    change: (project: StoredProject) => StoredWorkspace[],
  ) =>
    replace(
      (latest) =>
        latest.map((project) =>
          project.id === projectId ? { ...project, workspaces: change(project) } : project,
        ),
      workspaceSaveFailure,
    );
  const forget = async (drops: readonly Drop[]): Promise<Drop[]> => {
    if (drops.length === 0 || !(await file.load()).writable) return [];
    let forgotten: Drop[] = [];
    let folders: string[] = [];
    try {
      await replace((latest) => {
        const stored = new Set(
          latest.flatMap((project) => project.workspaces.map((workspace) => workspace.id)),
        );
        forgotten = drops.filter(
          (drop) => stored.has(drop.workspaceId) && !busy.has(drop.workspaceId),
        );
        const ids = new Set(forgotten.map((drop) => drop.workspaceId));
        folders = latest.flatMap((project) =>
          project.workspaces.filter((workspace) => ids.has(workspace.id)).map(({ path }) => path),
        );
        return latest.map((project) => ({
          ...project,
          workspaces: project.workspaces.filter((workspace) => !ids.has(workspace.id)),
        }));
      });
    } catch {
      return [];
    }
    for (const folder of folders) {
      stopSessions(folder).catch((error: unknown) => {
        console.error("The sessions of a dropped workspace could not be stopped", error);
      });
    }
    return forgotten;
  };
  const adopt = async (adoptions: readonly Adoption[]): Promise<Set<string>> => {
    const kept = new Set<string>();
    if (adoptions.length === 0 || !(await file.load()).writable) return kept;
    try {
      await replace((latest) => {
        kept.clear();
        const paths = latest.flatMap((project) => [
          project.path,
          ...project.workspaces.map((workspace) => workspace.path),
        ]);
        const isNew = (path: string) => {
          if (paths.some((known) => samePath(known, path))) return false;
          paths.push(path);
          return true;
        };
        return latest.map((project) => {
          if (creating.has(project.id)) return project;
          const added = adoptions
            .filter(({ projectId, workspace }) => projectId === project.id && isNew(workspace.path))
            .slice(0, Math.max(0, workspaceLimit - project.workspaces.length))
            .map(({ workspace }) => workspace);
          for (const workspace of added) kept.add(workspace.id);
          return added.length === 0
            ? project
            : { ...project, workspaces: [...project.workspaces, ...added] };
        });
      });
    } catch {
      kept.clear();
    }
    return kept;
  };
  const listAll = async (list: readonly StoredProject[]) => {
    const answers = await inBatches(list, projectReads, projectAnswer);
    const forgotten = await forget(answers.flatMap((answer) => answer.drops));
    const adoptions = answers.flatMap((answer) => answer.adoptions);
    const adopted = await adopt(adoptions);
    const ids = new Set([
      ...forgotten.map((drop) => drop.workspaceId),
      ...adoptions.map(({ workspace }) => workspace.id).filter((id) => !adopted.has(id)),
    ]);
    return {
      projects: answers.map(({ view }) => ({
        ...view,
        workspaces: view.workspaces.filter((workspace) => !ids.has(workspace.key)),
      })),
      dropped: droppedSentences(forgotten).slice(0, droppedLimit),
    };
  };
  const refuseWhileCreating = (project: StoredProject) => {
    if (!creating.has(project.id)) return;
    throw new BridgeFailure(
      "refused",
      `Satellite is still making a workspace in ${projectName(project.path)}. Try again when it's done.`,
    );
  };
  const store: ProjectStore = {
    busy,
    creating,
    available: async (project) => (await checkedWithin(project)).checked === null,
    writable: async () => (await file.load()).writable,
    list: current,
    async project(projectId) {
      const found = (await current()).find((project) => project.id === projectId);
      if (found === undefined) throw new BridgeFailure("not-found", notInSatellite);
      return found;
    },
    async addWorkspace(projectId, workspace) {
      await store.project(projectId);
      await replace((latest) => {
        if (latest.some((project) => samePath(project.path, workspace.path))) {
          throw new BridgeFailure("failed", workspaceSaveFailure);
        }
        const withoutStale = latest.map((project) => ({
          ...project,
          workspaces: project.workspaces.filter((stored) => !samePath(stored.path, workspace.path)),
        }));
        return withoutStale.map((project) => {
          if (project.id !== projectId) return project;
          if (project.workspaces.length >= workspaceLimit) {
            throw new BridgeFailure("limit", workspaceLimitSentence(projectName(project.path)));
          }
          return { ...project, workspaces: [...project.workspaces, workspace] };
        });
      }, workspaceSaveFailure);
    },
    removeWorkspace: (projectId, workspaceId) =>
      changeWorkspaces(projectId, (project) =>
        project.workspaces.filter((workspace) => workspace.id !== workspaceId),
      ),
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
    const project = { id: randomUUID(), path: checked.root, workspaces: [] };
    await replace((latest) => [...latest, project]);
    return (await projectAnswer(project)).view;
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
    store,
    handlers: {
      "projects.list": async () => {
        const list = await current();
        const { notice } = await file.load();
        const shown = noticeGiven ? null : notice;
        noticeGiven = true;
        if (listing?.list !== list) {
          const answer = listAll(list).finally(() => {
            if (listing?.answer === answer) listing = undefined;
          });
          listing = { list, answer };
        }
        return { ...(await listing.answer), notice: shown };
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
        if (removed === undefined) throw new BridgeFailure("not-found", notInSatellite);
        refuseWhileCreating(removed);
        const count = removed.workspaces.length;
        if (count > 0 && (await checkedWithin(removed)).checked === null) {
          throw new BridgeFailure("refused", stillHas(projectName(removed.path), count));
        }
        let forgotWorkspaces = 0;
        let forgotten: string[] = [];
        await replace((latest) => {
          const project = latest.find((candidate) => candidate.id === projectId);
          if (project !== undefined) {
            refuseWhileCreating(project);
            if (project.workspaces.length > count) {
              throw new BridgeFailure(
                "refused",
                stillHas(projectName(project.path), project.workspaces.length),
              );
            }
            forgotWorkspaces = project.workspaces.length;
            forgotten = [project.path, ...project.workspaces.map((workspace) => workspace.path)];
          }
          return latest.filter((candidate) => candidate.id !== projectId);
        });
        await Promise.all(forgotten.map(stopSessions));
        return { forgotWorkspaces };
      },
    },
  };
}
