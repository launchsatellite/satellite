import { z } from "zod";

export const focusSessionEvent = "satellite:focus-session";

const focusDetail = z.object({ terminalId: z.string() });

export function focusedTerminal(event: Event): string | undefined {
  if (!(event instanceof CustomEvent)) return undefined;
  return focusDetail.safeParse(event.detail).data?.terminalId;
}

export function focusSession(terminalId: string): void {
  window.dispatchEvent(new CustomEvent(focusSessionEvent, { detail: { terminalId } }));
}
