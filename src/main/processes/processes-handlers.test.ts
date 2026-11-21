import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { processRow } from "../../shared/bridge-contract.ts";
import type { BridgeOwner } from "../bridge/registry.ts";
import { parseLsof } from "../platform/listening-ports.ts";
import { fixtureNow, lsofMacos, psMacos } from "../platform/process-fixtures.ts";
import { type ProcessEntry, parsePsTable, readProcessTable } from "../platform/process-table.ts";
import type { SessionRoot } from "./listed-processes.ts";
import { createProcesses, type RunningRoot } from "./processes-handlers.ts";

const project = "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6";
const sessionOne = "0b8f6a52-5f0e-4f3a-8c5e-1d2b3c4d5e6f";
const sessionTwo = "1c9a7b63-6a1f-4b4b-9d6f-2e3c4d5e6f70";
const rootStart = Date.UTC(2026, 10, 21, 10, 0, 0);

function fakeOwner(id: number): BridgeOwner {
  return { id, emit: () => undefined, onGone: () => undefined };
}

const pageOne = fakeOwner(1);
const pageTwo = fakeOwner(2);

function root(session: string, pid: number, spawnedAt = rootStart): SessionRoot {
  return { session, workspace: { projectId: project, workspace: "main" }, pid, spawnedAt };
}

function setup(
  options: {
    table?: ProcessEntry[];
    roots?: RunningRoot[];
    end?: (target: ProcessEntry) => Promise<void>;
  } = {},
) {
  let clock = fixtureNow;
  const table = options.table ?? parsePsTable(psMacos);
  const readTable = vi.fn(() => Promise.resolve(table));
  const readPorts = vi.fn(() => Promise.resolve(parseLsof(lsofMacos)));
  const end = vi.fn(options.end ?? (() => Promise.resolve()));
  const processes = createProcesses({
    roots: () => options.roots ?? [{ owner: pageOne, root: root(sessionOne, 4100) }],
    readTable,
    readPorts,
    end,
    now: () => clock,
  });
  return {
    list: (owner: BridgeOwner = pageOne) => processes.handlers["processes.list"]({}, owner),
    stop: (pid: number, started: number, owner: BridgeOwner = pageOne) =>
      processes.handlers["processes.stop"]({ pid, started }, owner),
    readTable,
    readPorts,
    end,
    table,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

function startOf(table: readonly ProcessEntry[], pid: number): number {
  const started = table.find((entry) => entry.pid === pid)?.started;
  if (started === undefined || started === null) throw new Error("no start");
  return started;
}

describe("processes.list", () => {
  it("lists rows with a hidden, cut command and the ports of the whole subtree", async () => {
    const table = parsePsTable(psMacos).map((entry) =>
      entry.pid === 4402
        ? { ...entry, command: `node worker.js --token ${"t".repeat(40)} ${"word ".repeat(80)}` }
        : entry,
    );
    const { list } = setup({ table });
    const answer = await list();
    expect(answer.at).toBe(fixtureNow);
    expect(answer.more).toBe(0);
    expect(answer.rows.map((row) => row.pid)).toEqual([4201, 4402]);
    expect(answer.rows[0]).toMatchObject({
      command: "npm run dev",
      cut: false,
      session: sessionOne,
      ports: [
        { port: 5173, url: "http://[::1]:5173/" },
        { port: 9229, url: "http://127.0.0.1:9229/" },
        { port: 9230, url: "http://[::1]:9230/" },
      ],
    });
    expect(answer.rows[1]?.command.startsWith("node worker.js --token ***")).toBe(true);
    expect(answer.rows[1]?.cut).toBe(true);
    for (const row of answer.rows) expect(processRow.safeParse(row).success).toBe(true);
  });

  it("shows a port bound elsewhere with no address", async () => {
    const { list } = setup();
    const answer = await list();
    expect(answer.rows[1]?.ports).toEqual([
      { port: 8080, url: null },
      { port: 8081, url: "http://127.0.0.1:8081/" },
    ]);
    const row = answer.rows[0];
    expect(
      processRow.safeParse({ ...row, ports: [{ port: 80, url: "http://example.com:80/" }] })
        .success,
    ).toBe(false);
  });

  it("reads no table while no session runs", async () => {
    const { list, stop, readTable } = setup({ roots: [] });
    expect(await list()).toEqual({ at: fixtureNow, rows: [], more: 0 });
    await expect(stop(4201, startOf(parsePsTable(psMacos), 4201))).rejects.toMatchObject({
      code: "not-found",
    });
    expect(readTable).not.toHaveBeenCalled();
  });

  it("reads no ports when nothing is listed", async () => {
    const { list, readPorts } = setup({ roots: [] });
    expect(await list()).toEqual({ at: fixtureNow, rows: [], more: 0 });
    expect(readPorts).not.toHaveBeenCalled();
  });

  it("reads the table once for callers that overlap and again after 2 seconds", async () => {
    const { list, readTable, tick } = setup();
    await Promise.all([list(), list(), list()]);
    expect(readTable).toHaveBeenCalledTimes(1);
    tick(1999);
    await list();
    expect(readTable).toHaveBeenCalledTimes(1);
    tick(1);
    await list();
    expect(readTable).toHaveBeenCalledTimes(2);
  });

  it("lists only the asking page's sessions", async () => {
    const second = parsePsTable(
      [
        psMacos,
        "8000 900 8000 S Sat Nov 21 10:01:00 2026 claude",
        "8001 8000 8001 S Sat Nov 21 10:02:00 2026 /bin/sh -c watch",
        "8002 8001 8001 S Sat Nov 21 10:02:01 2026 tsc --watch",
      ].join("\n"),
    );
    const roots = [
      { owner: pageOne, root: root(sessionOne, 4100) },
      { owner: pageTwo, root: root(sessionTwo, 8000, Date.UTC(2026, 10, 21, 10, 1, 0)) },
    ];
    const { list } = setup({ table: second, roots });
    expect((await list(pageOne)).rows.map((row) => row.pid)).toEqual([4201, 4402]);
    expect((await list(pageTwo)).rows.map((row) => row.pid)).toEqual([8002]);
    expect((await list(fakeOwner(3))).rows).toEqual([]);
  });
});

describe("processes.stop", () => {
  it("stops a listed process from a fresh table and never the cached one", async () => {
    const { list, stop, end, readTable, table } = setup();
    await list();
    readTable.mockResolvedValueOnce(parsePsTable(psMacos));
    await stop(4201, startOf(table, 4201));
    expect(end).toHaveBeenCalledTimes(1);
    expect(end.mock.calls[0]?.[0].pid).toBe(4201);
    await list();
    expect(readTable).toHaveBeenCalledTimes(3);
  });

  it("refuses an id that left the table, an id whose start changed and a process no session started, and ends nothing", async () => {
    const { stop, end, table } = setup();
    await expect(stop(9999, 1_000_000)).rejects.toMatchObject({ code: "not-found" });
    await expect(stop(4201, startOf(table, 4201) + 1000)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(stop(5000, startOf(table, 5000))).rejects.toMatchObject({ code: "not-found" });
    await expect(stop(4100, startOf(table, 4100))).rejects.toMatchObject({ code: "not-found" });
    await expect(stop(4200, startOf(table, 4200))).rejects.toMatchObject({ code: "not-found" });
    await expect(stop(4301, startOf(table, 4301))).rejects.toMatchObject({ code: "not-found" });
    await expect(stop(4201, startOf(table, 4201), pageTwo)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(end).not.toHaveBeenCalled();
  });

  it("refuses a second stop while one runs", async () => {
    const release = Promise.withResolvers<undefined>();
    const { stop, end, table } = setup({ end: () => release.promise });
    const first = stop(4201, startOf(table, 4201));
    await expect(stop(4402, startOf(table, 4402))).rejects.toMatchObject({ code: "limit" });
    release.resolve(undefined);
    await first;
    await stop(4402, startOf(table, 4402));
    expect(end).toHaveBeenCalledTimes(2);
  });

  it("stops nothing when the table cannot be read", async () => {
    const { stop, end, readTable, table } = setup();
    readTable.mockResolvedValueOnce([]);
    await expect(stop(4201, startOf(table, 4201))).rejects.toMatchObject({ code: "failed" });
    expect(end).not.toHaveBeenCalled();
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findChildOf(parent: number): Promise<ProcessEntry> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const found = (await readProcessTable()).find((entry) => entry.parent === parent);
    if (found !== undefined) return found;
    await delay(100);
  }
  throw new Error("the started process never showed in the table");
}

async function startOfPid(pid: number): Promise<number> {
  const started = (await readProcessTable()).find((entry) => entry.pid === pid)?.started;
  if (started === undefined || started === null) throw new Error("no start");
  return started;
}

describe.skipIf(process.platform === "win32")("with real processes", () => {
  it("stops what a session's shell started and refuses everything else", async () => {
    const idle = "setInterval(() => {}, 1000)";
    const shellCommand = '"$0" -e "$1"; exit $?';
    const rootScript = `const { spawn } = require('node:child_process'); const shell = spawn('/bin/sh', ['-c', ${JSON.stringify(shellCommand)}, process.execPath, ${JSON.stringify(idle)}], { stdio: 'ignore' }); console.log(shell.pid); ${idle};`;
    const sessionProgram = spawn(process.execPath, ["-e", rootScript], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const stranger = spawn(process.execPath, ["-e", idle], { stdio: "ignore" });
    const spawnedAt = Date.now();
    const programPid = sessionProgram.pid ?? 0;
    const strangerPid = stranger.pid ?? 0;
    let shellPid = 0;
    let serverPid = 0;
    try {
      shellPid = (await findChildOf(programPid)).pid;
      const server = await findChildOf(shellPid);
      serverPid = server.pid;
      const { handlers } = createProcesses({
        roots: () => [{ owner: pageOne, root: root(sessionOne, programPid, spawnedAt) }],
        now: () => Date.now() + 11_000,
      });
      const stop = (pid: number, started: number, owner = pageOne) =>
        handlers["processes.stop"]({ pid, started }, owner);
      const everyoneAlive = () =>
        [programPid, shellPid, serverPid, strangerPid].every((pid) => isAlive(pid));
      const refusals: [number, number, BridgeOwner, string][] = [
        [programPid, await startOfPid(programPid), pageOne, "not-found"],
        [shellPid, await startOfPid(shellPid), pageOne, "not-found"],
        [strangerPid, await startOfPid(strangerPid), pageOne, "not-found"],
        [process.pid, await startOfPid(process.pid), pageOne, "not-found"],
        [serverPid, await startOfPid(serverPid), pageTwo, "not-found"],
        [serverPid, (server.started ?? 0) + 1000, pageOne, "not-found"],
        [serverPid + 100_000, server.started ?? 0, pageOne, "not-found"],
      ];
      for (const [pid, started, owner, code] of refusals) {
        await expect(stop(pid, started, owner)).rejects.toMatchObject({ code });
        expect(everyoneAlive()).toBe(true);
      }
      await stop(serverPid, server.started ?? 0);
      for (let attempt = 0; attempt < 30 && isAlive(serverPid); attempt += 1) await delay(100);
      expect(isAlive(serverPid)).toBe(false);
      expect([programPid, strangerPid].every((pid) => isAlive(pid))).toBe(true);
    } finally {
      for (const pid of [serverPid, shellPid, programPid, strangerPid]) {
        if (pid > 1 && isAlive(pid)) process.kill(pid, "SIGKILL");
      }
    }
  }, 30_000);
});
