import { describe, expect, it } from "vitest";
import { fixtureNow, psMacos, tableWindows } from "../platform/process-fixtures.ts";
import { parsePsTable, parseWindowsTable } from "../platform/process-table.ts";
import {
  listedProcesses,
  minimumAgeMs,
  ownedProcess,
  rootSlackMs,
  type SessionRoot,
} from "./listed-processes.ts";

const project = "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6";
const rootStart = Date.UTC(2026, 10, 21, 10, 0, 0);

function root(
  pid: number,
  options: { session?: string; workspace?: string; spawnedAt?: number } = {},
): SessionRoot {
  return {
    session: options.session ?? "first",
    workspace: { projectId: project, workspace: options.workspace ?? "main" },
    pid,
    spawnedAt: options.spawnedAt ?? rootStart,
  };
}

function row(pid: number, parent: number, time: string, command: string): string {
  return `${String(pid)} ${String(parent)} ${String(pid)} S Sat Nov 21 ${time} 2026 ${command}`;
}

const macos = parsePsTable(psMacos);

function ids(table: ReturnType<typeof parsePsTable>, roots: readonly SessionRoot[], now: number) {
  return listedProcesses(table, roots, now).map((listed) => listed.entry.pid);
}

function startOf(pid: number): number {
  const started = macos.find((entry) => entry.pid === pid)?.started;
  if (started === undefined || started === null) throw new Error(`no start for ${String(pid)}`);
  return started;
}

describe("listedProcesses", () => {
  it("lists the command under the agent's shell and not the shell, the session's program or its helpers", () => {
    expect(ids(macos, [root(4100)], fixtureNow)).toEqual([4201, 4402]);
  });

  it("lists only the topmost process of a chain", () => {
    const listed = listedProcesses(macos, [root(4100)], fixtureNow);
    expect(listed.map((item) => item.entry.pid)).not.toContain(4202);
    expect(listed[0]?.subtree.map((entry) => entry.pid)).toEqual([4201, 4202, 4203]);
  });

  it("waits until a process is 10 seconds old", () => {
    expect(ids(macos, [root(4100)], fixtureNow)).not.toContain(4301);
    expect(ids(macos, [root(4100)], fixtureNow + 6000 - 1)).not.toContain(4301);
    expect(ids(macos, [root(4100)], fixtureNow + 6000)).toContain(4301);
    expect(minimumAgeMs).toBe(10_000);
  });

  it("skips a defunct process and one with no readable start", () => {
    expect(ids(macos, [root(4100)], fixtureNow)).not.toContain(4401);
    const unreadable = parsePsTable(
      psMacos.replace("Nov 21 10:06:01 2026     node", "Foo 21 10:06:01 2026     node"),
    );
    expect(ids(unreadable, [root(4100)], fixtureNow)).toEqual([4201]);
  });

  it("finds nothing for a process whose parent is gone", () => {
    expect(ids(macos, [root(4100)], fixtureNow)).not.toContain(5000);
  });

  it("drops a link to a parent that started after its child", () => {
    const windows = parseWindowsTable(tableWindows);
    const session = root(3100, { spawnedAt: 1795255200000 });
    const listed = listedProcesses(windows, [session], 1795255501000 + 60_000);
    expect(listed.map((item) => item.entry.pid)).toEqual([3201]);
    expect(listed[0]?.subtree.map((entry) => entry.pid)).toEqual([3201]);
  });

  it("lists under the first shell however deep the session's program sits", () => {
    const table = parsePsTable(
      [
        row(7000, 1, "10:00:00", "cmd /c claude.exe"),
        row(7001, 7000, "10:00:01", "claude"),
        row(7002, 7001, "10:01:00", "bash -c serve"),
        row(7003, 7002, "10:01:01", "node server.js"),
      ].join("\n"),
    );
    expect(ids(table, [root(7000)], fixtureNow)).toEqual([7003]);
  });

  it("ignores a root that started after Satellite spawned the session", () => {
    expect(ids(macos, [root(4100, { spawnedAt: rootStart - 10_000 })], fixtureNow)).toEqual([]);
    expect(
      ids(macos, [root(4100, { spawnedAt: rootStart - rootSlackMs + 1 })], fixtureNow),
    ).toEqual([4201, 4402]);
    expect(ids(macos, [root(4100, { spawnedAt: rootStart - 1000 })], fixtureNow)).toEqual([
      4201, 4402,
    ]);
  });

  it("names the session and workspace of each process, with two sessions", () => {
    const second = parsePsTable(
      [
        psMacos,
        row(8000, 900, "10:01:00", "claude"),
        row(8001, 8000, "10:02:00", "/bin/sh -c watch"),
        row(8002, 8001, "10:02:01", "tsc --watch"),
      ].join("\n"),
    );
    const listed = listedProcesses(
      second,
      [
        root(4100),
        root(8000, {
          session: "second",
          spawnedAt: Date.UTC(2026, 10, 21, 10, 1, 0),
          workspace: "5b1d1f56-3c2c-4a8f-9d51-7a3b1c2d4e5f",
        }),
      ],
      fixtureNow,
    );
    expect(
      listed.map((item) => [item.entry.pid, item.root.session, item.root.workspace.workspace]),
    ).toEqual([
      [8002, "second", "5b1d1f56-3c2c-4a8f-9d51-7a3b1c2d4e5f"],
      [4201, "first", "main"],
      [4402, "first", "main"],
    ]);
  });
});

describe("ownedProcess", () => {
  it("owns a listed process, its child and a young one", () => {
    const roots = [root(4100)];
    for (const pid of [4201, 4203, 4301]) {
      const owned = ownedProcess(macos, roots, pid, startOf(pid));
      expect(owned?.entry.pid).toBe(pid);
      expect(owned?.root.session).toBe("first");
    }
    expect(
      ownedProcess(macos, roots, 4201, startOf(4201))?.subtree.map((entry) => entry.pid),
    ).toEqual([4201, 4202, 4203]);
  });

  it("refuses the root, a helper, the agent's shell, a detached process and a stranger", () => {
    const roots = [root(4100)];
    for (const pid of [4100, 4110, 4111, 4200, 4300, 5000, 900, 5001, 1, 4401]) {
      expect(ownedProcess(macos, roots, pid, startOf(pid))).toBeUndefined();
    }
    expect(ownedProcess(macos, roots, 0, 1)).toBeUndefined();
    expect(ownedProcess(macos, roots, -4201, startOf(4201))).toBeUndefined();
    expect(ownedProcess(macos, roots, process.pid, Date.now())).toBeUndefined();
    expect(ownedProcess(macos, [], 4201, startOf(4201))).toBeUndefined();
    expect(
      ownedProcess(macos, [root(4100, { spawnedAt: 0 })], 4201, startOf(4201)),
    ).toBeUndefined();
  });

  it("refuses a right id with another start time", () => {
    expect(ownedProcess(macos, [root(4100)], 4201, startOf(4201) + 1000)).toBeUndefined();
    expect(ownedProcess(macos, [root(4100)], 4201, startOf(4201))).toBeDefined();
  });

  it("refuses an id owned by another session's root", () => {
    expect(ownedProcess(macos, [root(8000)], 4201, startOf(4201))).toBeUndefined();
  });
});
