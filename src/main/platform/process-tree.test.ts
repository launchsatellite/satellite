import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ProcessEntry, readProcessTable } from "./process-table.ts";
import {
  type Delivery,
  type Prepare,
  endSubtree,
  parseStartTicks,
  prepareLinux,
  windowsStopChunks,
  endUnixTree,
  endWindowsChild,
  endWindowsTree,
  subtreeStopBoundMs,
  StopNotConfirmed,
  StopRefused,
} from "./process-tree.ts";
import { guardSignals, type SignalGuard } from "./signal-guard.test-fixture.ts";

const ignoresHangup = "process.on('SIGHUP', () => {}); setTimeout(() => {}, 60_000);";

let guard: SignalGuard;

beforeEach(() => {
  guard = guardSignals();
});

afterEach(() => {
  guard.restore();
  expect(guard.strays).toEqual([]);
});

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
    guard.own(leaderPid, escapedPid, grandchild);
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
        guard.cleanUp(pid);
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
      guard.own(escapedPid, grandchild, ...holders.map((holder) => holder.pid ?? 0));
      try {
        const table = await readProcessTable();
        expect(table.some((entry) => entry.pid === escapedPid)).toBe(true);
        await endUnixTree(escapedPid, new Promise<void>(() => undefined), 500);
        await delay(100);
        expect(isAlive(escapedPid)).toBe(false);
        expect(isAlive(grandchild)).toBe(false);
      } finally {
        for (const pid of [escapedPid, grandchild, ...holders.map((holder) => holder.pid ?? 0)]) {
          guard.cleanUp(pid);
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
    guard.own(targetPid, grandchild);
    try {
      const table = await readProcessTable();
      const entry = table.find((candidate) => candidate.pid === targetPid);
      expect(entry).toBeDefined();
      if (entry === undefined) return;
      await endSubtree(entry, readProcessTable, guard.prepare);
      await delay(100);
      expect(isAlive(targetPid)).toBe(false);
      expect(isAlive(grandchild)).toBe(false);
      expect(isAlive(process.pid)).toBe(true);
      expect(isAlive(parent.pid ?? 0)).toBe(true);
      expect(isAlive(sibling.pid ?? 0)).toBe(true);
    } finally {
      for (const pid of [targetPid, grandchild, parent.pid ?? 0, sibling.pid ?? 0]) {
        guard.cleanUp(pid);
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
      await endSubtree(
        {
          ...found,
          started: (found.started ?? 0) - 5000,
          identity: `${String(pid)} an earlier start`,
        },
        readProcessTable,
        guard.prepare,
      );
      await delay(100);
      expect(isAlive(pid)).toBe(true);
    } finally {
      guard.cleanUp(pid);
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
      await expect(
        endSubtree(found, () => Promise.resolve([]), guard.prepare),
      ).rejects.toBeInstanceOf(StopRefused);
      await delay(100);
      expect(isAlive(pid)).toBe(true);
    } finally {
      guard.cleanUp(pid);
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
      guard.own(pid);
      await expect(endSubtree(found, failing, guard.prepare)).rejects.toBeInstanceOf(
        StopNotConfirmed,
      );
    } finally {
      guard.cleanUp(pid);
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
      const sendsNothing = () =>
        Promise.resolve({ ready: true, starts: new Map(), send: () => Promise.resolve() });
      await expect(endSubtree(found, readProcessTable, sendsNothing)).rejects.toBeInstanceOf(
        StopNotConfirmed,
      );
    } finally {
      guard.cleanUp(pid);
    }
  }, 15_000);

  it("kills a child that ignores SIGTERM once the grace is over", async () => {
    const stubborn = "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60_000);";
    const { child: target, grandchild } = await startedProcess(parentWithChild(stubborn));
    const targetPid = target.pid ?? 0;
    guard.own(targetPid, grandchild);
    try {
      const table = await readProcessTable();
      const entry = table.find((candidate) => candidate.pid === targetPid);
      expect(entry).toBeDefined();
      if (entry === undefined) return;
      const began = performance.now();
      await endSubtree(entry, readProcessTable, guard.prepare);
      await delay(100);
      expect(isAlive(grandchild)).toBe(false);
      expect(performance.now() - began).toBeLessThan(subtreeStopBoundMs + 500);
    } finally {
      for (const pid of [targetPid, grandchild]) {
        guard.cleanUp(pid);
      }
    }
  }, 15_000);
});

describe("endWindowsTree", () => {
  function entry(pid: number, parent: number, started: number): ProcessEntry {
    return {
      pid,
      parent,
      group: 0,
      identity: "",
      started,
      defunct: false,
      name: "",
      command: "",
    };
  }

  async function ended(pid: number, table: ProcessEntry[]): Promise<number[] | undefined> {
    let members: number[] | undefined;
    await endWindowsTree(
      pid,
      () => Promise.resolve(table),
      (found) => {
        members = found.map((member) => member.pid);
        return Promise.resolve({ ready: true, starts: new Map(), send: () => Promise.resolve() });
      },
    );
    return members;
  }

  it("ends only the root and what it started, never an older process holding its id as parent", async () => {
    const table = [
      entry(10, 1, 5_000),
      entry(50, 10, 10_000),
      entry(51, 50, 11_000),
      entry(52, 51, 12_000),
      entry(60, 50, 4_000),
      entry(61, 60, 4_500),
    ];
    expect(await ended(50, table)).toEqual([50, 51, 52]);
  });

  it("ends nothing when the root is no longer in the table", async () => {
    expect(await ended(50, [entry(10, 1, 5_000), entry(60, 50, 4_000)])).toBeUndefined();
  });
});

describe("endWindowsChild", () => {
  function child(exitCode: number | null = null) {
    let kills = 0;
    return {
      own: { pid: 50, exitCode, signalCode: null, kill: () => ++kills > 0 },
      kills: () => kills,
    };
  }

  it("ends a running child through its own handle when the tree stop could not", async () => {
    const running = child();
    const asked: number[] = [];
    await endWindowsChild(running.own, (pid) => {
      asked.push(pid);
      return Promise.resolve();
    });
    expect(asked).toEqual([50]);
    expect(running.kills()).toBe(1);
  });

  it("ends a running child even when the tree stop throws", async () => {
    const running = child();
    await endWindowsChild(running.own, () => Promise.reject(new Error("no table")));
    expect(running.kills()).toBe(1);
  });

  it("never touches a child that already exited, since its id may be another process's", async () => {
    const exited = child(0);
    let asked = false;
    await endWindowsChild(exited.own, () => {
      asked = true;
      return Promise.resolve();
    });
    expect(asked).toBe(false);
    expect(exited.kills()).toBe(0);
  });
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
    guard.own(entry.pid);
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

  it("compares every round with the start ticks recorded in the first", async () => {
    const { child, entry } = await sleeperEntry();
    try {
      const first = await prepareLinux([entry], () => Promise.resolve("100"));
      const later = await prepareLinux([entry], () => Promise.resolve("101"), first);
      expect(later.starts.get(entry.pid)).toBe("100");
      await later.send("SIGKILL");
      await delay(100);
      expect(isAlive(entry.pid)).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("never signals in a later round a member the first round recorded no ticks for", async () => {
    const { child, entry } = await sleeperEntry();
    try {
      const first = await prepareLinux([entry], () => Promise.resolve(null));
      const later = await prepareLinux([entry], () => Promise.resolve("100"), first);
      expect(later.starts.has(entry.pid)).toBe(false);
      await later.send("SIGKILL");
      await delay(100);
      expect(isAlive(entry.pid)).toBe(true);
    } finally {
      child.kill("SIGKILL");
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

describe("endSubtree on a fake table", () => {
  function member(pid: number, parent: number, started: number, defunct = false): ProcessEntry {
    return {
      pid,
      parent,
      group: 0,
      identity: `${String(pid)} ${String(started)}`,
      started,
      defunct,
      name: "",
      command: "",
    };
  }

  const target = member(50, 10, 10_000);
  const above = member(10, 1, 5_000);

  function recording() {
    const deliveries: Delivery[] = [];
    const prepare = vi.fn<Prepare>((members) => {
      const delivery: Delivery = {
        ready: true,
        starts: new Map(members.map((entry) => [entry.pid, "1"])),
        send: () => Promise.resolve(),
      };
      deliveries.push(delivery);
      return Promise.resolve(delivery);
    });
    return { prepare, deliveries };
  }

  it("refuses and signals nothing when the delivery cannot prove who it reaches", async () => {
    const send = vi.fn(() => Promise.resolve());
    await expect(
      endSubtree(
        target,
        () => Promise.resolve([above, target]),
        () => Promise.resolve({ ready: false, starts: new Map(), send }),
      ),
    ).rejects.toBeInstanceOf(StopRefused);
    expect(send).not.toHaveBeenCalled();
  });

  it("passes the first delivery to the force round, so it compares with the first starts", async () => {
    const { prepare, deliveries } = recording();
    await expect(
      endSubtree(target, () => Promise.resolve([above, target]), prepare),
    ).rejects.toBeInstanceOf(StopNotConfirmed);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1]?.[1]).toBe(deliveries[0]);
  }, 10_000);

  it("never hands this process or process 1 to a delivery, even through a parent cycle", async () => {
    const { prepare } = recording();
    const table = [
      above,
      target,
      member(process.pid, 50, 11_000),
      member(1, 50, 11_000),
      member(60, 1, 12_000),
    ];
    let reads = 0;
    await endSubtree(
      target,
      () => {
        reads += 1;
        return Promise.resolve(reads === 1 ? table : [above]);
      },
      prepare,
    );
    const members = prepare.mock.calls.flatMap(([found]) => found.map((entry) => entry.pid));
    expect(members).toContain(50);
    expect(members).not.toContain(process.pid);
    expect(members).not.toContain(1);
  });

  it("counts a member that is only defunct after the signal as ended", async () => {
    const { prepare } = recording();
    let reads = 0;
    await expect(
      endSubtree(
        target,
        () => {
          reads += 1;
          return Promise.resolve(
            reads === 1 ? [above, target] : [above, member(50, 10, 10_000, true)],
          );
        },
        prepare,
      ),
    ).resolves.toBeUndefined();
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
