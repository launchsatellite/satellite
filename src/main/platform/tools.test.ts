import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseToolOverride, runTool } from "./tools.ts";

vi.mock("./user-environment.ts", () => ({
  userEnvironment: () =>
    Promise.resolve(
      Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    ),
}));

const leavesAChild = `
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
require("node:fs").writeFileSync(process.argv[1], String(child.pid));
setInterval(() => {}, 1000);
`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseToolOverride", () => {
  it("reads a JSON array override as executable and leading arguments", () => {
    expect(
      parseToolOverride("SATELLITE_GH", '["/opt/tools/bin/node","/opt/stand-ins/gh.ts"]'),
    ).toEqual({ file: "/opt/tools/bin/node", args: ["/opt/stand-ins/gh.ts"] });
    expect(parseToolOverride("SATELLITE_CLAUDE", '["/opt/tools/bin/claude"]')).toEqual({
      file: "/opt/tools/bin/claude",
      args: [],
    });
  });

  it("refuses an override that is not a non-empty array of strings and names the variable", () => {
    for (const value of ["/opt/tools/bin/gh", "[]", '[""]', "[1]", '{"file":"gh"}', "["]) {
      expect(() => parseToolOverride("SATELLITE_GH", value)).toThrow(/SATELLITE_GH/);
    }
  });
});

describe("runTool", () => {
  it("ends the whole process tree of a tool that runs past its time limit", async () => {
    const folder = await mkdtemp(join(tmpdir(), "satellite-tools-"));
    const pidFile = join(folder, "child.pid");
    vi.stubEnv("SATELLITE_GH", JSON.stringify([process.execPath, "-e", leavesAChild]));
    let child = 0;
    try {
      const running = runTool("gh", [pidFile], { timeoutMs: 1000 });
      await expect(running).rejects.toThrow("gh did not finish in time");
      child = Number(await readFile(pidFile, "utf8"));
      await delay(200);
      expect(isAlive(child)).toBe(false);
    } finally {
      if (child > 0 && isAlive(child)) process.kill(child, "SIGKILL");
      await rm(folder, { recursive: true, force: true });
    }
  }, 15_000);
});
