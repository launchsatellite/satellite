import { describe, expect, it } from "vitest";
import { matchesShortcut, shortcutLabel, type KeyPress } from "./shortcuts.ts";

const modK = { key: "k" };
const shiftModK = { key: "k", shift: true };

function press(overrides: Partial<KeyPress>): KeyPress {
  return {
    key: "k",
    code: "KeyK",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("matchesShortcut", () => {
  it("matches Cmd+K on macOS and not Ctrl+K", () => {
    expect(matchesShortcut(press({ metaKey: true }), modK, "mac")).toBe(true);
    expect(matchesShortcut(press({ ctrlKey: true }), modK, "mac")).toBe(false);
  });

  it("matches Ctrl+K elsewhere and not Meta+K", () => {
    expect(matchesShortcut(press({ ctrlKey: true }), modK, "other")).toBe(true);
    expect(matchesShortcut(press({ metaKey: true }), modK, "other")).toBe(false);
  });

  it("never matches with Alt held, so AltGr on Windows fires nothing", () => {
    expect(matchesShortcut(press({ ctrlKey: true, altKey: true }), modK, "other")).toBe(false);
  });

  it("refuses a missing or extra Shift", () => {
    expect(matchesShortcut(press({ ctrlKey: true }), shiftModK, "other")).toBe(false);
    expect(matchesShortcut(press({ ctrlKey: true, shiftKey: true }), modK, "other")).toBe(false);
  });

  it("matches an uppercase key from Shift", () => {
    expect(
      matchesShortcut(press({ key: "K", metaKey: true, shiftKey: true }), shiftModK, "mac"),
    ).toBe(true);
  });

  it("falls back to the physical key on a non-Latin layout", () => {
    expect(matchesShortcut(press({ key: "л", code: "KeyK", metaKey: true }), modK, "mac")).toBe(
      true,
    );
    expect(matchesShortcut(press({ key: "k", code: "KeyL", metaKey: true }), modK, "mac")).toBe(
      true,
    );
  });
});

describe("shortcutLabel", () => {
  it("labels shortcuts for each platform", () => {
    expect(shortcutLabel(modK, "mac")).toBe("⌘K");
    expect(shortcutLabel(shiftModK, "mac")).toBe("⌘⇧K");
    expect(shortcutLabel(modK, "other")).toBe("Ctrl+K");
    expect(shortcutLabel(shiftModK, "other")).toBe("Ctrl+Shift+K");
  });
});
