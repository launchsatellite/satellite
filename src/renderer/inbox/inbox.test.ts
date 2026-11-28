import { describe, expect, it } from "vitest";
import type { SessionStatus, WorkspaceRef } from "../../shared/bridge-contract.ts";
import type { SessionTab } from "../sessions/use-sessions.ts";
import {
  inboxReasons,
  inboxRows,
  needsSince,
  nextInboxTarget,
  noticeTarget,
  reasonSentence,
  rowName,
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
    hooksOff: false,
    needsSince,
  };
}

function rowsOf(tabs: readonly SessionTab[], listed: (ref: WorkspaceRef) => boolean = everywhere) {
  return inboxRows(inboxReasons(tabs, []), listed).map((row) => ({
    workspace: row.workspace.workspace,
    since: row.since,
    sessions: row.reasons.flatMap((reason) => (reason.kind === "session" ? [reason.session] : [])),
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
    const reasons = inboxReasons(
      [tab(alpha, 1, "needs-you", 1), tab(beta, 1, "needs-you", 2), tab(beta, 2, "working", null)],
      [],
    );
    expect(
      reasons.flatMap((reason) =>
        reason.kind === "session" ? [{ key: reason.tab, onlySession: reason.onlySession }] : [],
      ),
    ).toEqual([
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
      inboxReasons(
        [
          tab(beta, 1, "needs-you", 3),
          tab(alpha, 1, "needs-you", 2),
          tab(alpha, 2, "needs-you", 1),
        ],
        [],
      ),
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

  it("a pull request that needs you is a row with its sentence", () => {
    const sentence = (needs: readonly ("checks" | "review" | "conflicts")[]) =>
      reasonSentence(
        inboxRows(inboxReasons([], [{ workspace: alpha, needs, since: 1 }]), everywhere)[0] ?? {
          workspace: alpha,
          since: 0,
          reasons: [],
        },
      );
    expect(sentence(["checks"])).toBe("Checks failed on the pull request.");
    expect(sentence(["review"])).toBe("A review asks for changes.");
    expect(sentence(["conflicts"])).toBe("The pull request has conflicts.");
    expect(sentence(["checks", "conflicts"])).toBe("The pull request needs you.");
  });

  it("a workspace with a session and a pull request reason is one row led by the older", () => {
    const rows = inboxRows(
      inboxReasons(
        [tab(alpha, 1, "needs-you", 5)],
        [{ workspace: alpha, needs: ["checks"], since: 2 }],
      ),
      everywhere,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reasons.map(({ kind }) => kind)).toEqual(["pull-request", "session"]);
    expect(rows[0] === undefined ? "" : reasonSentence(rows[0])).toBe(
      "Checks failed on the pull request.",
    );
  });

  it("the target of a pull request row is its tab", () => {
    const rows = inboxRows(
      inboxReasons([], [{ workspace: alpha, needs: ["review"], since: 1 }]),
      everywhere,
    );
    expect(noticeTarget(rows, alpha)).toMatchObject({ kind: "pull-request", workspace: alpha });
  });

  it("a pull request reason leaves when its needs clear", () => {
    expect(inboxReasons([], [{ workspace: alpha, needs: [], since: 1 }])).toEqual([]);
  });
});

describe("nextInboxTarget", () => {
  const gamma: WorkspaceRef = { projectId, workspace: "gamma" };
  const rows = inboxRows(
    inboxReasons(
      [tab(alpha, 1, "needs-you", 3), tab(beta, 1, "needs-you", 2)],
      [{ workspace: gamma, needs: ["checks"], since: 1 }],
    ),
    everywhere,
  );
  const next = (current: WorkspaceRef | null) => nextInboxTarget(rows, current)?.workspace;

  it("goes to the next workspace in the inbox order and wraps", () => {
    expect(rows.map(({ workspace }) => workspace.workspace)).toEqual(["alpha", "beta", "gamma"]);
    expect(next(alpha)).toEqual(beta);
    expect(next(beta)).toEqual(gamma);
    expect(next(gamma)).toEqual(alpha);
  });

  it("starts at the top from a workspace that is not in the inbox, and has nothing when it is empty", () => {
    expect(next({ projectId, workspace: "delta" })).toEqual(alpha);
    expect(next(null)).toEqual(alpha);
    expect(nextInboxTarget([], alpha)).toBeUndefined();
  });
});

describe("rowName", () => {
  it("writes out the hidden characters of a workspace label", () => {
    expect(rowName("fix\u202Egnp.exe", "repo", "Claude Code needs you.")).toBe(
      "fix[U+202E]gnp.exe, repo. Claude Code needs you.",
    );
  });

  it("leaves a plain label as it is", () => {
    expect(rowName("alpha", "repo", "Checks failed on the pull request.")).toBe(
      "alpha, repo. Checks failed on the pull request.",
    );
  });
});
