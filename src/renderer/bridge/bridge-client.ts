import type { z } from "zod";
import {
  bridgeEvents,
  bridgeRequests,
  bridgeResultSchema,
  type BridgeChannel,
  type BridgeEventName,
  type BridgeEventPayload,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeResult,
} from "../../shared/bridge-contract.ts";

const responseSchemas: { [C in BridgeChannel]: { response: z.ZodType<BridgeResponse<C>> } } =
  bridgeRequests;
const eventSchemas: { [E in BridgeEventName]: z.ZodType<BridgeEventPayload<E>> } = bridgeEvents;
const listeners: { [E in BridgeEventName]: Set<(payload: BridgeEventPayload<E>) => void> } = {
  "workspaces.step": new Set(),
  "terminal.data": new Set(),
  "terminal.exit": new Set(),
  "sessions.status": new Set(),
  "notices.open": new Set(),
  "pullRequests.needing": new Set(),
};
let listening = false;

function failed(message: string): BridgeResult<never> {
  return { ok: false, error: { code: "failed", message } };
}

function reportDrift(what: string, error: z.ZodError): void {
  const paths = error.issues.map((issue) => issue.path.map(String).join(".") || "(root)");
  console.error(`Satellite dropped ${what} it could not read at ${paths.join(", ")}`);
}

function isEventName(name: string): name is BridgeEventName {
  return Object.hasOwn(listeners, name);
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- E ties the schema to the listeners of the same event
function deliver<E extends BridgeEventName>(event: E, payload: unknown): void {
  const parsed = eventSchemas[event].safeParse(payload);
  if (!parsed.success) {
    reportDrift(`a ${event} event`, parsed.error);
    return;
  }
  for (const listener of listeners[event]) listener(parsed.data);
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.satellite.onEvent((name, payload) => {
    if (isEventName(name)) deliver(name, payload);
    else console.error(`Satellite dropped an event it does not know, ${name.slice(0, 100)}`);
  });
}

export async function invoke<C extends BridgeChannel>(
  channel: C,
  request: BridgeRequest<C>,
): Promise<BridgeResult<BridgeResponse<C>>> {
  let answer: unknown;
  try {
    answer = await window.satellite.invoke(channel, request);
  } catch {
    return failed("Satellite could not reach its background process. Try again.");
  }
  const parsed = bridgeResultSchema(responseSchemas[channel].response).safeParse(answer);
  if (parsed.success) return parsed.data;
  reportDrift(`the answer to ${channel}`, parsed.error);
  return failed("Satellite got an answer it could not read.");
}

export function subscribe<E extends BridgeEventName>(
  event: E,
  listener: (payload: BridgeEventPayload<E>) => void,
): () => void {
  listen();
  const forEvent = listeners[event];
  forEvent.add(listener);
  return () => {
    forEvent.delete(listener);
  };
}
