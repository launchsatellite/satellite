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

export async function invoke<C extends BridgeChannel>(
  channel: C,
  request: BridgeRequest<C>,
): Promise<BridgeResult<BridgeResponse<C>>> {
  const answer = await window.satellite.invoke(channel, request);
  const parsed = bridgeResultSchema(responseSchemas[channel].response).safeParse(answer);
  if (parsed.success) return parsed.data;
  return {
    ok: false,
    error: { code: "failed", message: "Satellite got an answer it could not read." },
  };
}

export function subscribe<E extends BridgeEventName>(
  event: E,
  listener: (payload: BridgeEventPayload<E>) => void,
): () => void {
  const schema = eventSchemas[event];
  return window.satellite.onEvent((name, payload) => {
    if (name !== event) return;
    const parsed = schema.safeParse(payload);
    if (parsed.success) listener(parsed.data);
  });
}
