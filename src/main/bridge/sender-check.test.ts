import { describe, expect, it } from "vitest";
import { isAllowedSender, isTrustedSender } from "./sender-check.ts";

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

describe("isTrustedSender", () => {
  const mainFrame = { url: "app://satellite/index.html" };

  it("trusts the main frame of the app page", () => {
    expect(isTrustedSender({ senderFrame: mainFrame, sender: { mainFrame } }, appOrigin)).toBe(
      true,
    );
  });

  it("refuses a subframe on the app origin", () => {
    const subframe = { url: "app://satellite/index.html" };
    expect(isTrustedSender({ senderFrame: subframe, sender: { mainFrame } }, appOrigin)).toBe(
      false,
    );
  });

  it("refuses a main frame that left the app origin", () => {
    const away = { url: "https://example.com/" };
    expect(isTrustedSender({ senderFrame: away, sender: { mainFrame: away } }, appOrigin)).toBe(
      false,
    );
  });

  it("refuses a frame that is already gone", () => {
    expect(isTrustedSender({ senderFrame: null, sender: { mainFrame } }, appOrigin)).toBe(false);
    const destroyed = {
      get senderFrame(): { url: string } {
        throw new Error("Render frame was disposed before WebFrameMain could be accessed");
      },
      sender: { mainFrame },
    };
    expect(isTrustedSender(destroyed, appOrigin)).toBe(false);
  });
});
