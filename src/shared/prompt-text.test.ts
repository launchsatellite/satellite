import { describe, expect, it } from "vitest";
import { holdsHiddenText, promptText, promptTextLimit } from "./prompt-text.ts";

describe("promptText", () => {
  it("never leaves a way to submit", () => {
    expect(promptText("fix it\r\nnow\rthen\nend")).toBe("fix it now then end");
    expect(promptText("a\tb\u{2028}c\u{2029}d\u{b}e\u{c}f")).toBe("a b c def");
  });

  it("removes escapes so a paste cannot end early", () => {
    expect(promptText("a\u{1b}[201~\rb")).toBe("a[201~ b");
    expect(promptText("a\u{9b}201~\u{1b}\r\u{0}b")).toBe("a201~ b");
  });

  it("removes bell, delete, C1 and direction marks", () => {
    expect(promptText("\u{7}x\u{7f}\u{85}\u{202e}y\u{2066}")).toBe("xy");
    expect(promptText("\u{61c}x\u{200e}\u{200f}\u{202a}\u{202d}\u{2069}y")).toBe("xy");
  });

  it("removes characters that hide text, while emoji keep their joiners", () => {
    expect(promptText("a\u{200b}b\u{200d}c\u{2060}d\u{feff}e\u{ad}f")).toBe("abcdef");
    expect(promptText("ok\u{e0001}\u{e0069}\u{e0067}\u{e006e}\u{e007f}")).toBe("ok");
    expect(promptText("x\u{e0100}\u{e01ef}y")).toBe("xy");
    expect(
      promptText("\u{1f469}\u{1f3fd}\u{200d}\u{1f4bb} \u{2764}\u{fe0f}\u{200d}\u{1f525}"),
    ).toBe("\u{1f469}\u{1f3fd}\u{200d}\u{1f4bb} \u{2764}\u{fe0f}\u{200d}\u{1f525}");
    expect(promptText("\u{1f469}\u{200d}x \u{200d}\u{1f4bb}")).toBe("\u{1f469}x \u{1f4bb}");
    expect(promptText("a\u{d800}b\u{dc00}c")).toBe("abc");
  });

  it("keeps unicode text whole", () => {
    const text = "r\u{e9}sum\u{e9} \u{65e5}\u{672c} \u{1f469}\u{200d}\u{1f4bb}";
    expect(promptText(text)).toBe(text);
  });

  it("cuts long text on a whole character", () => {
    expect(promptText(`${"a".repeat(3999)}\u{1f469}`)).toBe("a".repeat(3999));
    expect(promptText(`${"a".repeat(3997)}\u{1f469}\u{200d}\u{1f4bb}`)).toBe(
      `${"a".repeat(3997)}\u{1f469}`,
    );
    expect(promptText("b".repeat(promptTextLimit * 3))).toHaveLength(promptTextLimit);
    expect(promptText(`${"\u{7}".repeat(5000)}${"c".repeat(4000)}`)).toBe("c".repeat(4000));
  });
});

describe("holdsHiddenText", () => {
  it("finds every character a prompt would lose", () => {
    for (const text of [
      "a\nb",
      "a\u{1b}b",
      "a\u{85}b",
      "a\u{2028}b",
      "\u{202e}gnp",
      "a\u{200b}b",
    ]) {
      expect(holdsHiddenText(text), JSON.stringify(text)).toBe(true);
    }
    expect(holdsHiddenText("r\u{e9}sum\u{e9} \u{1f469}\u{200d}\u{1f4bb}.png")).toBe(false);
  });
});
