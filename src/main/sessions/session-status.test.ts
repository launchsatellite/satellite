import { describe, expect, it } from "vitest";
import type { SessionStatus } from "../../shared/bridge-contract.ts";
import { nextStatus, type SessionEvent } from "./session-status.ts";

const statuses: readonly SessionStatus[] = ["idle", "working", "needs-you", "done", "stopped"];

const notification = (type: string | null): SessionEvent => ({ name: "Notification", type });
const sessionStart = (source: string | null): SessionEvent => ({
  name: "SessionStart",
  source,
  sessionId: null,
});

const columns: readonly { label: string; events: readonly SessionEvent[] }[] = [
  {
    label: "start",
    events: ["startup", "resume", "clear", "fork", "unheard", null].map(sessionStart),
  },
  { label: "compact", events: [sessionStart("compact")] },
  { label: "UserPromptSubmit", events: [{ name: "UserPromptSubmit" }] },
  { label: "PermissionRequest", events: [{ name: "PermissionRequest" }] },
  { label: "post", events: [{ name: "PostToolUse" }, { name: "PostToolUseFailure" }] },
  {
    label: "ask",
    events: [
      "permission_prompt",
      "elicitation_dialog",
      "elicitation_url_dialog",
      "agent_needs_input",
    ].map(notification),
  },
  { label: "answered", events: ["elicitation_complete", "elicitation_response"].map(notification) },
  { label: "idle prompt", events: [notification("idle_prompt")] },
  {
    label: "other",
    events: ["auth_success", "agent_completed", "", "PERMISSION_PROMPT", null].map(notification),
  },
  { label: "Stop, StopFailure", events: [{ name: "Stop" }, { name: "StopFailure" }] },
  { label: "Exit", events: [{ name: "Exit" }] },
];

const table: Record<SessionStatus, readonly SessionStatus[]> = {
  idle: [
    "idle",
    "idle",
    "working",
    "needs-you",
    "working",
    "needs-you",
    "idle",
    "idle",
    "idle",
    "done",
    "stopped",
  ],
  working: [
    "idle",
    "working",
    "working",
    "needs-you",
    "working",
    "needs-you",
    "working",
    "done",
    "working",
    "done",
    "stopped",
  ],
  "needs-you": [
    "idle",
    "needs-you",
    "working",
    "needs-you",
    "working",
    "needs-you",
    "working",
    "done",
    "needs-you",
    "done",
    "stopped",
  ],
  done: [
    "idle",
    "done",
    "working",
    "needs-you",
    "working",
    "needs-you",
    "done",
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
  let status = start;
  for (const event of events) {
    status = nextStatus(status, event);
    seen.push(status);
  }
  return seen;
}

describe("nextStatus", () => {
  it.each(cells)(
    "moves through every status from every status, $current on $column $event",
    ({ current, event, expected }) => {
      expect(nextStatus(current, event)).toBe(expected);
    },
  );

  it("follows a prompt that asks for permission and is approved", () => {
    expect(
      run("idle", [
        { name: "UserPromptSubmit" },
        { name: "PermissionRequest" },
        notification("permission_prompt"),
        { name: "PostToolUse" },
        { name: "Stop" },
      ]),
    ).toEqual(["working", "needs-you", "needs-you", "working", "done"]);
  });

  it("lets go of a declined permission once the turn has gone quiet", () => {
    expect(
      run("idle", [
        { name: "UserPromptSubmit" },
        { name: "PermissionRequest" },
        notification("idle_prompt"),
      ]),
    ).toEqual(["working", "needs-you", "done"]);
  });

  it("stays done when the idle notice arrives late", () => {
    expect(run("working", [{ name: "Stop" }, notification("idle_prompt")])).toEqual([
      "done",
      "done",
    ]);
  });

  it("works again when a blocked Stop lets Claude Code carry on", () => {
    expect(run("working", [{ name: "Stop" }, { name: "PostToolUse" }])).toEqual([
      "done",
      "working",
    ]);
  });

  it("keeps its status through duplicated events", () => {
    expect(
      run("idle", [
        { name: "UserPromptSubmit" },
        { name: "UserPromptSubmit" },
        { name: "PermissionRequest" },
        { name: "PermissionRequest" },
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
