import { keyboardPlatform } from "../commands/shortcuts.ts";

export const newlineSequence = "\u001b\r";

export function isShiftEnter(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
  );
}

export function opensLink(event: MouseEvent): boolean {
  return keyboardPlatform() === "mac" ? event.metaKey : event.ctrlKey;
}

export function imagePasteSequence(): string {
  return navigator.userAgent.includes("Windows") ? "\u001bv" : "\u0016";
}
