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
    };
    await settleForQuit(parts, 1000);
    expect(calls[0]).toBe("stop");
    expect(calls).toHaveLength(6);
  });
});
