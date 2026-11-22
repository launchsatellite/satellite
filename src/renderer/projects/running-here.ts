import type { ProjectView, SessionStatus, WorkspaceRef } from "../../shared/bridge-contract.ts";

export interface RunningHere {
  sessions: number;
  processes: number;
}

export function runningHere(
  project: Pick<ProjectView, "id" | "workspaces">,
  tabs: readonly { workspace: WorkspaceRef; status: SessionStatus }[],
  processesOf: (ref: WorkspaceRef) => number,
): RunningHere {
  return {
    sessions: tabs.filter(
      (tab) => tab.workspace.projectId === project.id && tab.status !== "stopped",
    ).length,
    processes: project.workspaces.reduce(
      (total, { key }) => total + processesOf({ projectId: project.id, workspace: key }),
      0,
    ),
  };
}
