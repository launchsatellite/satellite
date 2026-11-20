import { describe, expect, it } from "vitest";
import { isAllowedSender } from "./sender-check.ts";

const appOrigin = "app://satellite";

describe("isAllowedSender", () => {
  it("accepts the main frame on the app origin", () => {
    expect(isAllowedSender("app://satellite/index.html", true, appOrigin)).toBe(true);
    expect(isAllowedSender("http://localhost:5173/", true, "http://localhost:5173")).toBe(true);
  });

  it("refuses a different host", () => {
    expect(isAllowedSender("app://satellite.evil/index.html", true, appOrigin)).toBe(false);
    expect(isAllowedSender("app://other/index.html", true, appOrigin)).toBe(false);
  });

  it("refuses a different port", () => {
    expect(isAllowedSender("app://satellite:80/index.html", true, appOrigin)).toBe(false);
    expect(isAllowedSender("http://localhost:5174/", true, "http://localhost:5173")).toBe(false);
  });

  it("refuses user info in the url", () => {
    expect(isAllowedSender("app://user:pw@satellite/index.html", true, appOrigin)).toBe(false);
    expect(isAllowedSender("app://user@satellite/index.html", true, appOrigin)).toBe(false);
  });

  it("refuses about, data and file pages", () => {
    for (const url of [
      "about:blank",
      "data:text/html,<p>hi</p>",
      "file:///satellite/index.html",
      "blob:app://satellite/6f1c2a7e",
      "",
    ]) {
      expect(isAllowedSender(url, true, appOrigin)).toBe(false);
    }
  });

  it("refuses a subframe even on the app origin", () => {
    expect(isAllowedSender("app://satellite/index.html", false, appOrigin)).toBe(false);
  });
});
