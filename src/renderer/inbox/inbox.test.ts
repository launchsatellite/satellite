import { describe, expect, it } from "vitest";
import type { SessionStatus, WorkspaceRef } from "../../shared/bridge-contract.ts";
import type { SessionTab } from "../sessions/use-sessions.ts";
import { inboxReasons, inboxRows, reasonSentence, type InboxRow } from "./inbox.ts";

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

function rowWith(sessions: readonly number[]): InboxRow {
  return {
    workspace: alpha,
    since: 1,
    reasons: sessions.map((session, at) => ({
      kind: "session",
      workspace: alpha,
      session,
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

  it("says which session waits, or how many", () => {
    expect(reasonSentence(rowWith([2]))).toBe("Claude Code is waiting for you in Session 2.");
    expect(reasonSentence(rowWith([1, 2, 4]))).toBe(
      "Claude Code is waiting for you in 3 sessions.",
    );
  });
});
