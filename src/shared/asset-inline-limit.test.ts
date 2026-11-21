import { describe, expect, it } from "vitest";
import { assetInlineLimit } from "./asset-inline-limit.ts";
import { contentSecurityPolicy } from "./content-security-policy.ts";

describe("assetInlineLimit", () => {
  it("keeps every svg a file, so the policy needs no data source for images beyond what it has", () => {
    expect(assetInlineLimit("icons/rust.svg")).toBe(false);
    expect(assetInlineLimit("fonts/a.woff2")).toBeUndefined();
  });
});

describe("contentSecurityPolicy", () => {
  it("loads images and fonts from the app and data urls only and runs only the app's scripts", () => {
    const directives = contentSecurityPolicy("production").split("; ");
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("img-src 'self' data:");
    expect(directives).toContain("script-src 'self'");
    expect(directives).toContain("connect-src 'self'");
    expect(directives.join(" ")).not.toMatch(/unsafe-eval|https?:/);
  });
});
