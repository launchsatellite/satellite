import { describe, expect, it } from "vitest";
import { secureWebPreferences } from "./web-preferences.ts";

describe("secureWebPreferences", () => {
  it("keeps the renderer sandboxed and isolated, with no Node and no webview", () => {
    expect(secureWebPreferences("preload.cjs")).toStrictEqual({
      preload: "preload.cjs",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    });
  });
});
