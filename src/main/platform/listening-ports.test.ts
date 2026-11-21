import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { lsofMacos, portsWindows, ssLinux } from "./process-fixtures.ts";
import {
  type ListeningPort,
  parseLsof,
  parseSs,
  parseWindowsPorts,
  readListeningPorts,
} from "./listening-ports.ts";

function of(ports: readonly ListeningPort[], pid: number): string[] {
  return ports
    .filter((port) => port.pid === pid)
    .map((port) => `${port.host} ${String(port.port)}`);
}

describe("parseLsof", () => {
  it("reads lsof fields into ports with the family deciding what a star means", () => {
    const ports = parseLsof(lsofMacos);
    expect(of(ports, 4203)).toEqual([":: 5173", "127.0.0.1 9229", "::1 9230"]);
    expect(of(ports, 4402)).toEqual(["192.168.1.20 8080", "0.0.0.0 8081"]);
  });
});

describe("parseSs", () => {
  it("reads ss lines, with a zone, a star, brackets and two owners", () => {
    const ports = parseSs(ssLinux);
    expect(of(ports, 2201)).toEqual(["127.0.0.1 3000", ":: 5173", "fe80::1 9000"]);
    expect(of(ports, 2203)).toEqual([":: 5173"]);
    expect(of(ports, 2300)).toEqual([":: 8080"]);
    expect(ports).toHaveLength(5);
  });
});

describe("parseWindowsPorts", () => {
  it("reads the Windows listeners, one object or many", () => {
    expect(of(parseWindowsPorts(portsWindows), 3201)).toEqual([
      "0.0.0.0 3000",
      ":: 3000",
      "192.168.1.20 8080",
      "::1 9229",
    ]);
    expect(parseWindowsPorts('{"a":"127.0.0.1","p":80,"o":7}')).toEqual([
      { pid: 7, host: "127.0.0.1", port: 80 },
    ]);
  });

  it("drops one bad listener and keeps the others", () => {
    const rows = `[{"a":null,"p":80,"o":7},{"a":"127.0.0.1","p":81,"o":7},3]`;
    expect(parseWindowsPorts(rows)).toEqual([{ pid: 7, host: "127.0.0.1", port: 81 }]);
  });
});

describe("unreadable output", () => {
  it("answers nothing for output it cannot read", () => {
    const parsers = [parseLsof, parseSs, parseWindowsPorts];
    const unreadable = [
      "",
      "nothing is listening here",
      "p10\nf3\ntIPv4\nn127.0.0.1:0",
      "p10\nf3\ntIPv4\nn127.0.0.1:70000",
      'LISTEN 0 1 127.0.0.1:0 0.0.0.0:* users:(("x",pid=5,fd=3))',
      'LISTEN 0 1 127.0.0.1:70000 0.0.0.0:* users:(("x",pid=5,fd=3))',
      '[{"a":"127.0.0.1","p":0,"o":5},{"a":"127.0.0.1","p":70000,"o":5},{"a":"nope","p":80,"o":5}]',
    ];
    for (const parse of parsers) {
      for (const text of unreadable) expect(parse(text)).toEqual([]);
    }
  });
});

describe("readListeningPorts", () => {
  it("answers nothing for no ids", async () => {
    expect(await readListeningPorts([])).toEqual([]);
  });

  it("reads the port a child of this test listens on", async () => {
    const script =
      "require('node:net').createServer().listen(0, '127.0.0.1', function () { console.log(this.address().port); }); setTimeout(() => {}, 30_000);";
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const port = await new Promise<number>((resolve) => {
        child.stdout.once("data", (data: Buffer) => {
          resolve(Number(data.toString().trim()));
        });
      });
      const ports = await readListeningPorts([child.pid ?? 0]);
      expect(ports).toContainEqual({ pid: child.pid, host: "127.0.0.1", port });
    } finally {
      child.kill("SIGKILL");
    }
  });
});
