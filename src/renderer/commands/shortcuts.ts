export type KeyboardPlatform = "mac" | "other";

export interface Shortcut {
  key: string;
  shift?: boolean;
}

export interface KeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const latinKey = /^[a-z0-9]$/i;

function physicalCode(key: string): string {
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
  const mod =
    platform === "mac" ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  if (!mod || press.altKey || press.shiftKey !== (shortcut.shift ?? false)) return false;
  if (press.key.toLowerCase() === shortcut.key) return true;
  return !latinKey.test(press.key) && press.code === physicalCode(shortcut.key);
}

export function shortcutLabel(shortcut: Shortcut, platform: KeyboardPlatform): string {
  const key = shortcut.key.toUpperCase();
  if (platform === "mac") return `⌘${shortcut.shift === true ? "⇧" : ""}${key}`;
  return `Ctrl+${shortcut.shift === true ? "Shift+" : ""}${key}`;
}
