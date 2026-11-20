import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import type { SessionTab } from "../sessions/use-sessions.ts";

interface SessionReason {
  kind: "session";
  workspace: WorkspaceRef;
  session: number;
  since: number;
}
export type InboxReason = SessionReason;
export interface InboxRow {
  workspace: WorkspaceRef;
  since: number;
  reasons: InboxReason[];
}

const sentences: Record<InboxReason["kind"], (first: InboxReason, count: number) => string> = {
  session: (first, count) =>
    count === 1
      ? `Claude Code is waiting for you in Session ${String(first.session)}.`
      : `Claude Code is waiting for you in ${String(count)} sessions.`,
};

function placeOf(ref: WorkspaceRef): string {
  return `${ref.projectId}/${ref.workspace}`;
}

export function inboxReasons(tabs: readonly SessionTab[]): InboxReason[] {
  return tabs.flatMap((tab): InboxReason[] =>
    tab.status === "needs-you" && tab.needsSince !== null
      ? [{ kind: "session", workspace: tab.workspace, session: tab.number, since: tab.needsSince }]
      : [],
  );
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
  return first === undefined ? "" : sentences[first.kind](first, row.reasons.length);
}
