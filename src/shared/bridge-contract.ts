import { z } from "zod";

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
export type WorkspaceRef = z.output<typeof workspaceRef>;
export type InterfaceState = z.output<typeof interfaceState>;
export type WorkspaceView = z.output<typeof workspaceView>;
export type ProjectView = z.output<typeof projectView>;
export type ToolState = z.output<typeof toolState>;
export type GhState = z.output<typeof ghState>;
export type ToolCheck = z.output<typeof toolCheck>;
export type BridgeResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: BridgeErrorCode; message: string } };

export const bridgeLimits = {
  terminalWriteChars: 65536,
  terminalOutputChars: 65536,
  terminals: 16,
  messageChars: 1000,
  cols: { min: 2, max: 500 },
  rows: { min: 1, max: 300 },
};

export const interfaceLimits = {
  left: { min: 200, max: 360, initial: 248 },
  right: { min: 360, max: 640, initial: 440 },
  centreMin: 400,
};

export const themeChoice = z.enum(["system", "light", "dark"]);
export const workspaceRef = z.strictObject({ projectId: z.uuid(), workspace: z.literal("main") });
export const interfaceState = z.strictObject({
  selected: workspaceRef.nullable(),
  columns: z.strictObject({
    left: z.int().min(interfaceLimits.left.min).max(interfaceLimits.left.max),
    right: z.int().min(interfaceLimits.right.min).max(interfaceLimits.right.max),
  }),
  theme: themeChoice,
});
export const workspaceView = z.strictObject({
  key: z.literal("main"),
  branch: z.string().min(1).max(255).nullable(),
});
export const projectView = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  parent: z.string().max(255),
  missing: z.boolean(),
  workspaces: z.array(workspaceView).max(1),
});
const toolReady = z.strictObject({
  state: z.literal("ready"),
  version: z.string().min(1).max(200),
});
const toolMissing = z.strictObject({
  state: z.literal("missing"),
  fix: z.string().min(1).max(200),
});
export const toolState = z.discriminatedUnion("state", [toolReady, toolMissing]);
export const ghState = z.discriminatedUnion("state", [
  toolReady.extend({
    account: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,39}$/)
      .nullable(),
  }),
  toolMissing,
  z.strictObject({
    state: z.literal("signed-out"),
    reason: z.enum(["none", "failed"]),
    fix: z.literal("gh auth login"),
  }),
]);
export const toolCheck = z.strictObject({ git: toolState, gh: ghState, claude: toolState });
export const defaultInterfaceState: InterfaceState = {
  selected: null,
  columns: { left: interfaceLimits.left.initial, right: interfaceLimits.right.initial },
  theme: "system",
};

const terminalId = z.uuid();
const cols = z.int().min(bridgeLimits.cols.min).max(bridgeLimits.cols.max);
const rows = z.int().min(bridgeLimits.rows.min).max(bridgeLimits.rows.max);
const empty = z.strictObject({});

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
    }),
  },
  "projects.choose": {
    request: empty,
    response: z.discriminatedUnion("outcome", [
      z.strictObject({ outcome: z.literal("added"), project: projectView }),
      z.strictObject({ outcome: z.literal("canceled") }),
    ]),
  },
  "projects.remove": {
    request: z.strictObject({ projectId: z.uuid() }),
    response: empty,
  },
  "terminal.start": {
    request: z.strictObject({ id: terminalId, program: z.literal("claude"), cols, rows }),
    response: empty,
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
  }),
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
