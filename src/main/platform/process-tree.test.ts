import { type ChildProcess, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ProcessEntry, readProcessTable } from "./process-table.ts";
import {
  endSubtree,
  parseStartTicks,
  prepareLinux,
  windowsStopChunks,
  endUnixTree,
  endWindowsTree,
  forceKillGraceMs,
  subtreeStopBoundMs,
  treeKillBoundMs,
  StopNotConfirmed,
  StopRefused,
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

async function holdsLargeArguments(count: number): Promise<ChildProcess[]> {
  const argument = "a".repeat(100_000);
  const holders = Array.from({ length: count }, () =>
    spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 60_000);", ...Array.from({ length: 8 }, () => argument)],
      { stdio: "ignore" },
    ),
  );
  await Promise.all(
    holders.map((holder) => new Promise<void>((resolve) => holder.once("spawn", resolve))),
  );
  return holders;
}

describe.skipIf(process.platform === "win32")(
  "with processes that hold very large arguments",
  () => {
    it("still reads the table and ends a session's tree that left its group", async () => {
      const holders = await holdsLargeArguments(24);
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
      const escapedPid = escaped.pid ?? 0;
      try {
        const table = await readProcessTable();
        expect(table.some((entry) => entry.pid === escapedPid)).toBe(true);
        await endUnixTree(escapedPid, new Promise<void>(() => undefined), 500);
        await delay(100);
        expect(isAlive(escapedPid)).toBe(false);
        expect(isAlive(grandchild)).toBe(false);
      } finally {
        for (const pid of [escapedPid, grandchild, ...holders.map((holder) => holder.pid ?? 0)]) {
          if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
        }
      }
    }, 30_000);
  },
);

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
      await endSubtree({
        ...found,
        started: (found.started ?? 0) - 5000,
        identity: `${String(pid)} an earlier start`,
      });
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
        StopRefused,
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
      await expect(endSubtree(found, failing)).rejects.toBeInstanceOf(StopNotConfirmed);
    } finally {
      if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  it("fails when something of the subtree is still running after the signals", async () => {
    const stranger = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000);"], {
      stdio: "ignore",
    });
    const pid = stranger.pid ?? 0;
    try {
      const found = (await readProcessTable()).find((candidate) => candidate.pid === pid);
      expect(found).toBeDefined();
      if (found === undefined) return;
      const sendsNothing = () => Promise.resolve({ ready: true, send: () => Promise.resolve() });
      await expect(endSubtree(found, readProcessTable, sendsNothing)).rejects.toBeInstanceOf(
        StopNotConfirmed,
      );
    } finally {
      if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 15_000);

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

describe("parseStartTicks", () => {
  it("takes the start ticks after a name that holds spaces and brackets", () => {
    const rest = "S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 123456 20 21";
    expect(parseStartTicks(`4242 (Web (Content) x) ${rest}`)).toBe("123456");
    expect(parseStartTicks("garbage")).toBeNull();
    expect(parseStartTicks("1 (a) S 1")).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("prepareLinux", () => {
  async function sleeperEntry(): Promise<{ child: ChildProcess; entry: ProcessEntry }> {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000);"], {
      stdio: "ignore",
    });
    const entry = (await readProcessTable()).find((candidate) => candidate.pid === child.pid);
    if (entry === undefined) throw new Error("no entry");
    return { child, entry };
  }

  it("signals only while the start ticks still match the ones recorded", async () => {
    const { child, entry } = await sleeperEntry();
    try {
      let reads = 0;
      const changing = () => {
        reads += 1;
        return Promise.resolve(reads === 1 ? "100" : "101");
      };
      const delivery = await prepareLinux([entry], changing);
      expect(delivery.ready).toBe(true);
      await delivery.send("SIGKILL");
      await delay(100);
      expect(isAlive(entry.pid)).toBe(true);
      const steady = await prepareLinux([entry], () => Promise.resolve("100"));
      await steady.send("SIGKILL");
      await delay(200);
      expect(isAlive(entry.pid)).toBe(false);
    } finally {
      if (isAlive(entry.pid)) child.kill("SIGKILL");
    }
  });

  it("is not ready, and signals nothing, where the start ticks cannot be read", async () => {
    const { child, entry } = await sleeperEntry();
    try {
      const delivery = await prepareLinux([entry], () => Promise.resolve(null));
      expect(delivery.ready).toBe(false);
      await delivery.send("SIGKILL");
      await delay(100);
      expect(isAlive(entry.pid)).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
  });
});

describe("windowsStopChunks", () => {
  function member(pid: number, started: number | null): ProcessEntry {
    return {
      pid,
      parent: 0,
      group: 0,
      identity: "",
      started,
      defunct: false,
      name: "",
      command: "",
    };
  }

  it("passes numbers only, drops rows it cannot prove and bounds each run", () => {
    const members = [
      member(10, 1_000),
      member(11, null),
      member(Number.NaN, 5),
      member(12, 2.5),
      ...Array.from({ length: 450 }, (_, index) => member(100 + index, 9_000)),
    ];
    const chunks = windowsStopChunks(members);
    expect(chunks.map((chunk) => chunk.split(",").length)).toEqual([200, 200, 51]);
    expect(chunks.join(",")).toMatch(/^(\d+:\d+)(,\d+:\d+)*$/);
    expect(chunks[0]?.startsWith("10:1000,100:9000")).toBe(true);
  });
});
