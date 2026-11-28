import type {
  ProjectView,
  PullRequestFound,
  SessionStatus,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { repeatedNames, shownParent } from "../../shared/project-names.ts";
import type { PullRequestNeeding } from "../inbox/inbox.ts";
import { workspaceLabel } from "../projects/use-projects.ts";
import { blocks } from "../pull-request/pull-request-words.ts";
import type { PixelState } from "../ui/status-pixel.tsx";
import { pixelOf } from "./session-pixel.ts";
import type { SessionTab } from "./use-sessions.ts";

export type AgentGroup = "needs-you" | "nothing-blocks" | "working" | "done" | "resting";
export interface AgentItem {
  key: string;
  tab: string;
  terminalId: string;
  ref: WorkspaceRef;
  label: string;
  session: number;
  project: string;
  parent?: string;
  pixel: PixelState;
  group: AgentGroup;
  state: string;
  pullRequest: number | null;
  since: number;
  testKey: string;
}

export const agentGroups: readonly { group: AgentGroup; title: string; pixel: PixelState }[] = [
  { group: "needs-you", title: "Needs you", pixel: "needs-you" },
  { group: "nothing-blocks", title: "Nothing blocks", pixel: "ready" },
  { group: "working", title: "Working", pixel: "working" },
  { group: "done", title: "Done", pixel: "done" },
  { group: "resting", title: "Idle or stopped", pixel: "idle" },
];
const words: Record<SessionStatus, string> = {
  "needs-you": "Claude Code needs you",
  working: "Working",
  done: "Done",
  idle: "Idle",
  stopped: "Stopped",
};
const groupOf: Record<SessionStatus, AgentGroup> = {
  "needs-you": "needs-you",
  working: "working",
  done: "done",
  idle: "resting",
  stopped: "resting",
};

function placed(
  tab: SessionTab,
  found: PullRequestFound | null,
  needing: PullRequestNeeding | undefined,
): Pick<AgentItem, "group" | "state" | "pixel" | "since"> {
  if (tab.status !== "needs-you" && needing !== undefined) {
    return {
      group: "needs-you",
      state: "The pull request needs you",
      pixel: "needs-you",
      since: needing.since,
    };
  }
  const clear = found?.state === "open" && blocks(found).every((block) => block.key === "clear");
  if (clear && tab.status !== "needs-you" && tab.status !== "working") {
    return {
      group: "nothing-blocks",
      state: "Nothing blocks the merge",
      pixel: "ready",
      since: tab.since,
    };
  }
  return {
    group: groupOf[tab.status],
    state: words[tab.status],
    pixel: pixelOf(tab.status),
    since: tab.status === "needs-you" ? (tab.needsSince ?? tab.since) : tab.since,
  };
}

export function agentList(
  tabs: readonly SessionTab[],
  projects: readonly ProjectView[],
  pullRequestFor: (ref: WorkspaceRef) => PullRequestFound | null,
  needing: readonly PullRequestNeeding[],
): AgentItem[] {
  const repeated = repeatedNames(projects);
  const items = projects.flatMap((project) =>
    project.workspaces.flatMap((workspace) => {
      const ref = { projectId: project.id, workspace: workspace.key };
      const found = pullRequestFor(ref);
      const need = needing.find(
        (entry) =>
          entry.workspace.projectId === project.id && entry.workspace.workspace === workspace.key,
      );
      return tabs
        .filter(
          (tab) =>
            tab.workspace.projectId === project.id && tab.workspace.workspace === workspace.key,
        )
        .map((tab): AgentItem => ({
          key: tab.key,
          tab: tab.key,
          terminalId: tab.terminalId,
          ref: tab.workspace,
          label: workspaceLabel(project, workspace),
          session: tab.number,
          project: project.name,
          parent: shownParent(project, repeated),
          pullRequest: found?.number ?? null,
          testKey: `${workspace.name ?? "main"}-${String(tab.number)}`,
          ...placed(tab, found, need),
        }));
    }),
  );
  const order = agentGroups.map(({ group }) => group);
  return items
    .map((item, place) => ({ item, place }))
    .sort(
      (a, b) =>
        order.indexOf(a.item.group) - order.indexOf(b.item.group) ||
        (a.item.group === "needs-you" ? a.item.since - b.item.since : 0) ||
        a.place - b.place,
    )
    .map(({ item }) => item);
}
