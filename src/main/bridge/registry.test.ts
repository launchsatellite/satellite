import { describe, expect, it, vi } from "vitest";
import type { BridgeHandler, BridgeHandlers, BridgeOwner } from "./registry.ts";
import { BridgeFailure, createBridgeRouter } from "./registry.ts";

const terminalId = "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6";

function spies() {
  const handlers = {
    "tools.versions": vi.fn<BridgeHandler<"tools.versions">>(() =>
      Promise.resolve({ git: "git version 2.50.1", gh: null, claude: null }),
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

  it("passes a valid request to its handler and returns its value", async () => {
    const handlers = spies();
    const route = createBridgeRouter(handlers);
    const request = { id: terminalId, cols: 120, rows: 40 };
    const result = await route("terminal.resize", request, owner);
    expect(result).toEqual({ ok: true, value: {} });
    expect(handlers["terminal.resize"]).toHaveBeenCalledWith(request, owner);
    expect(await route("tools.versions", {}, owner)).toEqual({
      ok: true,
      value: { git: "git version 2.50.1", gh: null, claude: null },
    });
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
