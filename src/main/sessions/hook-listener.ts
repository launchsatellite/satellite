import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { hookEvents, type HookEventName } from "./claude-launch.ts";
import { mainThread, type Agent, type SessionEvent } from "./session-status.ts";

export interface HookListener {
  readonly port: number;
  open(launchId: string): string;
  close(launchId: string): void;
  stop(): Promise<void>;
}
interface OpenLaunch {
  secret: Buffer;
  windowStart: number;
  events: number;
}
type BodyRead = { kind: "body"; text: string } | { kind: "too-large" } | { kind: "failed" };
type HookBody = z.output<typeof hookBody>;

const loopback = "127.0.0.1";
const secretBytes = 32;
const bodyLimit = 65536;
const eventsPerWindow = 100;
const rateWindowMs = 1000;
const hookPath =
  /^\/hook\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z]+)$/;
const bearer = /^Bearer ([0-9a-f]{64})$/;
const statusEvents = new Set<HookEventName>(["SessionStart", "Notification"]);
const agentEvents = new Set<HookEventName>([
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
]);
const hookBody = z.object({
  session_id: z.string().max(100).optional(),
  agent_id: z.unknown().optional(),
  source: z.string().max(64).optional(),
  notification_type: z.string().max(64).optional(),
});
const sessionIdSchema = z.uuid();
const agentIdSchema = z.string().min(1).max(128).optional();
const unknownLaunchSecret = randomBytes(secretBytes);

function answer(response: ServerResponse, status: number): void {
  response.writeHead(status, { Connection: "close" });
  response.end();
}

function onlyValue(request: IncomingMessage, name: string): string | undefined {
  const values = request.headersDistinct[name];
  return values?.length === 1 ? values[0] : undefined;
}

function isJson(contentType: string | undefined): boolean {
  const type = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return type === "application/json";
}

function secretMatches(launch: OpenLaunch | undefined, header: string | undefined): boolean {
  const match = header === undefined ? null : bearer.exec(header);
  if (match?.[1] === undefined) return false;
  const given = Buffer.from(match[1], "hex");
  const equal = timingSafeEqual(launch?.secret ?? unknownLaunchSecret, given);
  return launch !== undefined && equal;
}

function withinRate(launch: OpenLaunch, now: number): boolean {
  if (now - launch.windowStart >= rateWindowMs) {
    launch.windowStart = now;
    launch.events = 0;
  }
  launch.events += 1;
  return launch.events <= eventsPerWindow;
}

function readBody(request: IncomingMessage, keep: boolean): Promise<BodyRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (keep && size <= bodyLimit) chunks.push(chunk);
    });
    request.once("end", () => {
      if (size > bodyLimit && keep) resolve({ kind: "too-large" });
      else resolve({ kind: "body", text: Buffer.concat(chunks).toString("utf8") });
    });
    request.once("close", () => {
      resolve({ kind: "failed" });
    });
  });
}

function parseBody(text: string): HookBody | undefined {
  try {
    const parsed = hookBody.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function agentOf(body: HookBody | undefined): Agent {
  if (body === undefined) return null;
  const agent = agentIdSchema.safeParse(body.agent_id);
  return agent.success ? (agent.data ?? mainThread) : null;
}

function eventOf(name: HookEventName, body: HookBody | undefined): SessionEvent {
  if (name === "SessionStart") {
    const sessionId = sessionIdSchema.safeParse(body?.session_id);
    return {
      name,
      source: body?.source ?? null,
      sessionId: sessionId.success ? sessionId.data : null,
    };
  }
  if (name === "Notification") {
    return { name, type: body?.notification_type ?? null, agent: agentOf(body) };
  }
  if (name === "PermissionRequest" || name === "PostToolUse" || name === "PostToolUseFailure") {
    return { name, agent: agentOf(body) };
  }
  return { name };
}

export async function startHookListener(
  onEvent: (launchId: string, event: SessionEvent) => void,
): Promise<HookListener> {
  const launches = new Map<string, OpenLaunch>();
  let host = "";
  const decide = async (request: IncomingMessage): Promise<number | undefined> => {
    if (request.method !== "POST") return 405;
    const path = hookPath.exec(request.url ?? "");
    const launchId = path?.[1];
    const name = hookEvents.find((event) => event === path?.[2]);
    if (launchId === undefined || name === undefined) return 404;
    if (onlyValue(request, "host") !== host) return 403;
    if (request.headersDistinct["origin"] !== undefined) return 403;
    const launch = launches.get(launchId);
    const authorization = onlyValue(request, "authorization");
    if (!secretMatches(launch, authorization) || launch === undefined) return 401;
    if (!isJson(onlyValue(request, "content-type"))) return 415;
    if (!withinRate(launch, Date.now())) return 429;
    const keep = statusEvents.has(name) || agentEvents.has(name);
    const read = await readBody(request, keep);
    if (read.kind === "failed") return undefined;
    if (read.kind === "too-large" && statusEvents.has(name)) return 413;
    const body = read.kind === "body" && keep ? parseBody(read.text) : undefined;
    if (read.kind === "body" && keep && body === undefined) return 400;
    if (launches.get(launchId) !== launch) return 401;
    try {
      onEvent(launchId, eventOf(name, body));
    } catch (error) {
      console.error("A session's status could not take a hook event", error);
    }
    return 204;
  };
  const server = createServer(
    {
      headersTimeout: 5000,
      requestTimeout: 10_000,
      connectionsCheckingInterval: 1000,
      maxHeaderSize: 8192,
    },
    (request, response) => {
      void decide(request).then((status) => {
        if (status !== undefined) answer(response, status);
      });
    },
  );
  server.maxConnections = 64;
  server.maxHeadersCount = 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: loopback, port: 0 }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("The hook listener has no port");
  }
  const { port }: AddressInfo = address;
  host = `${loopback}:${String(port)}`;
  return {
    port,
    open(launchId) {
      const secret = randomBytes(secretBytes);
      launches.set(launchId, { secret, windowStart: 0, events: 0 });
      return secret.toString("hex");
    },
    close(launchId) {
      launches.delete(launchId);
    },
    stop() {
      launches.clear();
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
