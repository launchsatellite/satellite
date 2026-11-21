import { describe, expect, it } from "vitest";
import { holdsHiddenText, holdsRevealedText, promptText } from "./prompt-text.ts";
import { visibleText } from "./visible-text.ts";

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

  it("cuts long text to what Claude Code shows before folding a paste, on a whole character", () => {
    expect(promptText("b".repeat(800))).toBe("b".repeat(800));
    expect(promptText("b".repeat(2400))).toBe("b".repeat(800));
    expect(promptText(`${"a".repeat(799)}\u{1f469}`)).toBe("a".repeat(799));
    expect(promptText(`${"a".repeat(797)}\u{1f469}\u{200d}\u{1f4bb}`)).toBe(
      `${"a".repeat(797)}\u{1f469}`,
    );
    expect(promptText(`${"\u{7}".repeat(5000)}${"c".repeat(4000)}`)).toBe("c".repeat(800));
  });
});

describe("promptText bounds", () => {
  it("reads only a bounded start of a huge input", () => {
    expect(promptText(`${"\u{7}".repeat(20_000)}c`)).toBe("");
  });

  it("keeps the joiners Persian and Indic words are written with", () => {
    const persian = "\u{645}\u{6cc}\u{200c}\u{634}\u{648}\u{62f}";
    const hindi = "\u{915}\u{94d}\u{200d}\u{937}";
    expect(promptText(persian)).toBe(persian);
    expect(promptText(hindi)).toBe(hindi);
    expect(holdsHiddenText(`${persian}.png`)).toBe(false);
    expect(promptText("a\u{200c}b\u{200d}c")).toBe("abc");
    expect(promptText("\u{200c}\u{634}")).toBe("\u{634}");
    expect(promptText("\u{634}\u{61c}\u{200c}\u{634}")).toBe("\u{634}\u{634}");
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

  it("refuses every character the diff reveals and every one the prompt would change", () => {
    const refused: number[] = [];
    for (let point = 0; point <= 0x10ffff; point += 1) {
      if (point >= 0xd800 && point <= 0xdfff) continue;
      const text = `a${String.fromCodePoint(point)}b`;
      const hides = visibleText(text) !== text;
      if (hides) refused.push(point);
      expect(holdsRevealedText(text), `U+${point.toString(16)}`).toBe(hides);
      if (promptText(text) !== text) expect(hides, `U+${point.toString(16)}`).toBe(true);
    }
    for (const point of [0x3164, 0xffa0, 0x115f, 0x2800, 0xfe00, 0x34f, 0xa0, 0x3000, 0xfffc]) {
      expect(refused).toContain(point);
    }
  });

  it("refuses a name written like a revealed character", () => {
    expect(holdsRevealedText("[U+202E]x")).toBe(true);
  });
});
