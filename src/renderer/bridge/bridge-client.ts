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

function failed(message: string): BridgeResult<never> {
  return { ok: false, error: { code: "failed", message } };
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
  return parsed.success ? parsed.data : failed("Satellite got an answer it could not read.");
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
