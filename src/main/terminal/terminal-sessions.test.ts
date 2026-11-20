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
  let ptys: {
    write: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn<() => Promise<void>>>;
    exit: (exitCode: number) => void;
  }[];

  beforeEach(() => {
    ptys = [];
    vi.mocked(spawnPty).mockImplementation(() => {
      const spies = { write: vi.fn(), kill: vi.fn(() => Promise.resolve()) };
      const fake = {
        ...spies,
        exit: (exitCode: number) => {
          expect(exitCode).toBeTypeOf("number");
        },
      };
      ptys.push(fake);
      return {
        pid: 1,
        resize: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        onData: vi.fn(),
        onExit: (listener: (exitCode: number) => void) => {
          fake.exit = listener;
        },
        ...spies,
      };
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
    await expect(handlers["terminal.ack"]({ id, chars: 10 }, theirs)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(
      handlers["terminal.ack"]({ id: terminalId(2), chars: 10 }, mine),
    ).rejects.toMatchObject({ code: "not-found" });
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

  it("cancels a start closed by its own page, so the same id starts again", async () => {
    const { handlers } = createTerminalSessions();
    const { mine } = owners();
    const id = terminalId(1);
    const starting = handlers["terminal.start"]({ id, ...size }, mine);
    await handlers["terminal.close"]({ id }, mine);
    await starting;
    expect(ptys).toHaveLength(0);
    await handlers["terminal.start"]({ id, ...size }, mine);
    expect(ptys).toHaveLength(1);
  });

  it("frees the id when Claude Code exits on its own", async () => {
    const { handlers } = createTerminalSessions();
    const { mine } = owners();
    const id = terminalId(1);
    await handlers["terminal.start"]({ id, ...size }, mine);
    ptys[0]?.exit(0);
    await handlers["terminal.start"]({ id, ...size }, mine);
    expect(ptys).toHaveLength(2);
  });

  it("answers a spawn failure with a sentence the user can act on and frees the id", async () => {
    const { handlers } = createTerminalSessions();
    const { mine } = owners();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(spawnPty).mockImplementationOnce(() => {
      throw new Error("posix_spawnp failed.");
    });
    const id = terminalId(1);
    const failed = handlers["terminal.start"]({ id, ...size }, mine);
    await expect(failed).rejects.toMatchObject({ code: "failed" });
    await expect(failed).rejects.toThrow("Claude Code couldn't start. Nothing in your project");
    logged.mockRestore();
    await handlers["terminal.start"]({ id, ...size }, mine);
    expect(ptys).toHaveLength(1);
  });

  it("closeAll waits until every terminal has been ended", async () => {
    const sessions = createTerminalSessions();
    const { mine } = owners();
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    let finishKill: () => void = () => undefined;
    ptys[0]?.kill.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishKill = resolve;
        }),
    );
    let closed = false;
    const closing = sessions.closeAll().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    finishKill();
    await closing;
    expect(closed).toBe(true);
  });

  it("refuses a duplicate id and a seventeenth terminal counted across pages", async () => {
    const { handlers } = createTerminalSessions();
    const { mine, theirs } = owners();
    for (let index = 1; index <= 16; index += 1) {
      const owner = index % 2 === 0 ? mine : theirs;
      await handlers["terminal.start"]({ id: terminalId(index), ...size }, owner);
    }
    await expect(
      handlers["terminal.start"]({ id: terminalId(1), ...size }, mine),
    ).rejects.toMatchObject({ code: "invalid-request" });
    await expect(
      handlers["terminal.start"]({ id: terminalId(17), ...size }, mine),
    ).rejects.toMatchObject({ code: "limit" });
  });
});
