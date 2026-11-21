import { type ChildProcess, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProcessTable } from "./process-table.ts";
import {
  endSubtree,
  endUnixTree,
  endWindowsTree,
  forceKillGraceMs,
  subtreeStopBoundMs,
  treeKillBoundMs,
  UnreadableTable,
} from "./process-tree.ts";

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

function startedProcess(script: string): Promise<{ child: ChildProcess; grandchild: number }> {
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  return new Promise((resolve) => {
    child.stdout.once("data", (data: Buffer) => {
      resolve({ child, grandchild: Number(data.toString().trim()) });
    });
  });
}

const parentWithChild = (childScript: string) =>
  `const c = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' }); console.log(c.pid); setTimeout(() => {}, 60_000);`;

describe.skipIf(process.platform === "win32")("endSubtree", () => {
  it("ends a process and its child and leaves its parent and its sibling running", async () => {
    const sleeper = "setTimeout(() => {}, 60_000);";
    const parent = spawn(process.execPath, ["-e", sleeper], { stdio: "ignore" });
    const sibling = spawn(process.execPath, ["-e", sleeper], { stdio: "ignore" });
    const { child: target, grandchild } = await startedProcess(parentWithChild(sleeper));
    const targetPid = target.pid ?? 0;
    try {
      const table = await readProcessTable();
      const entry = table.find((candidate) => candidate.pid === targetPid);
      expect(entry).toBeDefined();
      if (entry === undefined) return;
      await endSubtree(entry);
      await delay(100);
      expect(isAlive(targetPid)).toBe(false);
      expect(isAlive(grandchild)).toBe(false);
      expect(isAlive(process.pid)).toBe(true);
      expect(isAlive(parent.pid ?? 0)).toBe(true);
      expect(isAlive(sibling.pid ?? 0)).toBe(true);
    } finally {
      for (const pid of [targetPid, grandchild, parent.pid ?? 0, sibling.pid ?? 0]) {
        if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
      }
    }
  });

  it("signals nothing when the process in the fresh table has another start", async () => {
    const stranger = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000);"], {
      stdio: "ignore",
    });
    const pid = stranger.pid ?? 0;
    try {
      const found = (await readProcessTable()).find((candidate) => candidate.pid === pid);
      expect(found).toBeDefined();
      if (found === undefined) return;
      await endSubtree({ ...found, identity: `${String(pid)} an earlier start` });
      await delay(100);
      expect(isAlive(pid)).toBe(true);
    } finally {
      if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  it("signals nothing and fails when the fresh table cannot be read", async () => {
    const stranger = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000);"], {
      stdio: "ignore",
    });
    const pid = stranger.pid ?? 0;
    try {
      const found = (await readProcessTable()).find((candidate) => candidate.pid === pid);
      expect(found).toBeDefined();
      if (found === undefined) return;
      await expect(endSubtree(found, () => Promise.resolve([]))).rejects.toBeInstanceOf(
        UnreadableTable,
      );
      await delay(100);
      expect(isAlive(pid)).toBe(true);
    } finally {
      if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  it("fails instead of claiming success when the read after the signal cannot be read", async () => {
    const stranger = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000);"], {
      stdio: "ignore",
    });
    const pid = stranger.pid ?? 0;
    try {
      const found = (await readProcessTable()).find((candidate) => candidate.pid === pid);
      expect(found).toBeDefined();
      if (found === undefined) return;
      let reads = 0;
      const failing = async () => {
        reads += 1;
        return reads === 1 ? readProcessTable() : [];
      };
      await expect(endSubtree(found, failing)).rejects.toBeInstanceOf(UnreadableTable);
    } finally {
      if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  it("kills a child that ignores SIGTERM once the grace is over", async () => {
    const stubborn = "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60_000);";
    const { child: target, grandchild } = await startedProcess(parentWithChild(stubborn));
    const targetPid = target.pid ?? 0;
    try {
      const table = await readProcessTable();
      const entry = table.find((candidate) => candidate.pid === targetPid);
      expect(entry).toBeDefined();
      if (entry === undefined) return;
      const began = performance.now();
      await endSubtree(entry);
      await delay(100);
      expect(isAlive(grandchild)).toBe(false);
      expect(performance.now() - began).toBeLessThan(subtreeStopBoundMs + 500);
    } finally {
      for (const pid of [targetPid, grandchild]) {
        if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
      }
    }
  }, 15_000);
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
