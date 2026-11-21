import type { PullRequestNeed, SessionStatus, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { needsYou } from "../../shared/needs-you.ts";
import type { SessionTab } from "../sessions/use-sessions.ts";

interface SessionReason {
  kind: "session";
  workspace: WorkspaceRef;
  tab: string;
  terminalId: string;
  session: number;
  onlySession: boolean;
  since: number;
}
interface PullRequestReason {
  kind: "pull-request";
  workspace: WorkspaceRef;
  needs: readonly PullRequestNeed[];
  since: number;
}
export interface PullRequestNeeding {
  workspace: WorkspaceRef;
  needs: readonly PullRequestNeed[];
  since: number;
}
export type InboxReason = SessionReason | PullRequestReason;
export type InboxTarget =
  | Pick<SessionReason, "kind" | "workspace" | "tab" | "terminalId">
  | Pick<PullRequestReason, "kind" | "workspace">;
export interface InboxRow {
  workspace: WorkspaceRef;
  since: number;
  reasons: InboxReason[];
}

const needSentences: Record<PullRequestNeed, string> = {
  checks: "Checks failed on the pull request.",
  review: "A review asks for changes.",
  conflicts: "The pull request has conflicts.",
};

function sessionSentence([first, ...rest]: readonly SessionReason[]): string {
  if (rest.length > 0) return `${String(rest.length + 1)} sessions need you.`;
  if (first === undefined || first.onlySession) return "Claude Code needs you.";
  return `Session ${String(first.session)} needs you.`;
}

function pullRequestSentence([first]: readonly PullRequestReason[]): string {
  const [need, ...more] = first?.needs ?? [];
  if (need === undefined) return "";
  return more.length > 0 ? "The pull request needs you." : needSentences[need];
}

function placeOf(ref: WorkspaceRef): string {
  return `${ref.projectId}/${ref.workspace}`;
}

export function needsSince(
  previous: Pick<SessionTab, "status" | "needsSince">,
  status: SessionStatus,
  next: () => number,
): number | null {
  if (!needsYou(status)) return null;
  if (needsYou(previous.status) && previous.needsSince !== null) return previous.needsSince;
  return next();
}

export function inboxReasons(
  tabs: readonly SessionTab[],
  pullRequests: readonly PullRequestNeeding[],
): InboxReason[] {
  const open = new Map<string, number>();
  for (const tab of tabs) {
    const place = placeOf(tab.workspace);
    open.set(place, (open.get(place) ?? 0) + 1);
  }
  const sessions = tabs.flatMap((tab): InboxReason[] =>
    needsYou(tab.status) && tab.needsSince !== null
      ? [
          {
            kind: "session",
            workspace: tab.workspace,
            tab: tab.key,
            terminalId: tab.terminalId,
            session: tab.number,
            onlySession: open.get(placeOf(tab.workspace)) === 1,
            since: tab.needsSince,
          },
        ]
      : [],
  );
  const requests = pullRequests.flatMap(({ workspace, needs, since }): InboxReason[] =>
    needs.length > 0 ? [{ kind: "pull-request", workspace, needs, since }] : [],
  );
  return [...sessions, ...requests];
}

export function inboxRows(
  reasons: readonly InboxReason[],
  listed: (ref: WorkspaceRef) => boolean,
): InboxRow[] {
  const rows = new Map<string, InboxRow>();
  for (const reason of [...reasons].sort((one, other) => one.since - other.since)) {
    if (!listed(reason.workspace)) continue;
    const place = placeOf(reason.workspace);
    const row = rows.get(place);
    if (row === undefined) {
      rows.set(place, { workspace: reason.workspace, since: reason.since, reasons: [reason] });
    } else {
      row.reasons.push(reason);
    }
  }
  return [...rows.values()].sort((one, other) => other.since - one.since);
}

export function reasonSentence(row: InboxRow): string {
  const [first] = row.reasons;
  if (first === undefined) return "";
  if (first.kind === "pull-request") return pullRequestSentence([first]);
  return sessionSentence(row.reasons.filter((reason) => reason.kind === "session"));
}

export function noticeTarget(
  rows: readonly InboxRow[],
  workspace: WorkspaceRef,
): InboxTarget | undefined {
  return rows.find((row) => placeOf(row.workspace) === placeOf(workspace))?.reasons[0];
}
