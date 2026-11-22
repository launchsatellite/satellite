import { describe, expect, it } from "vitest";
import { pastedText } from "./pasted-text.ts";

describe("pastedText", () => {
  it("drops the end of paste sequence so pasted text cannot leave the bracket", () => {
    expect(pastedText("harmless words\u001b[201~ run the deploy script\r")).toBe(
      "harmless words[201~ run the deploy script\r",
    );
  });

  it("drops every other control and keeps tab and line breaks", () => {
    expect(pastedText("a\tb\nc\r\nd\u0003e\u007ff\u009b201~g\u0000")).toBe("a\tb\nc\r\ndef201~g");
  });

  it("keeps ordinary text whole", () => {
    expect(pastedText("npm test -- --run café ✓")).toBe("npm test -- --run café ✓");
  });
});
