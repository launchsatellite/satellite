import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { psBusybox, psLinux, psMacos, tableWindows } from "./process-fixtures.ts";
import {
  type ProcessEntry,
  parsePsCommands,
  parsePsTable,
  parseWindowsCommands,
  parseWindowsTable,
  readCommands,
  readProcessTable,
  subtreeOf,
} from "./process-table.ts";

function entry(pid: number, parent: number, started: number | null): ProcessEntry {
  return {
    pid,
    parent,
    group: 0,
    identity: `${String(pid)} ${String(started)}`,
    started,
    defunct: false,
    name: "",
    command: "",
  };
}

function byPid(entries: readonly ProcessEntry[], pid: number): ProcessEntry {
  const found = entries.find((candidate) => candidate.pid === pid);
  if (found === undefined) throw new Error(`no process ${String(pid)}`);
  return found;
}

describe("parsePsTable", () => {
  it("parses the macOS table with a padded day, a defunct row and an escaped newline", () => {
    const entries = parsePsTable(psMacos);
    expect(entries).toHaveLength(16);
    expect(byPid(entries, 1).started).toBe(Date.UTC(2026, 10, 2, 8, 0, 0));
    expect(byPid(entries, 1).identity).toBe("1 Mon Nov 2 08:00:00 2026");
    expect(byPid(entries, 4401).defunct).toBe(true);
    expect(byPid(entries, 4402).defunct).toBe(false);
    expect(byPid(entries, 4402).command.endsWith(String.raw`one\012two`)).toBe(true);
    expect(byPid(entries, 4202)).toMatchObject({ parent: 4201, group: 4200, name: "sh" });
  });

  it("parses the Linux table with kernel threads and a defunct row", () => {
    const entries = parsePsTable(psLinux);
    expect(entries.map((candidate) => candidate.pid)).toEqual([1, 2, 2100, 2200, 2201, 2202]);
    expect(byPid(entries, 2).command).toBe("[kthreadd]");
    expect(byPid(entries, 2202).defunct).toBe(true);
    expect(byPid(entries, 2200).name).toBe("bash");
  });

  it("answers nothing for a busybox table", () => {
    expect(parsePsTable(psBusybox)).toEqual([]);
  });

  it("keeps a row whose start it cannot read with no start time", () => {
    const entries = parsePsTable("  77     1    77 S    Sat Foo 21 10:00:00 2026     node a.js");
    expect(entries).toHaveLength(1);
    expect(byPid(entries, 77).started).toBeNull();
  });

  it("drops every row of a process id that appears twice", () => {
    const entries = parsePsTable(
      [
        "  77     1    77 S    Sat Nov 21 10:00:00 2026     node a.js",
        "  78     1    78 S    Sat Nov 21 10:00:00 2026     node b.js",
        "  77     1    77 S    Sat Nov 21 10:00:01 2026     node forged.js",
      ].join("\n"),
    );
    expect(entries.map((candidate) => candidate.pid)).toEqual([78]);
  });

  it("reads the shell name from a path, a login shell and a Windows executable", () => {
    const row = (command: string) =>
      parsePsTable(`  77     1    77 S    Sat Nov 21 10:00:00 2026     ${command}`)[0]?.name;
    expect(row("/bin/zsh -c x")).toBe("zsh");
    expect(row("-zsh")).toBe("zsh");
    const windows = parseWindowsTable(
      '[{"p":9,"pp":1,"s":5,"n":"bash.exe","c":"\\"C:\\\\Git\\\\bash.exe\\" -c x"}]',
    );
    expect(windows[0]?.name).toBe("bash");
  });
});

describe("parseWindowsTable", () => {
  it("parses the Windows table, one object or many, and a process with no command line or start", () => {
    const entries = parseWindowsTable(tableWindows);
    expect(entries.map((candidate) => candidate.pid)).toEqual([4, 3100, 3200, 3201, 3300]);
    expect(byPid(entries, 3300).command).toBe("notepad.exe");
    expect(byPid(entries, 3201)).toMatchObject({ parent: 3200, name: "node", defunct: false });
    expect(byPid(entries, 3100).started).toBe(1795255200000);
    const one = parseWindowsTable('{"p":5,"pp":1,"s":null,"n":null,"c":null}');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ pid: 5, started: null, command: "", name: "" });
  });

  it("answers nothing for Windows output that is not the expected JSON", () => {
    expect(parseWindowsTable("")).toEqual([]);
    expect(parseWindowsTable("not json")).toEqual([]);
    expect(parseWindowsTable('{"p":"1"}')).toEqual([]);
  });

  it("drops one bad row and keeps the others", () => {
    const rows = `[{"p":7,"pp":1,"s":5,"n":"a","c":"a"},{"p":8,"pp":1,"s":1.5,"n":"b","c":"b"},null,{"p":9,"pp":1,"s":6,"n":"c","c":"c"}]`;
    expect(parseWindowsTable(rows).map((candidate) => candidate.pid)).toEqual([7, 9]);
  });
});

describe("subtreeOf", () => {
  it("walks a subtree once through links whose parent is not newer than the child", () => {
    const macos = parsePsTable(psMacos);
    expect(subtreeOf(byPid(macos, 4201), macos).map((candidate) => candidate.pid)).toEqual([
      4201, 4202, 4203,
    ]);
    const windows = parseWindowsTable(tableWindows);
    expect(subtreeOf(byPid(windows, 3201), windows).map((candidate) => candidate.pid)).toEqual([
      3201,
    ]);
    const loop = [entry(1000, 1001, 5), entry(1001, 1000, 5)];
    const [first = entry(0, 0, 0)] = loop;
    expect(subtreeOf(first, loop).map((candidate) => candidate.pid)).toEqual([1000]);
  });
});

describe("readProcessTable", () => {
  it("reads a child of this test from the real table", async () => {
    const marker = `satellite-table-${String(process.pid)}-${String(Date.now())}`;
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)", marker], {
      stdio: "ignore",
    });
    try {
      await new Promise<void>((resolve) => child.once("spawn", resolve));
      const found = (await readProcessTable()).find((candidate) => candidate.pid === child.pid);
      expect(found?.parent).toBe(process.pid);
      expect(found?.command.includes(marker)).toBe(false);
      expect(Math.abs((found?.started ?? 0) - Date.now())).toBeLessThan(5000);
      expect((await readCommands([child.pid ?? 0])).get(child.pid ?? 0)?.includes(marker)).toBe(
        true,
      );
    } finally {
      child.kill("SIGKILL");
    }
  });
});

describe("parsePsCommands", () => {
  it("reads each id with its command and cuts a very long one", () => {
    const commands = parsePsCommands(
      `  4203 node /srv/app/vite.js --port 5173\n 4402 node ${"x".repeat(5000)}\nnot a row\n`,
    );
    expect(commands.get(4203)).toBe("node /srv/app/vite.js --port 5173");
    expect(commands.get(4402)?.length).toBe(2000);
    expect(commands.size).toBe(2);
  });
});

describe("parseWindowsCommands", () => {
  it("keeps rows with a command and drops the rest", () => {
    const command = String.raw`node C:\srv\app\server.js`;
    const commands = parseWindowsCommands(
      JSON.stringify([
        { p: 3201, c: command },
        { p: 3300, c: null },
        { p: -4, c: "x" },
        { p: "7", c: "y" },
      ]),
    );
    expect([...commands]).toEqual([[3201, command]]);
    expect(parseWindowsCommands("not json").size).toBe(0);
  });
});
