import { stat } from "node:fs/promises";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { BridgeFailure } from "../bridge/registry.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { answerWithin, folderReadMs } from "../projects/repository-check.ts";
import { isConfined } from "../workspaces/workspace-archive.ts";

const folderGone = "That folder is gone, so Claude Code can't start there.";

async function recordedFolder(store: ProjectStore, ref: WorkspaceRef) {
  const project = await store.project(ref.projectId);
  if (ref.workspace === "main") return { project, path: project.path, record: undefined };
  const record = project.workspaces.find((workspace) => workspace.id === ref.workspace);
  if (record === undefined) {
    throw new BridgeFailure("not-found", "That workspace is not in Satellite.");
  }
  if (store.busy.has(record.id)) {
    throw new BridgeFailure(
      "refused",
      "Satellite is archiving that workspace, so Claude Code can't start there.",
    );
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
  return found.record === undefined || isConfined(home, found.project, found.record);
}

export async function sessionFolder(
  home: string,
  store: ProjectStore,
  ref: WorkspaceRef,
): Promise<string> {
  const found = await recordedFolder(store, ref);
  if ((await answerWithin(isUsableFolder(home, found), folderReadMs)) !== true) {
    throw new BridgeFailure("not-found", folderGone);
  }
  const latest = await recordedFolder(store, ref);
  if (latest.path !== found.path) throw new BridgeFailure("not-found", folderGone);
  return found.path;
}
