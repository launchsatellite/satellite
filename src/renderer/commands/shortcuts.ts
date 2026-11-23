export type KeyboardPlatform = "mac" | "other";

export interface Shortcut {
  key: string;
  ctrlAlone?: boolean;
}

export interface KeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

const latinKey = /^[a-z0-9]$/i;
const otherScript = /^\p{L}$/u;

function physicalCode(key: string): string {
  if (key === ",") return "Comma";
  return /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
}

export function keyboardPlatform(): KeyboardPlatform {
  return navigator.userAgent.includes("Mac") ? "mac" : "other";
}

export function matchesShortcut(
  press: KeyPress,
  shortcut: Shortcut,
  platform: KeyboardPlatform,
): boolean {
  if (press.isComposing) return false;
  const key = shortcut.key.toLowerCase();
  const held =
    platform === "mac"
      ? press.metaKey && !press.ctrlKey && !press.shiftKey
      : press.ctrlKey && press.shiftKey !== (shortcut.ctrlAlone === true) && !press.metaKey;
  if (!held || press.altKey) return false;
  if (press.key.toLowerCase() === key) return true;
  return (
    otherScript.test(press.key) && !latinKey.test(press.key) && press.code === physicalCode(key)
  );
}

export function shortcutLabel(shortcut: Shortcut, platform: KeyboardPlatform): string {
  const key = shortcut.key.toUpperCase();
  if (platform === "mac") return `⌘${key}`;
  return shortcut.ctrlAlone === true ? `Ctrl+${key}` : `Ctrl+Shift+${key}`;
}
