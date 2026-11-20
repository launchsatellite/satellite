import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { connect, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHookListener, type HookListener } from "./hook-listener.ts";
import { mainThread, type SessionEvent } from "./session-status.ts";

interface Sent {
  method?: string;
  path?: string;
  headers?: Record<string, string | undefined>;
  body?: string | Buffer;
}
interface Answer {
  status: number;
  headers: Record<string, unknown>;
  body: string;
}

let listener: HookListener;
let events: { launchId: string; event: SessionEvent }[];
let sessionIds: (string | null)[];
let launchId: string;
let secret: string;

function send(sent: Sent): Promise<Answer> {
  const headers: Record<string, string | undefined> = {
    Host: `127.0.0.1:${String(listener.port)}`,
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
    ...sent.headers,
  };
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port: listener.port,
        method: sent.method ?? "POST",
        path: sent.path ?? `/hook/${launchId}/Stop`,
        agent: false,
        headers: Object.fromEntries(
          Object.entries(headers).filter((entry) => entry[1] !== undefined),
        ),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(sent.body ?? "{}");
  });
}

function openSocket(): Promise<{ socket: Socket; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: listener.port });
    const closed = new Promise<number>((closing) => {
      socket.once("close", () => {
        closing(Date.now());
      });
    });
    socket.once("error", () => undefined);
    socket.resume();
    socket.once("connect", () => {
      resolve({ socket, closed });
    });
    socket.once("error", reject);
  });
}

function notification(body: unknown): Promise<Answer> {
  return send({ path: `/hook/${launchId}/Notification`, body: JSON.stringify(body) });
}

beforeEach(async () => {
  events = [];
  sessionIds = [];
  listener = await startHookListener((id, event, sessionId) => {
    events.push({ launchId: id, event });
    sessionIds.push(sessionId);
  });
  launchId = randomUUID();
  secret = listener.open(launchId);
});

afterEach(async () => {
  await listener.stop();
  vi.restoreAllMocks();
});

describe("startHookListener", () => {
  it("takes an event with the launch's secret and answers with no body", async () => {
    const answer = await send({});
    expect(answer.status).toBe(204);
    expect(answer.body).toBe("");
    expect(events).toEqual([{ launchId, event: { name: "Stop" } }]);
  });

  it("refuses a request without the secret", async () => {
    const refused = [
      await send({ headers: { Authorization: undefined } }),
      await send({ headers: { Authorization: "Bearer" } }),
      await send({ headers: { Authorization: `Bearer ${secret.toUpperCase()}` } }),
      await send({ headers: { Authorization: `Basic ${secret}` } }),
      await send({ headers: { Authorization: `Bearer ${"0".repeat(64)}` } }),
      await send({ headers: { Authorization: `Bearer ${secret}0` } }),
    ];
    expect(refused.map((answer) => answer.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(refused.map((answer) => answer.body).join("")).toBe("");
    expect(events).toEqual([]);
  });

  it("refuses another launch's secret and a closed launch", async () => {
    const other = randomUUID();
    const otherSecret = listener.open(other);
    expect((await send({ headers: { Authorization: `Bearer ${otherSecret}` } })).status).toBe(401);
    expect((await send({ path: `/hook/${randomUUID()}/Stop` })).status).toBe(401);
    listener.close(launchId);
    expect((await send({})).status).toBe(401);
    expect(events).toEqual([]);
  });

  it("refuses a browser", async () => {
    const preflight = await send({
      method: "OPTIONS",
      body: "",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(preflight.status).toBe(405);
    expect(
      Object.keys(preflight.headers).filter((name) => name.startsWith("access-control")),
    ).toEqual([]);
    const withOrigin = await send({ headers: { Origin: "https://example.com" } });
    expect(withOrigin.status).toBe(403);
    expect((await send({ headers: { Origin: "null" } })).status).toBe(403);
    const padding = Object.fromEntries(
      Array.from({ length: 1500 }, (_, at) => [`x${String(at)}`, ""]),
    );
    expect((await send({ headers: { ...padding, Origin: "https://example.com" } })).status).toBe(
      403,
    );
    expect(
      (await send({ headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status,
    ).toBe(415);
    expect((await send({ headers: { "Content-Type": "text/plain" } })).status).toBe(415);
    expect(events).toEqual([]);
  });

  it("refuses another host", async () => {
    const hosts = [
      `localhost:${String(listener.port)}`,
      "example.com",
      "127.0.0.1",
      `127.0.0.1:${String(listener.port + 1)}`,
    ];
    for (const host of hosts) expect((await send({ headers: { Host: host } })).status).toBe(403);
    expect(events).toEqual([]);
  });

  it("refuses a path it does not know", async () => {
    const paths = [
      `/hook/${launchId}/PreToolUse`,
      `/hook/${launchId}/SessionStart`,
      "/other",
      `/hook/${launchId}/Stop?x=1`,
      `/hook/${launchId.toUpperCase()}/Stop`,
      `http://127.0.0.1:${String(listener.port)}/hook/${launchId}/Stop`,
    ];
    for (const path of paths) expect((await send({ path })).status).toBe(404);
    expect(events).toEqual([]);
  });

  it("refuses a body that is too large or not JSON", async () => {
    const large = JSON.stringify({ notification_type: "idle_prompt", padding: "x".repeat(70_000) });
    expect((await notification(JSON.parse(large))).status).toBe(413);
    expect(
      (
        await send({
          path: `/hook/${launchId}/Notification`,
          headers: { "Transfer-Encoding": "chunked" },
          body: large,
        })
      ).status,
    ).toBe(413);
    expect((await send({ path: `/hook/${launchId}/Notification`, body: "{" })).status).toBe(400);
    expect((await notification({ notification_type: "x".repeat(65) })).status).toBe(400);
    expect((await notification(["idle_prompt"])).status).toBe(400);
    expect(events).toEqual([]);
  });

  it("reads the type of a notification", async () => {
    const answer = await notification({
      notification_type: "permission_prompt",
      message: "Allow?",
    });
    expect(answer.status).toBe(204);
    expect(events.map((entry) => entry.event)).toEqual([
      { name: "Notification", type: "permission_prompt", agent: mainThread },
    ]);
  });

  it("reads the session id any hook carries and drops one that is no UUID", async () => {
    const post = (name: string, body: unknown) =>
      send({ path: `/hook/${launchId}/${name}`, body: JSON.stringify(body) });
    const first = randomUUID();
    const cleared = randomUUID();
    await post("UserPromptSubmit", { session_id: first, prompt: "x".repeat(100_000) });
    await post("Stop", { session_id: cleared });
    await post("Notification", { session_id: "../../etc", notification_type: "idle_prompt" });
    await post("PostToolUse", { session_id: "--help" });
    await post("StopFailure", {});
    expect(sessionIds).toEqual([first, cleared, null, null, null]);
    expect(events.map((entry) => entry.event.name)).toEqual([
      "UserPromptSubmit",
      "Stop",
      "Notification",
      "PostToolUse",
      "StopFailure",
    ]);
  });

  it("takes a prompt or stop too large to read without its session id", async () => {
    const body = JSON.stringify({ session_id: randomUUID(), prompt: "x".repeat(2 * 1024 * 1024) });
    expect((await send({ path: `/hook/${launchId}/UserPromptSubmit`, body })).status).toBe(204);
    expect((await send({ path: `/hook/${launchId}/Stop`, body: "{" })).status).toBe(400);
    expect(events.map((entry) => entry.event)).toEqual([{ name: "UserPromptSubmit" }]);
    expect(sessionIds).toEqual([null]);
  });

  it("tells which agent asked and which finished a tool", async () => {
    const post = (name: string, body: unknown) =>
      send({ path: `/hook/${launchId}/${name}`, body: JSON.stringify(body) });
    await post("PermissionRequest", { agent_id: "agent-1", tool_name: "Bash" });
    await post("PostToolUse", { tool_name: "Bash" });
    await post("PostToolUseFailure", { agent_id: 7 });
    await post("PostToolUse", { agent_id: "a".repeat(129) });
    await post("PostToolUse", { agent_id: "" });
    expect(events.map((entry) => entry.event)).toEqual([
      { name: "PermissionRequest", agent: "agent-1" },
      { name: "PostToolUse", agent: mainThread },
      { name: "PostToolUseFailure", agent: null },
      { name: "PostToolUse", agent: null },
      { name: "PostToolUse", agent: null },
    ]);
  });

  it("knows which agent finished a tool that wrote a large file", async () => {
    const answer = await send({
      path: `/hook/${launchId}/PostToolUse`,
      body: JSON.stringify({ agent_id: "agent-1", tool_response: "x".repeat(512 * 1024) }),
    });
    expect(answer.status).toBe(204);
    expect(events).toEqual([{ launchId, event: { name: "PostToolUse", agent: "agent-1" } }]);
  });

  it("takes a tool event too large to read without knowing its agent", async () => {
    const answer = await send({
      path: `/hook/${launchId}/PostToolUse`,
      body: JSON.stringify({ agent_id: "agent-1", tool_response: "x".repeat(2 * 1024 * 1024) }),
    });
    expect(answer.status).toBe(204);
    expect(events).toEqual([{ launchId, event: { name: "PostToolUse", agent: null } }]);
  });

  it("refuses a launch that sends too many events at once", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const answers: Answer[] = [];
    for (let sent = 0; sent < 101; sent += 1) answers.push(await send({}));
    expect(answers.filter((answer) => answer.status === 204)).toHaveLength(100);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(1);
    expect(events).toHaveLength(100);
  });

  it("closes every answer and lets no outsider use up a launch's events", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    for (let sent = 0; sent < 101; sent += 1) {
      const answer = await send({
        headers: { Authorization: `Bearer ${"0".repeat(64)}`, Connection: "keep-alive" },
      });
      expect(answer.status).toBe(401);
      expect(answer.headers["connection"]).toBe("close");
    }
    const answer = await send({ headers: { Connection: "keep-alive" } });
    expect(answer.status).toBe(204);
    expect(answer.headers["connection"]).toBe("close");
  });

  it("holds at most 64 connections at once", async () => {
    const open = await Promise.all(Array.from({ length: 64 }, () => openSocket()));
    await delay(200);
    const extra = await openSocket();
    const shut = await Promise.race([extra.closed.then(() => true), delay(2000).then(() => false)]);
    const stillOpen = open.filter(({ socket }) => !socket.destroyed).length;
    for (const { socket } of [...open, extra]) socket.destroy();
    expect(shut).toBe(true);
    expect(stillOpen).toBe(64);
  });

  it(
    "closes a connection that sends no request within six seconds",
    { timeout: 15_000 },
    async () => {
      const started = Date.now();
      const idle = await openSocket();
      const slow = await openSocket();
      slow.socket.write("PO");
      const closed = await Promise.all(
        [idle, slow].map(({ closed }) => Promise.race([closed, delay(9000).then(() => Infinity)])),
      );
      for (const { socket } of [idle, slow]) socket.destroy();
      for (const closedAt of closed) {
        expect(closedAt - started).toBeGreaterThanOrEqual(4000);
        expect(closedAt - started).toBeLessThan(7000);
      }
    },
  );

  it("still answers when the status cannot take an event", async () => {
    await listener.stop();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    listener = await startHookListener(() => {
      throw new Error("broken");
    });
    secret = listener.open(launchId);
    expect((await send({})).status).toBe(204);
    expect(logged).toHaveBeenCalledOnce();
  });
});
