import { lstat, stat } from "node:fs/promises";
import { join } from "node:path";
import type { StartChoice } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers, type BridgeOwner } from "../bridge/registry.ts";
import {
  projectName,
  workspaceLimitSentence,
  type ProjectStore,
} from "../projects/project-list.ts";
import {
  workspaceLimit,
  type StoredProject,
  type StoredWorkspace,
} from "../projects/projects-file.ts";
import { answerWithin, folderReadMs } from "../projects/repository-check.ts";
import { creationSteps, failureSentence, nameTaken, prepareWorkspace } from "./create-steps.ts";
import { runCreation, type StepReport } from "./workspace-creation.ts";

interface CreationRequest {
  operationId: string;
  name: string;
  start: StartChoice;
}
interface WorkspaceOptions {
  home: string;
  store: ProjectStore;
}
export interface Workspaces {
  handlers: Pick<BridgeHandlers, "workspaces.prepare" | "workspaces.create">;
  stopAll(): Promise<void>;
}

const creationsAtOnce = 4;
const creationStopMs = 20_000;

const detailLimit = 300;

async function isRepositoryFolder(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isDirectory()) return false;
    await lstat(join(path, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function availableName(project: StoredProject): Promise<string> {
  const name = projectName(project.path);
  if ((await answerWithin(isRepositoryFolder(project.path), folderReadMs)) !== true) {
    throw new BridgeFailure(
      "refused",
      `${name} isn't available right now, so Satellite can't make a workspace in it.`,
    );
  }
  return name;
}

function clipped(detail: string | null): string | null {
  if (detail === null || detail.length <= detailLimit) return detail;
  return `${detail.slice(0, detailLimit - 1)}…`;
}

export function workspaceHandlers({ home, store }: WorkspaceOptions): Workspaces {
  const quitting = new AbortController();
  const running = new Set<Promise<unknown>>();
  const create = async (
    project: StoredProject,
    projectLabel: string,
    request: CreationRequest,
    owner: BridgeOwner,
  ) => {
    const { operationId, name, start } = request;
    const taken = await nameTaken(home, project.path, name, projectLabel);
    if (taken !== null) throw new BridgeFailure("refused", taken);
    let made: StoredWorkspace | undefined;
    const steps = creationSteps({
      home,
      root: project.path,
      project: projectLabel,
      name,
      start,
      signal: quitting.signal,
      save: async (workspace) => {
        await store.addWorkspace(project.id, workspace);
        made = workspace;
      },
    });
    const report = ({ step, state, detail }: StepReport) => {
      owner.emit("workspaces.step", { operationId, step, state, detail: clipped(detail) });
    };
    const result = await runCreation(steps, report);
    if (!result.ok) {
      const refused =
        result.step === "start" ||
        (result.step === "branch" && result.sentence.endsWith(" Pick another name."));
      throw new BridgeFailure(
        refused ? "refused" : "failed",
        failureSentence(result, name, projectLabel),
      );
    }
    if (made === undefined) throw new Error("a finished creation saved no workspace");
    return {
      workspace: {
        key: made.id,
        name: made.name,
        branch: made.branch,
        ahead: null,
        behind: null,
        changed: null,
      },
    };
  };
  return {
    async stopAll() {
      quitting.abort();
      await answerWithin(Promise.allSettled([...running]), creationStopMs);
    },
    handlers: {
      "workspaces.prepare": async ({ projectId }) => {
        const project = await store.project(projectId);
        await availableName(project);
        return prepareWorkspace(project.path, home);
      },
      "workspaces.create": async ({ operationId, projectId, name, start }, owner) => {
        const project = await store.project(projectId);
        const projectLabel = await availableName(project);
        if (store.creating.has(projectId)) {
          throw new BridgeFailure(
            "refused",
            `Satellite is already making a workspace in ${projectLabel}.`,
          );
        }
        if (store.creating.size >= creationsAtOnce) {
          throw new BridgeFailure(
            "refused",
            "Satellite is making four workspaces already. Try again when one is done.",
          );
        }
        if (project.workspaces.length >= workspaceLimit) {
          throw new BridgeFailure("limit", workspaceLimitSentence(projectLabel));
        }
        store.creating.add(projectId);
        const work = create(project, projectLabel, { operationId, name, start }, owner);
        running.add(work);
        const settle = () => {
          running.delete(work);
          store.creating.delete(projectId);
        };
        work.then(settle, settle);
        return work;
      },
    },
  };
}
