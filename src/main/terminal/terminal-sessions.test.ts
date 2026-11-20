import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPageOwners } from "../bridge/page-owners.ts";
import { spawnPty } from "../platform/pty.ts";
import { createTerminalSessions } from "./terminal-sessions.ts";

vi.mock("../platform/pty.ts", () => ({ spawnPty: vi.fn() }));
vi.mock("../platform/tools.ts", () => ({
  resolveTool: () => Promise.resolve({ file: "claude", args: [] }),
  childEnvironment: () => Promise.resolve({}),
}));

const size = { program: "claude", cols: 80, rows: 24 } as const;

function terminalId(index: number): string {
  return `6f1c2a7e-3b4d-4c5e-9f60-${index.toString().padStart(12, "0")}`;
}

function owners() {
  const pages = createPageOwners<object>(vi.fn());
  const first = {};
  const second = {};
  return {
    pages,
    first,
    mine: pages.ownerFor(first),
    theirs: pages.ownerFor(second),
  };
}

describe("createTerminalSessions", () => {
  let ptys: { write: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }[];

  beforeEach(() => {
    ptys = [];
    vi.mocked(spawnPty).mockImplementation(() => {
      const spies = { write: vi.fn(), kill: vi.fn() };
      ptys.push(spies);
      return { pid: 1, resize: vi.fn(), onData: vi.fn(), onExit: vi.fn(), ...spies };
    });
  });

  it("refuses write, resize and close from a page that does not own the terminal", async () => {
    const { handlers } = createTerminalSessions();
    const { mine, theirs } = owners();
    await handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    const id = terminalId(1);
    await expect(handlers["terminal.write"]({ id, data: "x" }, theirs)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(
      handlers["terminal.resize"]({ id, cols: 90, rows: 30 }, theirs),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(handlers["terminal.close"]({ id }, theirs)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(ptys[0]?.write).not.toHaveBeenCalled();
    expect(ptys[0]?.kill).not.toHaveBeenCalled();
  });

  it("kills a page's terminals when the page is gone, and never spawns one still starting", async () => {
    const { handlers } = createTerminalSessions();
    const { pages, first, mine } = owners();
    await handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    const starting = handlers["terminal.start"]({ id: terminalId(2), ...size }, mine);
    pages.end(first);
    await starting;
    expect(ptys).toHaveLength(1);
    expect(ptys[0]?.kill).toHaveBeenCalledTimes(1);
  });

  it("refuses a duplicate id and a seventeenth terminal", async () => {
    const { handlers } = createTerminalSessions();
    const { mine } = owners();
    for (let index = 1; index <= 16; index += 1) {
      await handlers["terminal.start"]({ id: terminalId(index), ...size }, mine);
    }
    await expect(
      handlers["terminal.start"]({ id: terminalId(1), ...size }, mine),
    ).rejects.toMatchObject({ code: "invalid-request" });
    await expect(
      handlers["terminal.start"]({ id: terminalId(17), ...size }, mine),
    ).rejects.toMatchObject({ code: "limit" });
  });
});
