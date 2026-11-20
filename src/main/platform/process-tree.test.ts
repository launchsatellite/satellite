import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { endUnixTree } from "./process-tree.ts";

const ignoresHangup = "process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")("endUnixTree", () => {
  it("ends a child that ignores SIGHUP and a grandchild that left the process group", async () => {
    const leader = spawn(process.execPath, ["-e", ignoresHangup], { detached: true });
    const escaped = spawn(
      process.execPath,
      [
        "-e",
        `const c = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(ignoresHangup)}], { detached: true, stdio: 'ignore' }); console.log(c.pid); ${ignoresHangup}`,
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    const grandchild = await new Promise<number>((resolve) => {
      escaped.stdout.once("data", (data: Buffer) => {
        resolve(Number(data.toString().trim()));
      });
    });
    const leaderPid = leader.pid ?? 0;
    const escapedPid = escaped.pid ?? 0;
    const exited = new Promise<void>((resolve) =>
      leader.once("exit", () => {
        resolve();
      }),
    );
    await Promise.all([
      endUnixTree(leaderPid, exited, 500),
      endUnixTree(escapedPid, new Promise<void>(() => undefined), 500),
    ]);
    await delay(100);
    expect(isAlive(leaderPid)).toBe(false);
    expect(isAlive(escapedPid)).toBe(false);
    expect(isAlive(grandchild)).toBe(false);
  });
});
