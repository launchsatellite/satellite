import { describe, expect, it } from "vitest";
import { settleForQuit, type QuitParts } from "./quit-settle.ts";

describe("settleForQuit", () => {
  it("stops notifications before any session ends", async () => {
    const calls: string[] = [];
    const work = (name: string) => () => {
      calls.push(name);
      return Promise.resolve();
    };
    const parts: QuitParts = {
      notices: {
        stop: () => {
          calls.push("stop");
        },
      },
      terminals: { closeAll: work("closeAll") },
      last: { flush: work("last") },
      interfaceFile: { flush: work("interface") },
      workspaces: { stopAll: work("workspaces") },
      projects: { flush: work("projects") },
      recorder: { flush: work("recorder") },
    };
    await settleForQuit(parts, 1000);
    expect(calls[0]).toBe("stop");
    expect(calls).toHaveLength(7);
  });

  it("waits for the recorded notification lines once every session ended, within the bound", async () => {
    const calls: string[] = [];
    let endSessions: () => void = () => undefined;
    const parts: QuitParts = {
      notices: { stop: () => undefined },
      terminals: {
        closeAll: () =>
          new Promise<void>((resolve) => {
            endSessions = () => {
              calls.push("ended");
              resolve();
            };
          }),
      },
      last: { flush: () => Promise.resolve() },
      interfaceFile: { flush: () => Promise.resolve() },
      workspaces: { stopAll: () => Promise.resolve() },
      projects: { flush: () => Promise.resolve() },
      recorder: {
        flush: () => {
          calls.push("recorded");
          return new Promise<void>(() => undefined);
        },
      },
    };
    const settled = settleForQuit(parts, 50);
    await Promise.resolve();
    endSessions();
    await settled;
    expect(calls).toEqual(["ended", "recorded"]);
  });
});
