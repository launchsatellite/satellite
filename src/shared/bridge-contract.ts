import { z } from "zod";
import { isStartRef, workspaceNameLimit, workspaceNameProblem } from "./workspace-name.ts";

export type BridgeChannel = keyof typeof bridgeRequests;
export type BridgeRequest<C extends BridgeChannel> = z.output<
  (typeof bridgeRequests)[C]["request"]
>;
export type BridgeResponse<C extends BridgeChannel> = z.output<
  (typeof bridgeRequests)[C]["response"]
>;
export type BridgeEventName = keyof typeof bridgeEvents;
export type BridgeEventPayload<E extends BridgeEventName> = z.output<(typeof bridgeEvents)[E]>;
export type BridgeErrorCode = z.output<typeof bridgeErrorCode>;
export type ThemeChoice = z.output<typeof themeChoice>;
export type SessionStatus = z.output<typeof sessionStatus>;
export type SessionEnding = z.output<typeof sessionEnding>;
export type WorkspaceKey = z.output<typeof workspaceKey>;
export type WorkspaceRef = z.output<typeof workspaceRef>;
export type InterfaceState = z.output<typeof interfaceState>;
export type WorkspaceView = z.output<typeof workspaceView>;
export type ProjectView = z.output<typeof projectView>;
export type StartView = z.output<typeof startView>;
export type StartChoice = z.output<typeof startChoice>;
export type CreationStep = z.output<typeof creationStep>;
export type LossView = z.output<typeof lossView>;
export type ToolState = z.output<typeof toolState>;
export type GhState = z.output<typeof ghState>;
export type ToolCheck = z.output<typeof toolCheck>;
export type GhTokenVariable = z.output<typeof ghTokenVariable>;
export type InstallFix = z.output<typeof installFix>;
export type BridgeResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: BridgeErrorCode; message: string } };

export const linkRefusal =
  "Satellite opens only plain web addresses, http or https with a real host and no sign-in or hidden characters.";
export const bridgeLimits = {
  terminalWriteChars: 65536,
  terminalOutputChars: 65536,
  terminals: 16,
  workspacesPerProject: 20,
  messageChars: 1000,
  linkChars: 2048,
  cols: { min: 2, max: 500 },
  rows: { min: 1, max: 300 },
};

export const interfaceLimits = {
  left: { min: 200, max: 360, initial: 248 },
  right: { min: 360, max: 640, initial: 440 },
  centreMin: 400,
};

export const themeChoice = z.enum(["system", "light", "dark"]);
export const sessionStatus = z.enum(["idle", "working", "needs-you", "done", "stopped"]);
export const sessionEnding = z.enum(["ended", "unexpected", "resume-failed"]);
export const workspaceKey = z.union([z.literal("main"), z.uuid()]);
export const workspaceRef = z.strictObject({ projectId: z.uuid(), workspace: workspaceKey });
export const workspaceName = z
  .string()
  .min(1)
  .max(workspaceNameLimit)
  .refine((name) => workspaceNameProblem(name) === null);
export const refName = z.string().min(6).max(300).refine(isStartRef);
const count = z.int().min(0).max(1_000_000);
export const interfaceState = z.strictObject({
  selected: workspaceRef.nullable(),
  columns: z.strictObject({
    left: z.int().min(interfaceLimits.left.min).max(interfaceLimits.left.max),
    right: z.int().min(interfaceLimits.right.min).max(interfaceLimits.right.max),
  }),
  theme: themeChoice,
  notifications: z.boolean(),
});
export const workspaceView = z.strictObject({
  key: workspaceKey,
  name: workspaceName.nullable(),
  branch: z.string().min(1).max(255).nullable(),
  ahead: count.nullable(),
  behind: count.nullable(),
  changed: count.nullable(),
});
export const projectView = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  parent: z.string().max(255),
  missing: z.enum(["folder", "repository"]).nullable(),
  workspaces: z
    .array(workspaceView)
    .min(1)
    .max(bridgeLimits.workspacesPerProject + 1),
});
export const startView = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("remote"),
    remote: z.string().min(1).max(100),
    branch: z.string().min(1).max(255).nullable(),
  }),
  z.strictObject({ kind: z.literal("local"), branch: z.string().min(1).max(255).nullable() }),
  z.strictObject({ kind: z.literal("empty") }),
]);
export const startChoice = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("default") }),
  z.strictObject({ kind: z.literal("ref"), ref: refName }),
]);
export const creationStep = z.enum(["start", "branch", "worktree", "files", "save"]);
const subjects = z.array(z.string().max(200)).max(5);
export const lossView = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("unpushed"), count, subjects }),
  z.strictObject({ kind: z.literal("lost"), count, subjects }),
  z.strictObject({ kind: z.literal("no-remote") }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
export const ghLogin = /^[A-Za-z0-9-]{1,39}$/;
export const ghHost =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::\d{1,5})?$/;
export const ghTokenVariable = z.enum([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
]);
const toolReady = z.strictObject({
  state: z.literal("ready"),
  version: z.string().min(1).max(200),
});
const windowsPty = z.strictObject({
  backend: z.enum(["conpty", "winpty"]),
  buildNumber: z.number().int().positive(),
});
export type WindowsPty = z.output<typeof windowsPty>;
export const installFix = z.strictObject({
  kind: z.enum(["command", "address"]),
  text: z.string().min(1).max(200),
});
const toolMissing = z.strictObject({ state: z.literal("missing"), fix: installFix });
const toolBroken = z.strictObject({ state: z.literal("broken") });
export const toolState = z.discriminatedUnion("state", [toolReady, toolMissing, toolBroken]);
export const ghState = z.discriminatedUnion("state", [
  toolReady.extend({
    account: z.string().regex(ghLogin).nullable(),
    host: z.string().regex(ghHost).nullable(),
  }),
  toolMissing,
  toolBroken,
  z.strictObject({ state: z.literal("signed-out"), reason: z.enum(["none", "failed"]) }),
  z.strictObject({ state: z.literal("token-refused"), variable: ghTokenVariable }),
]);
export const toolCheck = z.strictObject({ git: toolState, gh: ghState, claude: toolState });
export const defaultInterfaceState: InterfaceState = {
  selected: null,
  columns: { left: interfaceLimits.left.initial, right: interfaceLimits.right.initial },
  theme: "system",
  notifications: true,
};

const terminalId = z.uuid();
const cols = z.int().min(bridgeLimits.cols.min).max(bridgeLimits.cols.max);
const rows = z.int().min(bridgeLimits.rows.min).max(bridgeLimits.rows.max);
const empty = z.strictObject({});
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const startBranch = z.strictObject({ ref: refName, label: z.string().min(1).max(255) });

export const bridgeRequests = {
  "tools.check": { request: empty, response: toolCheck },
  "interface.load": {
    request: empty,
    response: z.strictObject({ state: interfaceState, notice: z.string().max(300).nullable() }),
  },
  "interface.save": {
    request: z.strictObject({ state: interfaceState }),
    response: empty,
  },
  "projects.list": {
    request: empty,
    response: z.strictObject({
      projects: z.array(projectView).max(200),
      notice: z.string().max(300).nullable(),
      dropped: z.array(z.string().min(1).max(300)).max(20),
    }),
  },
  "projects.choose": {
    request: empty,
    response: z.discriminatedUnion("outcome", [
      z.strictObject({ outcome: z.literal("added"), project: projectView }),
      z.strictObject({ outcome: z.literal("canceled") }),
    ]),
  },
  "projects.drop": {
    request: z.strictObject({ path: z.string().min(1).max(4096) }),
    response: z.strictObject({ project: projectView }),
  },
  "projects.remove": {
    request: z.strictObject({ projectId: z.uuid() }),
    response: z.strictObject({
      forgotWorkspaces: z.int().min(0).max(bridgeLimits.workspacesPerProject),
    }),
  },
  "workspaces.prepare": {
    request: z.strictObject({ projectId: z.uuid() }),
    response: z.strictObject({
      name: workspaceName,
      start: startView,
      branches: z.array(startBranch).max(200),
    }),
  },
  "workspaces.create": {
    request: z.strictObject({
      operationId: z.uuid(),
      projectId: z.uuid(),
      name: workspaceName,
      start: startChoice,
    }),
    response: z.strictObject({ workspace: workspaceView }),
  },
  "workspaces.cancel": {
    request: z.strictObject({ operationId: z.uuid(), projectId: z.uuid() }),
    response: z.strictObject({ canceled: z.boolean() }),
  },
  "workspaces.inspect": {
    request: z.strictObject({ projectId: z.uuid(), workspaceId: z.uuid() }),
    response: z.strictObject({
      branch: z.string().min(1).max(255).nullable(),
      files: z
        .array(z.strictObject({ code: z.string().length(2), path: z.string().min(1).max(4096) }))
        .max(50),
      moreFiles: count,
      repositories: count,
      hidden: count.nullable(),
      submodules: z.enum(["none", "checked-out", "unknown"]),
      boundary: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("clear") }),
        z.strictObject({ kind: z.literal("mount"), at: z.string().min(1).max(300) }),
        z.strictObject({
          kind: z.literal("unchecked"),
          why: z.enum(["unreadable", "limits", "late"]),
        }),
      ]),
      commits: lossView,
      sessions: z.int().min(0).max(bridgeLimits.terminals),
      locked: z.boolean(),
      fingerprint,
    }),
  },
  "workspaces.archive": {
    request: z.strictObject({ projectId: z.uuid(), workspaceId: z.uuid(), fingerprint }),
    response: z.strictObject({ leftover: z.string().min(1).max(200).nullable() }),
  },
  "sessions.resumable": {
    request: z.strictObject({ workspace: workspaceRef }),
    response: z.strictObject({ resumable: z.boolean() }),
  },
  "links.open": {
    request: z.strictObject({ url: z.string().min(1).max(bridgeLimits.linkChars) }),
    response: empty,
  },
  "terminal.start": {
    request: z.strictObject({
      id: terminalId,
      program: z.literal("claude"),
      workspace: workspaceRef,
      resume: z.boolean(),
      cols,
      rows,
    }),
    response: z.strictObject({ windowsPty: windowsPty.nullable() }),
  },
  "terminal.write": {
    request: z.strictObject({
      id: terminalId,
      data: z.string().min(1).max(bridgeLimits.terminalWriteChars),
    }),
    response: empty,
  },
  "terminal.resize": {
    request: z.strictObject({ id: terminalId, cols, rows }),
    response: empty,
  },
  "terminal.close": {
    request: z.strictObject({ id: terminalId }),
    response: empty,
  },
  "terminal.ack": {
    request: z.strictObject({
      id: terminalId,
      chars: z.int().min(1).max(bridgeLimits.terminalOutputChars),
    }),
    response: empty,
  },
};

export const bridgeEvents = {
  "workspaces.step": z.strictObject({
    operationId: z.uuid(),
    step: creationStep,
    state: z.enum(["running", "done", "failed", "undone"]),
    detail: z.string().min(1).max(300).nullable(),
  }),
  "terminal.data": z.strictObject({
    id: terminalId,
    data: z.string().min(1).max(bridgeLimits.terminalOutputChars),
  }),
  "terminal.exit": z.strictObject({
    id: terminalId,
    exitCode: z
      .int()
      .min(-(2 ** 31))
      .max(2 ** 32 - 1),
    ending: sessionEnding,
  }),
  "sessions.status": z.strictObject({ id: terminalId, status: sessionStatus, ready: z.boolean() }),
};

const bridgeErrorCode = z.enum([
  "unknown-channel",
  "invalid-request",
  "refused-sender",
  "not-found",
  "tool-missing",
  "limit",
  "refused",
  "failed",
]);

export function bridgeResultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({
      ok: z.literal(false),
      error: z.strictObject({
        code: bridgeErrorCode,
        message: z.string().max(bridgeLimits.messageChars),
      }),
    }),
  ]);
}
