import type { ProjectView, SessionStatus, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { repeatedNames, shownParent } from "../../shared/project-names.ts";
import { workspaceLabel } from "../projects/use-projects.ts";
import type { PixelState } from "../ui/status-pixel.tsx";
import { pixelOf } from "./session-pixel.ts";
import type { SessionTab } from "./use-sessions.ts";

export interface AgentItem {
  key: string;
  tab: string;
  terminalId: string;
  ref: WorkspaceRef;
  label: string;
  session: number | null;
  project: string;
  parent?: string;
  pixel: PixelState;
  state: string;
  testKey: string;
}

const order: readonly SessionStatus[] = ["needs-you", "working", "done", "idle", "stopped"];
const words: Record<SessionStatus, string> = {
  "needs-you": "Needs you",
  working: "Working",
  done: "Done",
  idle: "Idle",
  stopped: "Stopped",
};

export function agentList(
  tabs: readonly SessionTab[],
  projects: readonly ProjectView[],
): AgentItem[] {
  const repeated = repeatedNames(projects);
  const placed = projects.flatMap((project, projectAt) =>
    project.workspaces.flatMap((workspace, workspaceAt) => {
      const here = tabs.filter(
        (tab) =>
          tab.workspace.projectId === project.id && tab.workspace.workspace === workspace.key,
      );
      return here.map((tab) => ({
        tab,
        place: projectAt * 1000 + workspaceAt,
        item: {
          key: tab.key,
          tab: tab.key,
          terminalId: tab.terminalId,
          ref: tab.workspace,
          label: workspaceLabel(project, workspace),
          session: here.length > 1 ? tab.number : null,
          project: project.name,
          parent: shownParent(project, repeated),
          pixel: pixelOf(tab.status),
          state: words[tab.status],
          testKey: `${workspace.name ?? "main"}-${String(tab.number)}`,
        },
      }));
    }),
  );
  return placed
    .sort(
      (a, b) =>
        order.indexOf(a.tab.status) - order.indexOf(b.tab.status) ||
        (a.tab.needsSince ?? 0) - (b.tab.needsSince ?? 0) ||
        a.place - b.place ||
        a.tab.number - b.tab.number,
    )
    .map(({ item }) => item);
}
