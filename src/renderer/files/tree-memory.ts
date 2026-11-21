import type { FolderListing, WorkspaceRef } from "../../shared/bridge-contract.ts";

interface TreeMemory {
  open: readonly string[];
  listings: ReadonlyMap<string, FolderListing>;
  scroll: number;
}

const remembered = 16;
const memories = new Map<string, TreeMemory>();

function keyOf({ projectId, workspace }: WorkspaceRef): string {
  return `${projectId}/${workspace}`;
}

export function recallTree(workspace: WorkspaceRef): TreeMemory {
  return memories.get(keyOf(workspace)) ?? { open: [""], listings: new Map(), scroll: 0 };
}

export function rememberTree(workspace: WorkspaceRef, patch: Partial<TreeMemory>): void {
  const key = keyOf(workspace);
  const current = recallTree(workspace);
  memories.delete(key);
  memories.set(key, { ...current, ...patch });
  for (const oldest of memories.keys()) {
    if (memories.size <= remembered) break;
    memories.delete(oldest);
  }
}
