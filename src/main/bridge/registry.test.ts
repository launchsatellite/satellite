import { describe, expect, it, vi } from "vitest";
import { defaultInterfaceState, type ToolCheck } from "../../shared/bridge-contract.ts";
import type { BridgeHandler, BridgeHandlers, BridgeOwner } from "./registry.ts";
import { BridgeFailure, createBridgeRouter } from "./registry.ts";

const terminalId = "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6";
const toolCheck: ToolCheck = {
  git: { state: "ready", version: "2.50.1" },
  gh: { state: "signed-out", reason: "none" },
  claude: {
    state: "missing",
    fix: { kind: "command", text: "curl -fsSL https://claude.ai/install.sh | bash" },
  },
};

function spies() {
  const handlers = {
    "tools.check": vi.fn<BridgeHandler<"tools.check">>(() => Promise.resolve(toolCheck)),
    "interface.load": vi.fn<BridgeHandler<"interface.load">>(() =>
      Promise.resolve({ state: defaultInterfaceState, notice: null }),
    ),
    "interface.save": vi.fn<BridgeHandler<"interface.save">>(() => Promise.resolve({})),
    "projects.list": vi.fn<BridgeHandler<"projects.list">>(() =>
      Promise.resolve({ projects: [], notice: null, dropped: [] }),
    ),
    "projects.choose": vi.fn<BridgeHandler<"projects.choose">>(() =>
      Promise.resolve({ outcome: "canceled" }),
    ),
    "projects.drop": vi.fn<BridgeHandler<"projects.drop">>(() =>
      Promise.resolve({
        project: {
          id: terminalId,
          name: "alpha",
          parent: "folders",
          missing: null,
          workspaces: [
            { key: "main", name: null, branch: "main", ahead: 0, behind: 0, changed: 0 },
          ],
        },
      }),
    ),
    "projects.remove": vi.fn<BridgeHandler<"projects.remove">>(() =>
      Promise.resolve({ forgotWorkspaces: 0 }),
    ),
    "workspaces.prepare": vi.fn<BridgeHandler<"workspaces.prepare">>(() =>
      Promise.resolve({
        name: "swift-comet",
        start: { kind: "local", branch: "main" },
        branches: [],
      }),
    ),
    "workspaces.create": vi.fn<BridgeHandler<"workspaces.create">>(() =>
      Promise.resolve({
        workspace: {
          key: terminalId,
          name: "swift-comet",
          branch: "swift-comet",
          ahead: null,
          behind: null,
          changed: null,
        },
      }),
    ),
    "workspaces.cancel": vi.fn<BridgeHandler<"workspaces.cancel">>(() =>
      Promise.resolve({ canceled: true }),
    ),
    "workspaces.inspect": vi.fn<BridgeHandler<"workspaces.inspect">>(() =>
      Promise.resolve({
        branch: "swift-comet",
        files: [],
        moreFiles: 0,
        repositories: 0,
        hidden: 0,
        submodules: "none",
        mount: null,
        commits: { kind: "no-remote" },
        sessions: 0,
        locked: false,
        fingerprint: "a".repeat(64),
      }),
    ),
    "workspaces.archive": vi.fn<BridgeHandler<"workspaces.archive">>(() =>
      Promise.resolve({ leftover: null }),
    ),
    "terminal.start": vi.fn<BridgeHandler<"terminal.start">>(() => Promise.resolve({})),
    "terminal.write": vi.fn<BridgeHandler<"terminal.write">>(() => Promise.resolve({})),
    "terminal.resize": vi.fn<BridgeHandler<"terminal.resize">>(() => Promise.resolve({})),
    "terminal.close": vi.fn<BridgeHandler<"terminal.close">>(() => Promise.resolve({})),
    "terminal.ack": vi.fn<BridgeHandler<"terminal.ack">>(() => Promise.resolve({})),
  } satisfies BridgeHandlers;
  return handlers;
}

const owner: BridgeOwner = {
  id: 1,
  emit: () => undefined,
  onGone: () => undefined,
};

function noHandlerRan(handlers: ReturnType<typeof spies>): void {
  for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
}

describe("createBridgeRouter", () => {
  it("refuses a request with a wrong shape before any handler runs", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const payloads = [
      { id: terminalId, cols: "wide", rows: 24 },
      { id: terminalId, cols: 80 },
      { id: terminalId, cols: 80, rows: 24, shell: "sh" },
    ];
    for (const payload of payloads) {
      const result = await route("terminal.resize", payload, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    noHandlerRan(handlers);
  });

  it("refuses unknown channels including prototype keys", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    for (const channel of ["nope", "__proto__", "constructor", "toString"]) {
      const result = await route(channel, {}, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "unknown-channel" } });
    }
    noHandlerRan(handlers);
  });

  it("refuses a channel that is not a string", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    for (const channel of [42, null]) {
      const result = await route(channel, {}, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "unknown-channel" } });
    }
    noHandlerRan(handlers);
  });

  it("refuses terminal data over the size limit", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const result = await route(
      "terminal.write",
      { id: terminalId, data: "x".repeat(65537) },
      owner,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    noHandlerRan(handlers);
  });

  it("refuses a terminal id that is not a uuid", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const result = await route("terminal.close", { id: "../../etc" }, owner);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    noHandlerRan(handlers);
  });

  it("refuses a project id that is not a uuid", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const payloads = [
      { projectId: "../../etc" },
      { projectId: "/Users/<name>/repo" },
      { projectId: terminalId.toUpperCase().replace("6F1C", "ZZZZ") },
      { projectId: terminalId, path: "/Users/<name>/repo" },
      {},
    ];
    for (const payload of payloads) {
      const result = await route("projects.remove", payload, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    for (const channel of ["projects.choose", "projects.list"]) {
      const result = await route(channel, { path: "/Users/<name>/repo" }, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    noHandlerRan(handlers);
  });

  it("refuses workspace names that are not branches or that leave the folder", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const valid = {
      operationId: terminalId,
      projectId: terminalId,
      name: "fix-login",
      start: { kind: "default" },
    };
    const payloads = [
      ...["../x", "a/b", "-x", "Fix", "con", "a".repeat(49), ""].map((name) => ({
        ...valid,
        name,
      })),
      { ...valid, start: { kind: "ref", ref: "refs/heads/a..b" } },
      { ...valid, start: { kind: "ref", ref: "HEAD" } },
      { ...valid, start: { kind: "ref", ref: "--upload-pack=x" } },
      { ...valid, operationId: "not-a-uuid" },
      { ...valid, extra: true },
      { ...valid, start: { kind: "default", ref: "refs/heads/main" } },
    ];
    for (const payload of payloads) {
      const result = await route("workspaces.create", payload, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    for (const payload of [{ projectId: "../x" }, { projectId: terminalId, path: "/tmp" }]) {
      const result = await route("workspaces.prepare", payload, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    noHandlerRan(handlers);
    const accepted = await route(
      "workspaces.create",
      { ...valid, start: { kind: "ref", ref: "refs/remotes/origin/release" } },
      owner,
    );
    expect(accepted).toMatchObject({ ok: true });
  });

  it("refuses to archive the main workspace or without a fingerprint", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const valid = { projectId: terminalId, workspaceId: terminalId, fingerprint: "0".repeat(64) };
    const payloads = [
      { ...valid, workspaceId: "main" },
      { ...valid, fingerprint: "0".repeat(63) },
      { ...valid, fingerprint: "A".repeat(64) },
      { projectId: terminalId, workspaceId: terminalId },
      { ...valid, path: "/Users/<name>/repo" },
      { ...valid, projectId: "../x" },
    ];
    for (const payload of payloads) {
      const result = await route("workspaces.archive", payload, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    for (const payload of [
      { projectId: terminalId, workspaceId: "main" },
      { projectId: terminalId, workspaceId: terminalId, fingerprint: "0".repeat(64) },
    ]) {
      const result = await route("workspaces.inspect", payload, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    noHandlerRan(handlers);
    expect(await route("workspaces.archive", valid, owner)).toMatchObject({ ok: true });
  });

  it("refuses a cancel that names anything but two ids", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const valid = { operationId: terminalId, projectId: terminalId };
    for (const payload of [
      { operationId: terminalId },
      { ...valid, operationId: "main" },
      { ...valid, projectId: "../x" },
      { ...valid, workspaceId: terminalId },
    ]) {
      const result = await route("workspaces.cancel", payload, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    noHandlerRan(handlers);
    expect(await route("workspaces.cancel", valid, owner)).toMatchObject({ ok: true });
  });

  it("refuses a dropped path that is empty or too long", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    for (const path of ["", "/".repeat(4097), 42]) {
      const result = await route("projects.drop", { path }, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    noHandlerRan(handlers);
  });

  it("refuses an ack that is not a positive count within one output event", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const payloads = [
      { id: terminalId, chars: 0 },
      { id: terminalId, chars: -5 },
      { id: terminalId, chars: 1.5 },
      { id: terminalId, chars: 65537 },
      { id: terminalId, chars: "10" },
      { id: terminalId, chars: 10, extra: true },
    ];
    for (const payload of payloads) {
      const result = await route("terminal.ack", payload, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    noHandlerRan(handlers);
  });

  it("refuses interface state out of bounds", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const columns = defaultInterfaceState.columns;
    const states = [
      { ...defaultInterfaceState, columns: { ...columns, left: 199 } },
      { ...defaultInterfaceState, columns: { ...columns, left: 361 } },
      { ...defaultInterfaceState, columns: { ...columns, right: 641 } },
      { ...defaultInterfaceState, theme: "sepia" },
      { ...defaultInterfaceState, selected: { projectId: terminalId, workspace: "other" } },
      { ...defaultInterfaceState, extra: true },
    ];
    for (const state of states) {
      const result = await route("interface.save", { state }, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    noHandlerRan(handlers);
  });

  it("refuses a selection with a workspace that is neither main nor a uuid", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    for (const workspace of ["main", terminalId]) {
      const state = { ...defaultInterfaceState, selected: { projectId: terminalId, workspace } };
      expect(await route("interface.save", { state }, owner)).toEqual({ ok: true, value: {} });
    }
    for (const workspace of ["Main", "fix-login", "", "../x", `${terminalId}x`, 1]) {
      const state = { ...defaultInterfaceState, selected: { projectId: terminalId, workspace } };
      const result = await route("interface.save", { state }, owner);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    }
    expect(handlers["interface.save"]).toHaveBeenCalledTimes(2);
  });

  it("passes a valid request to its handler and returns its value", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const request = { id: terminalId, cols: 120, rows: 40 };
    const result = await route("terminal.resize", request, owner);
    expect(result).toEqual({ ok: true, value: {} });
    expect(handlers["terminal.resize"]).toHaveBeenCalledWith(request, owner);
    expect(await route("tools.check", {}, owner)).toEqual({ ok: true, value: toolCheck });
  });

  it("turns a BridgeFailure into its code and message and any other error into failed without its stack", async () => {
    const handlers = spies();
    handlers["terminal.close"].mockRejectedValue(
      new BridgeFailure("not-found", "No such terminal."),
    );
    handlers["terminal.start"].mockRejectedValue(new Error("secret internals"));
    const route = createBridgeRouter(handlers);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await route("terminal.close", { id: terminalId }, owner)).toEqual({
      ok: false,
      error: { code: "not-found", message: "No such terminal." },
    });
    const failed = await route(
      "terminal.start",
      { id: terminalId, program: "claude", cols: 80, rows: 24 },
      owner,
    );
    expect(failed).toEqual({
      ok: false,
      error: { code: "failed", message: "Something went wrong in Satellite. Try again." },
    });
    expect(JSON.stringify(failed)).not.toContain("secret internals");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
