import { describe, expect, it } from "vitest";
import type { SessionStatus, WorkspaceRef } from "../../shared/bridge-contract.ts";
import type { SessionTab } from "../sessions/use-sessions.ts";
import {
  inboxReasons,
  inboxRows,
  needsSince,
  noticeTarget,
  reasonSentence,
  type InboxRow,
} from "./inbox.ts";

const projectId = "6f1c1a52-8a4e-4a3b-9a59-3c8f0f8f6b1d";
const alpha: WorkspaceRef = { projectId, workspace: "alpha" };
const beta: WorkspaceRef = { projectId, workspace: "beta" };
const everywhere = () => true;

function tab(
  workspace: WorkspaceRef,
  number: number,
  status: SessionStatus,
  needsSince: number | null,
): SessionTab {
  return {
    key: `${workspace.workspace}-${String(number)}`,
    terminalId: `terminal-${workspace.workspace}-${String(number)}`,
    number,
    workspace,
    resume: false,
    status,
    ready: true,
    needsSince,
  };
}

function rowsOf(tabs: readonly SessionTab[], listed: (ref: WorkspaceRef) => boolean = everywhere) {
  return inboxRows(inboxReasons(tabs), listed).map((row) => ({
    workspace: row.workspace.workspace,
    since: row.since,
    sessions: row.reasons.map((reason) => reason.session),
  }));
}

function rowWith(sessions: readonly number[], onlySession = false): InboxRow {
  return {
    workspace: alpha,
    since: 1,
    reasons: sessions.map((session, at) => ({
      kind: "session",
      workspace: alpha,
      tab: `alpha-${String(session)}`,
      terminalId: `terminal-alpha-${String(session)}`,
      session,
      onlySession,
      since: at + 1,
    })),
  };
}

describe("inbox", () => {
  it("lists each workspace that needs you once, newest first", () => {
    expect(
      rowsOf([
        tab(alpha, 1, "needs-you", 3),
        tab(beta, 1, "needs-you", 2),
        tab(alpha, 2, "needs-you", 1),
      ]),
    ).toEqual([
      { workspace: "beta", since: 2, sessions: [1] },
      { workspace: "alpha", since: 1, sessions: [2, 1] },
    ]);
  });

  it("orders a workspace by when it started needing you", () => {
    expect(
      rowsOf([
        tab(alpha, 1, "needs-you", 1),
        tab(beta, 1, "needs-you", 2),
        tab(alpha, 2, "needs-you", 3),
      ]).map((row) => row.workspace),
    ).toEqual(["beta", "alpha"]);
    expect(
      rowsOf([tab(alpha, 1, "needs-you", 4), tab(beta, 1, "needs-you", 2)]).map(
        (row) => row.workspace,
      ),
    ).toEqual(["alpha", "beta"]);
  });

  it("leaves out tabs that do not need you and workspaces that are not listed", () => {
    expect(
      rowsOf([
        tab(alpha, 1, "working", null),
        tab(alpha, 2, "done", null),
        tab(alpha, 3, "stopped", null),
        tab(alpha, 4, "needs-you", null),
        tab(beta, 1, "idle", null),
      ]),
    ).toEqual([]);
    expect(
      rowsOf(
        [tab(alpha, 1, "needs-you", 1), tab(beta, 1, "needs-you", 2)],
        (ref) => ref.workspace === "alpha",
      ),
    ).toEqual([{ workspace: "alpha", since: 1, sessions: [1] }]);
  });

  it("says which session waits, or how many, short enough for the sidebar", () => {
    expect(reasonSentence(rowWith([1], true))).toBe("Claude Code needs you.");
    expect(reasonSentence(rowWith([2]))).toBe("Session 2 needs you.");
    expect(reasonSentence(rowWith([1, 2, 4]))).toBe("3 sessions need you.");
  });

  it("names a session only when its workspace has another, and finds it by its key", () => {
    const reasons = inboxReasons([
      tab(alpha, 1, "needs-you", 1),
      tab(beta, 1, "needs-you", 2),
      tab(beta, 2, "working", null),
    ]);
    expect(reasons.map(({ tab: key, onlySession }) => ({ key, onlySession }))).toEqual([
      { key: "alpha-1", onlySession: true },
      { key: "beta-1", onlySession: false },
    ]);
  });

  it("keeps when a tab started needing you until it stops, then counts afresh", () => {
    let counter = 0;
    const next = () => (counter += 1);
    const asking = needsSince({ status: "working", needsSince: null }, "needs-you", next);
    expect(asking).toBe(1);
    expect(needsSince({ status: "needs-you", needsSince: asking }, "needs-you", next)).toBe(1);
    expect(needsSince({ status: "needs-you", needsSince: asking }, "working", next)).toBeNull();
    expect(needsSince({ status: "working", needsSince: null }, "needs-you", next)).toBe(2);
    expect(needsSince({ status: "idle", needsSince: null }, "done", next)).toBeNull();
    expect(counter).toBe(2);
  });

  it("opens a clicked notification's workspace only while it still needs you", () => {
    const rows = inboxRows(
      inboxReasons([
        tab(beta, 1, "needs-you", 3),
        tab(alpha, 1, "needs-you", 2),
        tab(alpha, 2, "needs-you", 1),
      ]),
      ({ workspace }) => workspace !== "gamma",
    );
    expect(noticeTarget(rows, alpha)).toEqual({
      kind: "session",
      workspace: alpha,
      tab: "alpha-2",
      terminalId: "terminal-alpha-2",
      session: 2,
      onlySession: false,
      since: 1,
    });
    expect(noticeTarget(rows, { projectId, workspace: "main" })).toBeUndefined();
    expect(
      noticeTarget(rows, { projectId: "7a2d2b63-9b5f-4b4c-8b6a-4d9f1f9f7c2e", workspace: "alpha" }),
    ).toBeUndefined();
    expect(noticeTarget([], beta)).toBeUndefined();
  });
});
