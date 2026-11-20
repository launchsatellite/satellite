import { describe, expect, it } from "vitest";
import { windowsPty } from "./pty.ts";

describe("windowsPty", () => {
  it("names the backend node-pty picks from the Windows build, and nothing elsewhere", () => {
    expect(windowsPty("win32", "10.0.22631")).toEqual({ backend: "conpty", buildNumber: 22631 });
    expect(windowsPty("win32", "10.0.17763")).toEqual({ backend: "winpty", buildNumber: 17763 });
    expect(windowsPty("win32", "10.0")).toBeNull();
    expect(windowsPty("darwin", "25.5.0")).toBeNull();
  });
});
