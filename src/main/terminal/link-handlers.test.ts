import { afterEach, describe, expect, it, vi } from "vitest";
import { createPageOwners } from "../bridge/page-owners.ts";
import { openInBrowser } from "../platform/browser.ts";
import { linkHandlers } from "./link-handlers.ts";

vi.mock("../platform/browser.ts", () => ({ openInBrowser: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(openInBrowser).mockReset();
});

describe("linkHandlers", () => {
  it("opens one link a second across the app and never a refused one", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const owner = createPageOwners<object>(() => undefined).ownerFor({});
    const handler = linkHandlers()["links.open"];
    const open = (request: { url: string }) => handler(request, owner);
    await expect(open({ url: "file:///etc/passwd" })).rejects.toMatchObject({ code: "refused" });
    await open({ url: "https://example.com/a" });
    vi.advanceTimersByTime(999);
    await expect(open({ url: "https://example.com/b" })).rejects.toMatchObject({ code: "limit" });
    vi.advanceTimersByTime(1);
    await open({ url: "https://example.com/c" });
    expect(vi.mocked(openInBrowser).mock.calls).toEqual([
      ["https://example.com/a"],
      ["https://example.com/c"],
    ]);
  });
});
