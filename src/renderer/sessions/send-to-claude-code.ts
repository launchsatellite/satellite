import { z } from "zod";

export interface PromptTarget {
  paste: (text: string) => void;
  focus: () => void;
}

export const sendToClaudeCodeEvent = "satellite:send-to-claude-code";

const sentDetail = z.object({ text: z.string() });

export function sentText(event: Event): string | undefined {
  if (!(event instanceof CustomEvent)) return undefined;
  return sentDetail.safeParse(event.detail).data?.text;
}

export function sendToClaudeCode(text: string): void {
  window.dispatchEvent(new CustomEvent(sendToClaudeCodeEvent, { detail: { text } }));
}
