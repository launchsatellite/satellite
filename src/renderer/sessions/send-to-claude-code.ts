import { z } from "zod";

export interface PromptTarget {
  paste: (text: string) => void;
  focus: () => void;
}

export const sendToClaudeCodeEvent = "satellite:send-to-claude-code";

const sentDetail = z.object({ text: z.string() });
const typingPlaces =
  "input, textarea:not([readonly]), select, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='alertdialog']";

export function sentText(event: Event): string | undefined {
  if (!(event instanceof CustomEvent)) return undefined;
  return sentDetail.safeParse(event.detail).data?.text;
}

export function leavesFocusAlone(focused: Element | null, pane: Element | null): boolean {
  if (focused === null || pane?.contains(focused) === true) return false;
  return focused.closest(typingPlaces) !== null;
}

export function sendToClaudeCode(text: string): void {
  window.dispatchEvent(new CustomEvent(sendToClaudeCodeEvent, { detail: { text } }));
}

export const hooksOffNote =
  "Claude Code's settings seem to keep its hooks off here, so this session never shows needs you.";
