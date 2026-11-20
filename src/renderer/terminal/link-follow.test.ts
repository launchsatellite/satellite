import { describe, expect, it } from "vitest";
import { linkFollow } from "./link-follow.ts";

describe("linkFollow", () => {
  it("does nothing for a click without the modifier", () => {
    expect(linkFollow("https://example.com/docs", false)).toBeNull();
  });

  it("asks first for every link, so a hidden tail is seen before it opens", () => {
    expect(linkFollow("https://example.com/docs", true)).toEqual({
      ask: "https://example.com/docs",
    });
    expect(linkFollow("https://example.com.evil.example/login", true)).toEqual({
      ask: "https://example.com.evil.example/login",
    });
    expect(linkFollow("https://EXAMPLE.com", true)).toEqual({ ask: "https://example.com/" });
  });

  it("refuses text that is no address in the page, never sending it on", () => {
    expect(linkFollow("not a link", true)).toEqual({
      refuse: "Satellite opens only web addresses that start with http or https.",
    });
  });
});
