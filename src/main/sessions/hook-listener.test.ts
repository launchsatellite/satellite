import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHookListener, type HookListener } from "./hook-listener.ts";
import type { SessionEvent } from "./session-status.ts";

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

function sessionStart(body: unknown): Promise<Answer> {
  return send({ path: `/hook/${launchId}/SessionStart`, body: JSON.stringify(body) });
}

beforeEach(async () => {
  events = [];
  listener = await startHookListener((id, event) => events.push({ launchId: id, event }));
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
      "/other",
      `/hook/${launchId}/Stop?x=1`,
      `/hook/${launchId.toUpperCase()}/Stop`,
      `http://127.0.0.1:${String(listener.port)}/hook/${launchId}/Stop`,
    ];
    for (const path of paths) expect((await send({ path })).status).toBe(404);
    expect(events).toEqual([]);
  });

  it("refuses a body that is too large or not JSON", async () => {
    const large = JSON.stringify({ source: "startup", padding: "x".repeat(70_000) });
    expect((await sessionStart(JSON.parse(large))).status).toBe(413);
    expect(
      (
        await send({
          path: `/hook/${launchId}/Notification`,
          headers: { "Transfer-Encoding": "chunked" },
          body: large,
        })
      ).status,
    ).toBe(413);
    expect((await send({ path: `/hook/${launchId}/SessionStart`, body: "{" })).status).toBe(400);
    expect((await sessionStart({ source: "x".repeat(65) })).status).toBe(400);
    expect((await sessionStart(["startup"])).status).toBe(400);
    expect(events).toEqual([]);
  });

  it("reads the session id and source of a session start", async () => {
    const sessionId = randomUUID();
    const answer = await sessionStart({
      session_id: sessionId,
      source: "resume",
      cwd: "/Users/<name>/project",
    });
    expect(answer.status).toBe(204);
    await send({
      path: `/hook/${launchId}/Notification`,
      body: JSON.stringify({ notification_type: "permission_prompt", message: "Allow?" }),
    });
    expect(events.map((entry) => entry.event)).toEqual([
      { name: "SessionStart", source: "resume", sessionId },
      { name: "Notification", type: "permission_prompt" },
    ]);
  });

  it("drops a session id that is not a UUID", async () => {
    await sessionStart({ session_id: "../../etc", source: "startup" });
    await sessionStart({});
    expect(events.map((entry) => entry.event)).toEqual([
      { name: "SessionStart", source: "startup", sessionId: null },
      { name: "SessionStart", source: null, sessionId: null },
    ]);
  });

  it("never reads the body of other events", async () => {
    const answer = await send({
      path: `/hook/${launchId}/PostToolUse`,
      body: Buffer.alloc(1024 * 1024, "x"),
    });
    expect(answer.status).toBe(204);
    expect(events).toEqual([{ launchId, event: { name: "PostToolUse" } }]);
  });

  it("refuses a launch that sends too many events at once", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const answers: Answer[] = [];
    for (let sent = 0; sent < 101; sent += 1) answers.push(await send({}));
    expect(answers.filter((answer) => answer.status === 204)).toHaveLength(100);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(1);
    expect(events).toHaveLength(100);
  });

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
