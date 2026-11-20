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
import { answerWithin } from "../projects/repository-check.ts";
import type { WorkspaceSessions } from "../terminal/terminal-sessions.ts";
import { creationSteps, failureSentence, nameTaken, prepareWorkspace } from "./create-steps.ts";
import { archiveWorkspace, inspectWorkspace } from "./workspace-archive.ts";
import { runCreation, type StepReport } from "./workspace-creation.ts";

interface CreationRequest {
  operationId: string;
  name: string;
  start: StartChoice;
}
interface Creation {
  projectId: string;
  ownerId: number;
  stop: AbortController;
}
interface WorkspaceOptions {
  home: string;
  store: ProjectStore;
  sessions: WorkspaceSessions;
}
export interface Workspaces {
  handlers: Pick<
    BridgeHandlers,
    | "workspaces.prepare"
    | "workspaces.create"
    | "workspaces.cancel"
    | "workspaces.inspect"
    | "workspaces.archive"
  >;
  stopAll(): Promise<void>;
}

const creationsAtOnce = 4;
const creationStopMs = 20_000;

const detailLimit = 300;
const canceledSentence = "You stopped making the workspace.";

function unavailable(name: string): BridgeFailure {
  return new BridgeFailure(
    "refused",
    `${name} isn't available right now, so Satellite can't make a workspace in it.`,
  );
}

async function recordOf(store: ProjectStore, projectId: string, workspaceId: string) {
  const project = await store.project(projectId);
  const record = project.workspaces.find((workspace) => workspace.id === workspaceId);
  if (record === undefined) {
    throw new BridgeFailure("not-found", "That workspace is not in Satellite.");
  }
  return { project, record };
}

function clipped(detail: string | null): string | null {
  if (detail === null || detail.length <= detailLimit) return detail;
  return `${detail.slice(0, detailLimit - 1)}…`;
}

export function workspaceHandlers({ home, store, sessions }: WorkspaceOptions): Workspaces {
  const quitting = new AbortController();
  const availableName = async (project: StoredProject) => {
    const name = projectName(project.path);
    if (!(await store.available(project))) throw unavailable(name);
    return name;
  };
  const running = new Set<Promise<unknown>>();
  const creations = new Map<string, Creation>();
  const track = <T>(work: Promise<T>, settled: () => void): Promise<T> => {
    running.add(work);
    const settle = () => {
      running.delete(work);
      settled();
    };
    work.then(settle, settle);
    return work;
  };
  const archive = async (projectId: string, workspaceId: string, fingerprint: string) => {
    const { project, record } = await recordOf(store, projectId, workspaceId);
    const result = await archiveWorkspace(home, project, record, fingerprint, sessions);
    try {
      await store.removeWorkspace(project.id, record.id);
    } catch {
      throw new BridgeFailure(
        "failed",
        `git removed ${record.name}, but Satellite couldn't update its list. The next list drops it.`,
      );
    }
    return result;
  };
  const create = async (
    project: StoredProject,
    projectLabel: string,
    request: CreationRequest,
    owner: BridgeOwner,
    signal: AbortSignal,
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
      signal,
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
        if (creations.has(operationId)) {
          throw new BridgeFailure("refused", "That creation is already running.");
        }
        store.creating.add(projectId);
        const stop = new AbortController();
        creations.set(operationId, { projectId, ownerId: owner.id, stop });
        const signal = AbortSignal.any([quitting.signal, stop.signal]);
        const work = create(project, projectLabel, { operationId, name, start }, owner, signal);
        return track(work, () => {
          store.creating.delete(projectId);
          creations.delete(operationId);
        });
      },
      "workspaces.cancel": async ({ operationId, projectId }, owner) => {
        await store.project(projectId);
        const creation = creations.get(operationId);
        if (creation?.projectId !== projectId || creation.ownerId !== owner.id) {
          return { canceled: false };
        }
        creation.stop.abort(canceledSentence);
        return { canceled: true };
      },
      "workspaces.inspect": async ({ projectId, workspaceId }) => {
        const { project, record } = await recordOf(store, projectId, workspaceId);
        return inspectWorkspace(home, project, record, sessions.countInside(record.path));
      },
      "workspaces.archive": ({ projectId, workspaceId, fingerprint }) => {
        if (quitting.signal.aborted) {
          return Promise.reject(new BridgeFailure("failed", "Satellite is quitting."));
        }
        if (store.busy.has(workspaceId)) {
          return Promise.reject(
            new BridgeFailure("refused", "Satellite is already archiving that workspace."),
          );
        }
        store.busy.add(workspaceId);
        return track(archive(projectId, workspaceId, fingerprint), () => {
          store.busy.delete(workspaceId);
        });
      },
    },
  };
}
