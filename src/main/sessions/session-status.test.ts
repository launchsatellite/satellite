import { describe, expect, it } from "vitest";
import type { SessionStatus } from "../../shared/bridge-contract.ts";
import {
  answersQuestion,
  mainThread,
  nextState,
  type SessionEvent,
  type SessionState,
} from "./session-status.ts";

const statuses: readonly SessionStatus[] = ["idle", "working", "needs-you", "done", "stopped"];

const notification = (type: string | null): SessionEvent => ({
  name: "Notification",
  type,
  agent: mainThread,
});
const asked = (agent: string | null): SessionEvent => ({ name: "PermissionRequest", agent });
const toolDone = (agent: string | null): SessionEvent => ({ name: "PostToolUse", agent });

const columns: readonly { label: string; events: readonly SessionEvent[] }[] = [
  { label: "UserPromptSubmit", events: [{ name: "UserPromptSubmit" }] },
  { label: "PermissionRequest", events: [asked(mainThread)] },
  {
    label: "post",
    events: [toolDone(mainThread), { name: "PostToolUseFailure", agent: mainThread }],
  },
  {
    label: "ask",
    events: [
      "permission_prompt",
      "elicitation_dialog",
      "elicitation_url_dialog",
      "agent_needs_input",
      "quota_auto_resume_stale",
    ].map(notification),
  },
  { label: "answered", events: ["elicitation_complete", "elicitation_response"].map(notification) },
  { label: "idle prompt", events: [notification("idle_prompt")] },
  { label: "resumed", events: [notification("quota_auto_resume_fired")] },
  { label: "answer key", events: [{ name: "AnswerKey" }] },
  {
    label: "other",
    events: ["auth_success", "agent_completed", "", "PERMISSION_PROMPT", null].map(notification),
  },
  { label: "Stop, StopFailure", events: [{ name: "Stop" }, { name: "StopFailure" }] },
  { label: "Exit", events: [{ name: "Exit" }] },
];

const table: Record<SessionStatus, readonly SessionStatus[]> = {
  idle: [
    "working",
    "needs-you",
    "working",
    "needs-you",
    "idle",
    "idle",
    "working",
    "idle",
    "idle",
    "done",
    "stopped",
  ],
  working: [
    "working",
    "needs-you",
    "working",
    "needs-you",
    "working",
    "done",
    "working",
    "working",
    "working",
    "done",
    "stopped",
  ],
  "needs-you": [
    "working",
    "needs-you",
    "working",
    "needs-you",
    "working",
    "done",
    "working",
    "working",
    "needs-you",
    "done",
    "stopped",
  ],
  done: [
    "working",
    "needs-you",
    "working",
    "needs-you",
    "done",
    "done",
    "working",
    "done",
    "done",
    "done",
    "stopped",
  ],
  stopped: [
    "stopped",
    "stopped",
    "stopped",
    "stopped",
    "stopped",
    "stopped",
    "stopped",
    "stopped",
    "stopped",
    "stopped",
    "stopped",
  ],
};

const cells = statuses.flatMap((current) =>
  columns.flatMap((column, index) =>
    column.events.map((event) => ({
      current,
      column: column.label,
      event,
      expected: table[current][index],
    })),
  ),
);

function run(start: SessionStatus, events: readonly SessionEvent[]): SessionStatus[] {
  const seen: SessionStatus[] = [];
  let state: SessionState = { status: start, askers: [] };
  for (const event of events) {
    state = nextState(state, event);
    seen.push(state.status);
  }
  return seen;
}

describe("answersQuestion", () => {
  it("takes Enter, Escape and a digit pressed alone as an answer", () => {
    expect(["\r", "\u001b", "1", "3"].map(answersQuestion)).toEqual([true, true, true, true]);
  });

  it("takes no arrow, letter, paste or typed text as an answer", () => {
    expect(
      ["\u001b[B", "y", "12", "\u001b[200~1\u001b[201~", "fix it\r", ""].map(answersQuestion),
    ).toEqual([false, false, false, false, false, false]);
  });
});

describe("nextState", () => {
  it.each(cells)(
    "moves through every status from every status, $current on $column $event",
    ({ current, event, expected }) => {
      expect(nextState({ status: current, askers: [] }, event).status).toBe(expected);
    },
  );

  it("follows a prompt that asks for permission and is approved", () => {
    expect(
      run("idle", [
        { name: "UserPromptSubmit" },
        asked(mainThread),
        notification("permission_prompt"),
        toolDone(mainThread),
        { name: "Stop" },
      ]),
    ).toEqual(["working", "needs-you", "needs-you", "working", "done"]);
  });

  it("works again at once when a key answers the question, while every agent that asked lets go", () => {
    expect(
      run("idle", [
        { name: "UserPromptSubmit" },
        asked(mainThread),
        asked("helper"),
        { name: "AnswerKey" },
        toolDone(mainThread),
      ]),
    ).toEqual(["working", "needs-you", "needs-you", "working", "working"]);
  });

  it("lets go of a declined permission once the turn has gone quiet", () => {
    expect(
      run("idle", [{ name: "UserPromptSubmit" }, asked(mainThread), notification("idle_prompt")]),
    ).toEqual(["working", "needs-you", "done"]);
  });

  it("keeps needs you while other agents finish their tools", () => {
    expect(
      run("working", [
        asked("agent-1"),
        toolDone("agent-2"),
        toolDone(mainThread),
        notification("permission_prompt"),
        { name: "PostToolUseFailure", agent: "agent-2" },
        toolDone("agent-1"),
      ]),
    ).toEqual(["needs-you", "needs-you", "needs-you", "needs-you", "needs-you", "working"]);
    expect(run("working", [asked(mainThread), toolDone("agent-1"), toolDone(mainThread)])).toEqual([
      "needs-you",
      "needs-you",
      "working",
    ]);
  });

  it("keeps needs you when a finished tool cannot say which agent ran it", () => {
    expect(run("working", [asked(mainThread), toolDone(null), toolDone(mainThread)])).toEqual([
      "needs-you",
      "needs-you",
      "working",
    ]);
  });

  it("keeps needs you until every agent that asked at once is answered", () => {
    expect(
      run("working", [
        asked("agent-1"),
        asked("agent-2"),
        toolDone("agent-2"),
        toolDone("agent-1"),
      ]),
    ).toEqual(["needs-you", "needs-you", "needs-you", "working"]);
    expect(
      run("working", [asked("agent-1"), asked(null), toolDone("agent-3"), toolDone("agent-1")]),
    ).toEqual(["needs-you", "needs-you", "needs-you", "working"]);
  });

  it("remembers a bounded number of agents that ask", () => {
    let state: SessionState = { status: "working", askers: [] };
    for (let index = 0; index < 100; index += 1) {
      state = nextState(state, asked(`agent-${String(index)}`));
    }
    expect(state.askers.length).toBeLessThanOrEqual(16);
    expect(nextState(state, { name: "Stop" })).toEqual({ status: "done", askers: [] });
  });

  it("lets any finished tool end an ask that could not say who asked", () => {
    expect(run("working", [asked(null), toolDone("agent-1")])).toEqual(["needs-you", "working"]);
  });

  it("stays done when the idle notice arrives late", () => {
    expect(run("working", [{ name: "Stop" }, notification("idle_prompt")])).toEqual([
      "done",
      "done",
    ]);
  });

  it("works again when a blocked Stop lets Claude Code carry on", () => {
    expect(run("working", [{ name: "Stop" }, toolDone(mainThread)])).toEqual(["done", "working"]);
  });

  it("keeps its status through duplicated events", () => {
    expect(
      run("idle", [
        { name: "UserPromptSubmit" },
        { name: "UserPromptSubmit" },
        asked(mainThread),
        asked(mainThread),
        { name: "Stop" },
        { name: "Stop" },
      ]),
    ).toEqual(["working", "working", "needs-you", "needs-you", "done", "done"]);
  });

  it("ignores everything once stopped", () => {
    const every = columns.flatMap((column) => column.events);
    expect(run("working", [{ name: "Exit" }, ...every])).toEqual(
      Array.from({ length: every.length + 1 }, () => "stopped"),
    );
  });
});
