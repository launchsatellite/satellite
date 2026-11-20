import type { z } from "zod";
import {
  bridgeRequests,
  type BridgeChannel,
  type BridgeErrorCode,
  type BridgeEventName,
  type BridgeEventPayload,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeResult,
} from "../../shared/bridge-contract.ts";

export interface BridgeOwner {
  readonly id: number;
  emit<E extends BridgeEventName>(event: E, payload: BridgeEventPayload<E>): void;
  onGone(listener: () => void): void;
}

export type BridgeHandler<C extends BridgeChannel> = (
  request: BridgeRequest<C>,
  owner: BridgeOwner,
) => Promise<BridgeResponse<C>>;

export type BridgeHandlers = { [C in BridgeChannel]: BridgeHandler<C> };

type Route = (payload: unknown, owner: BridgeOwner) => Promise<BridgeResult<unknown>>;

const requestSchemas: { [C in BridgeChannel]: { request: z.ZodType<BridgeRequest<C>> } } =
  bridgeRequests;

export class BridgeFailure extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function refusal(code: BridgeErrorCode, message: string): BridgeResult<never> {
  return { ok: false, error: { code, message } };
}

function bridgeRoute<C extends BridgeChannel>(channel: C, handler: BridgeHandler<C>): Route {
  const schema = requestSchemas[channel].request;
  return async (payload, owner) => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return refusal("invalid-request", "Satellite refused a request with the wrong shape.");
    }
    try {
      return { ok: true, value: await handler(parsed.data, owner) };
    } catch (error) {
      if (error instanceof BridgeFailure) return refusal(error.code, error.message);
      console.error(`Bridge handler for ${channel} failed`, error);
      return refusal("failed", "Something went wrong in Satellite. Try again.");
    }
  };
}

function routeEntry<C extends BridgeChannel>(channel: C, handlers: BridgeHandlers): [C, Route] {
  return [channel, bridgeRoute(channel, handlers[channel])];
}

function isBridgeChannel(key: string): key is BridgeChannel {
  return Object.hasOwn(bridgeRequests, key);
}

export function createBridgeRouter(
  handlers: BridgeHandlers,
): (channel: unknown, payload: unknown, owner: BridgeOwner) => Promise<BridgeResult<unknown>> {
  const routes = new Map<string, Route>(
    Object.keys(bridgeRequests)
      .filter(isBridgeChannel)
      .map((channel) => routeEntry(channel, handlers)),
  );
  return async (channel, payload, owner) => {
    const route = typeof channel === "string" ? routes.get(channel) : undefined;
    if (route === undefined) {
      return refusal("unknown-channel", "Satellite does not know that request.");
    }
    return route(payload, owner);
  };
}
