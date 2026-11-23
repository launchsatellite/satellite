import { describe, expect, it } from "vitest";
import { matchesShortcut, shortcutLabel, type KeyPress } from "./shortcuts.ts";

const modK = { key: "k" };

function press(overrides: Partial<KeyPress>): KeyPress {
  return {
    key: "k",
    code: "KeyK",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  };
}

describe("matchesShortcut", () => {
  it("matches Cmd+K on macOS and not Ctrl+K or Cmd+Shift+K", () => {
    expect(matchesShortcut(press({ metaKey: true }), modK, "mac")).toBe(true);
    expect(matchesShortcut(press({ ctrlKey: true }), modK, "mac")).toBe(false);
    expect(matchesShortcut(press({ key: "K", metaKey: true, shiftKey: true }), modK, "mac")).toBe(
      false,
    );
  });

  it("matches Ctrl+Shift+K on Windows and Linux and leaves plain Ctrl+K to the focused element", () => {
    expect(matchesShortcut(press({ key: "K", ctrlKey: true, shiftKey: true }), modK, "other")).toBe(
      true,
    );
    expect(matchesShortcut(press({ ctrlKey: true }), modK, "other")).toBe(false);
    expect(matchesShortcut(press({ metaKey: true, shiftKey: true }), modK, "other")).toBe(false);
  });

  it("never matches with Alt held, so AltGr on Windows fires nothing", () => {
    expect(
      matchesShortcut(press({ ctrlKey: true, shiftKey: true, altKey: true }), modK, "other"),
    ).toBe(false);
    expect(matchesShortcut(press({ metaKey: true, altKey: true }), modK, "mac")).toBe(false);
  });

  it("falls back to the physical key on a non-Latin layout", () => {
    expect(matchesShortcut(press({ key: "л", code: "KeyK", metaKey: true }), modK, "mac")).toBe(
      true,
    );
    expect(
      matchesShortcut(
        press({ key: "Л", code: "KeyK", ctrlKey: true, shiftKey: true }),
        modK,
        "other",
      ),
    ).toBe(true);
    expect(matchesShortcut(press({ key: "k", code: "KeyL", metaKey: true }), modK, "mac")).toBe(
      true,
    );
  });

  it("never fires while an input method is composing", () => {
    expect(matchesShortcut(press({ metaKey: true, isComposing: true }), modK, "mac")).toBe(false);
    expect(
      matchesShortcut(press({ ctrlKey: true, shiftKey: true, isComposing: true }), modK, "other"),
    ).toBe(false);
  });

  it("matches a shortcut written in uppercase", () => {
    expect(matchesShortcut(press({ metaKey: true }), { key: "K" }, "mac")).toBe(true);
  });
});

describe("a Ctrl alone shortcut", () => {
  const settings = { key: ",", ctrlAlone: true };

  it("takes Ctrl+Comma on Windows and Linux and leaves Ctrl+Shift+Comma alone", () => {
    expect(
      matchesShortcut(press({ key: ",", code: "Comma", ctrlKey: true }), settings, "other"),
    ).toBe(true);
    expect(
      matchesShortcut(
        press({ key: "<", code: "Comma", ctrlKey: true, shiftKey: true }),
        settings,
        "other",
      ),
    ).toBe(false);
  });

  it("stays Cmd+Comma on macOS", () => {
    expect(
      matchesShortcut(press({ key: ",", code: "Comma", metaKey: true }), settings, "mac"),
    ).toBe(true);
    expect(
      matchesShortcut(press({ key: ",", code: "Comma", ctrlKey: true }), settings, "mac"),
    ).toBe(false);
  });

  it("finds the comma's physical key on a non-Latin layout", () => {
    expect(
      matchesShortcut(press({ key: "б", code: "Comma", ctrlKey: true }), settings, "other"),
    ).toBe(true);
  });

  it("labels it without Shift", () => {
    expect(shortcutLabel(settings, "other")).toBe("Ctrl+,");
    expect(shortcutLabel(settings, "mac")).toBe("⌘,");
  });
});

describe("shortcutLabel", () => {
  it("labels shortcuts for each platform", () => {
    expect(shortcutLabel(modK, "mac")).toBe("⌘K");
    expect(shortcutLabel(modK, "other")).toBe("Ctrl+Shift+K");
  });
});
