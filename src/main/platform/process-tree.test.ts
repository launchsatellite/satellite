import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endUnixTree, endWindowsTree, forceKillGraceMs, treeKillBoundMs } from "./process-tree.ts";

const ignoresHangup = "process.on('SIGHUP', () => {}); setTimeout(() => {}, 60_000);";

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
    try {
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
    } finally {
      for (const pid of [leaderPid, escapedPid, grandchild]) {
        if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
      }
    }
  });
});

describe.skipIf(process.platform === "win32")("endWindowsTree", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives up on a taskkill that hangs, within the tree kill's own bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "satellite-taskkill-"));
    await mkdir(join(root, "System32"));
    const taskkill = join(root, "System32", "taskkill.exe");
    await writeFile(taskkill, "#!/bin/sh\nexec sleep 30\n");
    await chmod(taskkill, 0o755);
    vi.stubEnv("SystemRoot", root);
    const began = performance.now();
    await endWindowsTree(process.pid);
    expect(performance.now() - began).toBeLessThan(treeKillBoundMs - forceKillGraceMs + 500);
  }, 40_000);
});
