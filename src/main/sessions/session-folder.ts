import { stat } from "node:fs/promises";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { BridgeFailure } from "../bridge/registry.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { answerWithin, folderReadMs } from "../projects/repository-check.ts";
import { isConfined } from "../workspaces/workspace-archive.ts";
import { isOutsideFolder, isOutsidePath } from "../workspaces/worktree-folders.ts";
import { sharesRepository } from "../workspaces/worktree-list.ts";

export interface FolderSentences {
  gone: string;
  archiving: string;
}

export const sessionSentences: FolderSentences = {
  gone: "That folder is gone, so Claude Code can't start there.",
  archiving: "Satellite is archiving that workspace, so Claude Code can't start there.",
};

async function recordedFolder(store: ProjectStore, ref: WorkspaceRef, archiving: string) {
  const project = await store.project(ref.projectId);
  if (ref.workspace === "main") return { project, path: project.path, record: undefined };
  const record = project.workspaces.find((workspace) => workspace.id === ref.workspace);
  if (record === undefined) {
    throw new BridgeFailure("not-found", "That workspace is not in Satellite.");
  }
  if (store.busy.has(record.id)) {
    throw new BridgeFailure("refused", archiving);
  }
  return { project, path: record.path, record };
}

async function isUsableFolder(
  home: string,
  found: Awaited<ReturnType<typeof recordedFolder>>,
): Promise<boolean> {
  const isFolder = await stat(found.path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
  if (!isFolder) return false;
  if (found.record === undefined) return true;
  if (!isOutsidePath(home, found.path)) return isConfined(home, found.project, found.record);
  return (
    (await isOutsideFolder(home, found.path)) &&
    (await sharesRepository(found.project.path, found.path))
  );
}

export async function sessionFolder(
  home: string,
  store: ProjectStore,
  ref: WorkspaceRef,
  sentences: FolderSentences = sessionSentences,
): Promise<string> {
  const found = await recordedFolder(store, ref, sentences.archiving);
  if ((await answerWithin(isUsableFolder(home, found), folderReadMs)) !== true) {
    throw new BridgeFailure("not-found", sentences.gone);
  }
  const latest = await recordedFolder(store, ref, sentences.archiving);
  if (latest.path !== found.path) throw new BridgeFailure("not-found", sentences.gone);
  return found.path;
}
