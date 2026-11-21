import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { createPageOwners } from "../bridge/page-owners.ts";
import { spawnPty } from "../platform/pty.ts";
import type { HookListener } from "../sessions/hook-listener.ts";
import type { LastSessions } from "../sessions/last-sessions.ts";
import { treeKillBoundMs } from "../platform/process-tree.ts";
import type { Needing } from "../inbox/notices.ts";
import { createTerminalSessions, exitGraceMs, quitBoundMs } from "./terminal-sessions.ts";

vi.mock("../platform/pty.ts", () => ({ spawnPty: vi.fn(), windowsPty: () => null }));
vi.mock("../platform/tools.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/tools.ts")>();
  return {
    ...actual,
    resolveTool: () => Promise.resolve({ file: "claude", args: ["--from-override"] }),
    childEnvironment: () => Promise.resolve({ PATH: "/usr/bin", CLAUDECODE: "1" }),
  };
});

const projectId = "0b9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e";
const otherWorkspace = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const recorded = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const secret = "ab".repeat(32);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const main: WorkspaceRef = { projectId, workspace: "main" };
const other: WorkspaceRef = { projectId, workspace: otherWorkspace };
const size = { program: "claude", workspace: main, resume: false, cols: 80, rows: 24 } as const;

function terminalId(index: number): string {
  return `6f1c2a7e-3b4d-4c5e-9f60-${index.toString().padStart(12, "0")}`;
}

function owners() {
  const sent = vi.fn<(page: object, event: string, payload: unknown) => void>();
  const pages = createPageOwners<object>(sent);
  const first = {};
  const second = {};
  return { pages, first, sent, mine: pages.ownerFor(first), theirs: pages.ownerFor(second) };
}

function fakeListener() {
  return {
    port: 4321,
    open: vi.fn<(launchId: string) => string>(() => secret),
    close: vi.fn<(launchId: string) => void>(),
    stop: vi.fn(() => Promise.resolve()),
  } satisfies HookListener;
}

function fakeLast(sessionId?: string) {
  return {
    get: vi.fn<LastSessions["get"]>(() => Promise.resolve(sessionId)),
    set: vi.fn<LastSessions["set"]>(() => Promise.resolve()),
    forget: vi.fn<LastSessions["forget"]>(() => Promise.resolve()),
    keepOnly: vi.fn<LastSessions["keepOnly"]>(() => Promise.resolve()),
    flush: vi.fn<LastSessions["flush"]>(() => Promise.resolve()),
  } satisfies LastSessions;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe("createTerminalSessions", () => {
  let ptys: {
    write: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn<() => Promise<void>>>;
    exit: (exitCode: number, signal?: number) => void;
  }[];
  let home: string;
  let folders: Map<string, string>;

  const create = (
    options: {
      listener?: HookListener;
      last?: LastSessions;
      onNeeding?: (needing: readonly Needing[]) => void;
    } = {},
  ) =>
    createTerminalSessions({
      home,
      folder: (ref) => {
        const folder = folders.get(ref.workspace);
        return folder === undefined
          ? Promise.reject(new Error("no such folder"))
          : Promise.resolve(folder);
      },
      listener: Promise.resolve(options.listener),
      last: options.last ?? fakeLast(),
      onNeeding: options.onNeeding ?? vi.fn(),
    });

  beforeEach(async () => {
    ptys = [];
    home = await realpath(await mkdtemp(join(tmpdir(), "satellite-terminals-")));
    const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-folders-")));
    folders = new Map([
      ["main", await mkdtemp(join(base, "main-"))],
      [otherWorkspace, await mkdtemp(join(base, "other-"))],
    ]);
    vi.mocked(spawnPty).mockImplementation(() => {
      const spies = { write: vi.fn(), kill: vi.fn(() => Promise.resolve()) };
      const fake: (typeof ptys)[number] = {
        ...spies,
        exit: (exitCode: number) => {
          expect(exitCode).toBeTypeOf("number");
        },
      };
      ptys.push(fake);
      return {
        pid: 4100 + ptys.length,
        resize: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        onData: vi.fn(),
        onExit: (listener: (exitCode: number, signal: number | undefined) => void) => {
          fake.exit = (exitCode, signal) => {
            listener(exitCode, signal);
          };
        },
        ...spies,
      };
    });
  });

  it("starts claude in the workspace's folder with Satellite's arguments", async () => {
    const listener = fakeListener();
    const { handlers } = create({ listener });
    const { mine } = owners();
    await handlers["terminal.start"]({ id: terminalId(1), ...size, workspace: other }, mine);
    const launchId = listener.open.mock.calls[0]?.[0] ?? "";
    expect(launchId).toMatch(uuid);
    const settingsFile = join(home, "sessions", `${launchId}.json`);
    const [command, args, options] = vi.mocked(spawnPty).mock.calls[0] ?? [];
    expect(command).toEqual({ file: "claude", args: ["--from-override"] });
    expect(args).toEqual(["--session-id", expect.stringMatching(uuid), "--settings", settingsFile]);
    expect(args?.[1]).not.toBe(launchId);
    expect(options?.cwd).toBe(folders.get(otherWorkspace));
    expect(options?.env).toEqual({ PATH: "/usr/bin" });
    const settings = await readFile(settingsFile, "utf8");
    expect(settings).toContain(`http://127.0.0.1:4321/hook/${launchId}/Stop`);
    expect(settings).toContain(`Bearer ${secret}`);
  });

  it("starts claude without settings when there is no listener", async () => {
    const { handlers } = create();
    const { mine } = owners();
    await handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    expect(vi.mocked(spawnPty).mock.calls[0]?.[1]).toEqual([
      "--session-id",
      expect.stringMatching(uuid),
    ]);
  });

  it("refuses to resume a session that is open", async () => {
    const { handlers } = create({ listener: fakeListener(), last: fakeLast(recorded) });
    const { mine } = owners();
    await handlers["terminal.start"]({ id: terminalId(1), ...size, resume: true }, mine);
    expect(vi.mocked(spawnPty).mock.calls[0]?.[1]?.slice(0, 2)).toEqual(["--resume", recorded]);
    await expect(
      handlers["terminal.start"]({ id: terminalId(2), ...size, resume: true }, mine),
    ).rejects.toMatchObject({
      code: "refused",
      message: "That session is already open in another tab.",
    });
    expect(await handlers["sessions.resumable"]({ workspace: main }, mine)).toEqual({
      resumable: false,
    });
    ptys[0]?.exit(0);
    expect(await handlers["sessions.resumable"]({ workspace: main }, mine)).toEqual({
      resumable: true,
    });
    expect(ptys).toHaveLength(1);
  });

  it("refuses to resume a session still being ended", { timeout: 15_000 }, async () => {
    const { handlers } = create({ listener: fakeListener(), last: fakeLast(recorded) });
    const { mine } = owners();
    await handlers["terminal.start"]({ id: terminalId(1), ...size, resume: true }, mine);
    ptys[0]?.kill.mockImplementation(() => new Promise<void>(() => undefined));
    await handlers["terminal.close"]({ id: terminalId(1) }, mine);
    await expect(
      handlers["terminal.start"]({ id: terminalId(2), ...size, resume: true }, mine),
    ).rejects.toMatchObject({ code: "refused" });
    expect(ptys).toHaveLength(1);
  });

  it("offers the resume once a closed session's process is gone", async () => {
    const { handlers } = create({ listener: fakeListener(), last: fakeLast(recorded) });
    const { mine } = owners();
    await handlers["terminal.start"]({ id: terminalId(1), ...size, resume: true }, mine);
    let killed: () => void = () => undefined;
    ptys[0]?.kill.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          killed = resolve;
        }),
    );
    await handlers["terminal.close"]({ id: terminalId(1) }, mine);
    const answer = handlers["sessions.resumable"]({ workspace: main }, mine);
    await delay(50);
    ptys[0]?.exit(0, 1);
    killed();
    expect(await answer).toEqual({ resumable: true });
  });

  it("refuses to resume where nothing is recorded", async () => {
    const { handlers } = create({ last: fakeLast() });
    const { mine } = owners();
    await expect(
      handlers["terminal.start"]({ id: terminalId(1), ...size, resume: true }, mine),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(await handlers["sessions.resumable"]({ workspace: main }, mine)).toEqual({
      resumable: false,
    });
    folders.delete("main");
    await expect(handlers["terminal.start"]({ id: terminalId(1), ...size }, mine)).rejects.toThrow(
      "no such folder",
    );
    expect(ptys).toHaveLength(0);
  });

  it("removes the settings file when claude exits", async () => {
    const listener = fakeListener();
    const { handlers } = create({ listener });
    const { mine, sent } = owners();
    const id = terminalId(1);
    await handlers["terminal.start"]({ id, ...size }, mine);
    const launchId = listener.open.mock.calls[0]?.[0] ?? "";
    const settingsFile = join(home, "sessions", `${launchId}.json`);
    expect(await exists(settingsFile)).toBe(true);
    ptys[0]?.exit(0);
    await vi.waitFor(() => {
      expect(sent).toHaveBeenCalledWith(expect.anything(), "terminal.exit", {
        id,
        exitCode: 0,
        ending: "ended",
      });
    });
    expect(listener.close).toHaveBeenCalledWith(launchId);
    expect(await exists(settingsFile)).toBe(false);
  });

  it("tells a failed resume from a crash and from an end Satellite caused", async () => {
    const last = fakeLast(recorded);
    const listener = fakeListener();
    const sessions = create({ listener, last });
    const { mine, sent } = owners();
    const endings = () =>
      sent.mock.calls.flatMap(([, event, payload]) => (event === "terminal.exit" ? [payload] : []));
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size, resume: true }, mine);
    ptys[0]?.exit(1);
    await vi.waitFor(() => {
      expect(endings()).toHaveLength(1);
    });
    expect(last.forget).toHaveBeenCalledWith(main, recorded);
    await sessions.handlers["terminal.start"]({ id: terminalId(2), ...size }, mine);
    ptys[1]?.exit(0, 9);
    await sessions.handlers["terminal.start"]({ id: terminalId(3), ...size, resume: true }, mine);
    const stopping = sessions.sessionsInside.stopInside(folders.get("main") ?? "");
    ptys[2]?.exit(0, 1);
    await stopping;
    await vi.waitFor(() => {
      expect(endings()).toHaveLength(3);
    });
    expect(endings()).toEqual([
      { id: terminalId(1), exitCode: 1, ending: "resume-failed" },
      { id: terminalId(2), exitCode: 0, ending: "unexpected" },
      { id: terminalId(3), exitCode: 0, ending: "ended" },
    ]);
    expect(last.forget).toHaveBeenCalledTimes(1);
  });

  it("keeps the record of a resumed session that fails while no listener runs", async () => {
    const last = fakeLast(recorded);
    const { handlers } = create({ last });
    const { mine, sent } = owners();
    await handlers["terminal.start"]({ id: terminalId(1), ...size, resume: true }, mine);
    ptys[0]?.exit(1);
    await vi.waitFor(() => {
      expect(sent).toHaveBeenCalledWith(expect.anything(), "terminal.exit", {
        id: terminalId(1),
        exitCode: 1,
        ending: "unexpected",
      });
    });
    expect(last.forget).not.toHaveBeenCalled();
  });

  it("tells its page when a hook changes the status", async () => {
    const listener = fakeListener();
    const last = fakeLast();
    const sessions = create({ listener, last });
    const { mine, sent } = owners();
    const id = terminalId(1);
    await sessions.handlers["terminal.start"]({ id, ...size }, mine);
    const launchId = listener.open.mock.calls[0]?.[0] ?? "";
    const statuses = () =>
      sent.mock.calls.flatMap(([, event, payload]) =>
        event === "sessions.status" ? [payload] : [],
      );
    const started = vi.mocked(spawnPty).mock.calls[0]?.[1][1];
    sessions.hookEvent(launchId, { name: "UserPromptSubmit" }, null);
    expect(last.set).toHaveBeenCalledWith(main, started);
    sessions.hookEvent("4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c", { name: "Stop" }, null);
    await vi.waitFor(() => {
      expect(statuses()).toEqual([{ id, status: "working", ready: true }]);
    });
    sessions.hookEvent(launchId, { name: "PermissionRequest", agent: "" }, null);
    await vi.waitFor(() => {
      expect(statuses().at(-1)).toEqual({ id, status: "needs-you", ready: true });
    });
    expect(statuses()).toHaveLength(2);
    ptys[0]?.exit(0);
    expect(statuses().at(-1)).toEqual({ id, status: "stopped", ready: true });
    sessions.hookEvent(launchId, { name: "UserPromptSubmit" }, null);
    expect(statuses().at(-1)).toEqual({ id, status: "stopped", ready: true });
    expect(last.set).toHaveBeenCalledTimes(1);
  });

  it("tells who needs you as hooks arrive", async () => {
    const listener = fakeListener();
    const onNeeding = vi.fn<(needing: readonly Needing[]) => void>();
    const sessions = create({ listener, onNeeding });
    const { mine } = owners();
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    await sessions.handlers["terminal.start"](
      { id: terminalId(2), ...size, workspace: other },
      mine,
    );
    const [first, second] = listener.open.mock.calls.map(([launchId]) => launchId);
    sessions.hookEvent(first ?? "", { name: "PermissionRequest", agent: "" }, null);
    expect(onNeeding).toHaveBeenLastCalledWith([
      { workspace: main, owner: mine, reason: "session" },
    ]);
    sessions.hookEvent(first ?? "", { name: "PostToolUse", agent: "" }, null);
    expect(onNeeding).toHaveBeenLastCalledWith([]);
    sessions.hookEvent(second ?? "", { name: "PermissionRequest", agent: "" }, null);
    expect(onNeeding).toHaveBeenLastCalledWith([
      { workspace: other, owner: mine, reason: "session" },
    ]);
    await sessions.handlers["terminal.close"]({ id: terminalId(2) }, mine);
    expect(onNeeding).toHaveBeenLastCalledWith([]);
    sessions.hookEvent(first ?? "", { name: "PermissionRequest", agent: "" }, null);
    ptys[0]?.exit(0);
    expect(onNeeding).toHaveBeenLastCalledWith([]);
  });

  it("records the session id the latest hook carried, so a cleared session resumes as shown", async () => {
    const listener = fakeListener();
    const last = fakeLast();
    const sessions = create({ listener, last });
    const { mine } = owners();
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    const launchId = listener.open.mock.calls[0]?.[0] ?? "";
    const cleared = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
    sessions.hookEvent(launchId, { name: "Stop" }, cleared);
    sessions.hookEvent("4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c", { name: "Stop" }, randomUUID());
    sessions.hookEvent(launchId, { name: "UserPromptSubmit" }, null);
    expect(last.set).toHaveBeenLastCalledWith(main, cleared);
  });

  it("tells its page a session is ready once any hook arrives, which trust allows", async () => {
    const listener = fakeListener();
    const sessions = create({ listener });
    const { mine, sent } = owners();
    const id = terminalId(1);
    await sessions.handlers["terminal.start"]({ id, ...size }, mine);
    const launchId = listener.open.mock.calls[0]?.[0] ?? "";
    const statuses = () =>
      sent.mock.calls.flatMap(([, event, payload]) =>
        event === "sessions.status" ? [payload] : [],
      );
    sessions.hookEvent("4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c", { name: "Stop" }, null);
    expect(statuses()).toEqual([]);
    sessions.hookEvent(launchId, { name: "Notification", type: "idle_prompt", agent: null }, null);
    expect(statuses()).toEqual([{ id, status: "idle", ready: true }]);
    sessions.hookEvent(launchId, { name: "UserPromptSubmit" }, null);
    await vi.waitFor(() => {
      expect(statuses().at(-1)).toEqual({ id, status: "working", ready: true });
    });
  });

  it("shows a busy session's status at most ten times a second", async () => {
    const listener = fakeListener();
    const sessions = create({ listener });
    const { mine, sent } = owners();
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    const launchId = listener.open.mock.calls[0]?.[0] ?? "";
    const statuses = () =>
      sent.mock.calls.flatMap(([, event, payload]) =>
        event === "sessions.status" ? [payload] : [],
      );
    for (let index = 0; index < 50; index += 1) {
      sessions.hookEvent(launchId, { name: "PermissionRequest", agent: "" }, null);
      sessions.hookEvent(launchId, { name: "PostToolUse", agent: "" }, null);
    }
    sessions.hookEvent(launchId, { name: "Stop" }, null);
    expect(statuses()).toHaveLength(1);
    await vi.waitFor(() => {
      expect(statuses().at(-1)).toEqual({ id: terminalId(1), status: "done", ready: true });
    });
    expect(statuses()).toHaveLength(2);
  });

  it("refuses write, resize and close from a page that does not own the terminal", async () => {
    const { handlers } = create();
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
    const listener = fakeListener();
    const { handlers } = create({ listener });
    const { pages, first, mine } = owners();
    await handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    const starting = handlers["terminal.start"]({ id: terminalId(2), ...size }, mine);
    pages.end(first);
    await starting;
    expect(ptys).toHaveLength(1);
    expect(ptys[0]?.kill).toHaveBeenCalledTimes(1);
    const launches = listener.open.mock.calls.map(([launchId]) => launchId);
    expect(listener.close.mock.calls.map(([launchId]) => launchId)).toEqual(launches.slice(1));
    for (const launchId of launches.slice(1)) {
      expect(await exists(join(home, "sessions", `${launchId}.json`))).toBe(false);
    }
  });

  it("tells the page when quitting ends a start before it spawns", async () => {
    const sessions = create();
    const { mine, sent } = owners();
    const starting = sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    await sessions.closeAll();
    await starting;
    expect(ptys).toHaveLength(0);
    expect(sent).toHaveBeenCalledWith(expect.anything(), "terminal.exit", {
      id: terminalId(1),
      exitCode: 0,
      ending: "ended",
    });
  });

  it("changes no resume record once quitting has begun, so the saved record is the last one", async () => {
    const listener = fakeListener();
    const last = fakeLast();
    const sessions = create({ listener, last });
    const { mine } = owners();
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    const launchId = listener.open.mock.calls[0]?.[0] ?? "";
    const quitting = sessions.closeAll();
    sessions.hookEvent(launchId, { name: "UserPromptSubmit" }, null);
    ptys[0]?.exit(0, 1);
    await quitting;
    expect(last.set).not.toHaveBeenCalled();
  });

  it("tells the page when an archive ends a start before it spawns", async () => {
    const pending = Promise.withResolvers<string | undefined>();
    const last = fakeLast();
    last.get.mockImplementation(() => pending.promise);
    const sessions = create({ last });
    const { mine, sent } = owners();
    const starting = sessions.handlers["terminal.start"](
      { id: terminalId(1), ...size, resume: true },
      mine,
    );
    await vi.waitFor(() => {
      expect(last.get).toHaveBeenCalled();
    });
    expect(sessions.sessionsInside.countInside(folders.get("main") ?? "")).toBe(1);
    const stopping = sessions.sessionsInside.stopInside(folders.get("main") ?? "");
    pending.resolve(recorded);
    await starting;
    await stopping;
    expect(ptys).toHaveLength(0);
    expect(sent).toHaveBeenCalledWith(expect.anything(), "terminal.exit", {
      id: terminalId(1),
      exitCode: 0,
      ending: "ended",
    });
  });

  it("cancels a start closed by its own page, so the same id starts again", async () => {
    const { handlers } = create();
    const { mine } = owners();
    const id = terminalId(1);
    const starting = handlers["terminal.start"]({ id, ...size }, mine);
    await handlers["terminal.close"]({ id }, mine);
    await starting;
    expect(ptys).toHaveLength(0);
    await handlers["terminal.start"]({ id, ...size }, mine);
    expect(ptys).toHaveLength(1);
  });

  it("tells a page nothing about a launch it closed itself, so a remount with the same id keeps its session", async () => {
    const { handlers } = create({ listener: fakeListener(), last: fakeLast(recorded) });
    const { mine, sent } = owners();
    const id = terminalId(1);
    const request = { id, ...size, resume: true };
    const starting = handlers["terminal.start"](request, mine);
    await handlers["terminal.close"]({ id }, mine);
    const again = handlers["terminal.start"](request, mine);
    await starting;
    await again;
    expect(ptys).toHaveLength(1);
    await handlers["terminal.close"]({ id }, mine);
    ptys[0]?.exit(0, 1);
    await handlers["terminal.start"](request, mine);
    expect(ptys).toHaveLength(2);
    expect(sent).not.toHaveBeenCalledWith(expect.anything(), "terminal.exit", expect.anything());
    expect(sent).not.toHaveBeenCalledWith(expect.anything(), "sessions.status", expect.anything());
  });

  it("frees the id when Claude Code exits on its own", async () => {
    const { handlers } = create();
    const { mine } = owners();
    const id = terminalId(1);
    await handlers["terminal.start"]({ id, ...size }, mine);
    ptys[0]?.exit(0);
    await handlers["terminal.start"]({ id, ...size }, mine);
    expect(ptys).toHaveLength(2);
  });

  it("answers a root with its owner only while the session runs", async () => {
    const sessions = create();
    const { mine } = owners();
    const before = Date.now();
    const starting = sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    expect(sessions.roots()).toEqual([]);
    await starting;
    const [running] = sessions.roots();
    expect(sessions.roots()).toHaveLength(1);
    expect(running?.owner).toBe(mine);
    expect(running?.root).toMatchObject({ session: terminalId(1), workspace: main, pid: 4101 });
    expect(running?.root.spawnedAt).toBeGreaterThanOrEqual(before);
    ptys[0]?.exit(0);
    expect(sessions.roots()).toEqual([]);
    await sessions.handlers["terminal.start"]({ id: terminalId(2), ...size }, mine);
    expect(sessions.roots()).toHaveLength(1);
    await sessions.handlers["terminal.close"]({ id: terminalId(2) }, mine);
    expect(sessions.roots()).toEqual([]);
  });

  it("answers a spawn failure with a sentence the user can act on and frees the id", async () => {
    const listener = fakeListener();
    const { handlers } = create({ listener });
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
    const launchId = listener.open.mock.calls[0]?.[0] ?? "";
    expect(listener.close).toHaveBeenCalledWith(launchId);
    expect(await exists(join(home, "sessions", `${launchId}.json`))).toBe(false);
    await handlers["terminal.start"]({ id, ...size }, mine);
    expect(ptys).toHaveLength(1);
  });

  it("closeAll waits until every terminal has been ended", async () => {
    const sessions = create();
    const { mine } = owners();
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    let finishKill: () => void = () => undefined;
    ptys[0]?.kill.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishKill = () => {
            ptys[0]?.exit(0, 1);
            resolve();
          };
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

  it("quits only after a kill at its worst case, with no exit reported, has released the launch", async () => {
    const listener = fakeListener();
    const sessions = create({ listener });
    const { mine } = owners();
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    const launchId = listener.open.mock.calls[0]?.[0] ?? "";
    const settingsFile = join(home, "sessions", `${launchId}.json`);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], fakeNodeBuiltins: true });
    try {
      ptys[0]?.kill.mockImplementation(() => delay(treeKillBoundMs));
      const quit = { closed: false };
      const closing = sessions.closeAll().then(() => {
        quit.closed = true;
      });
      const endChainMs = treeKillBoundMs + exitGraceMs;
      await vi.advanceTimersByTimeAsync(endChainMs - 1);
      expect(quit.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await closing;
      expect(quit.closed).toBe(true);
      expect(endChainMs).toBeLessThan(quitBoundMs);
    } finally {
      vi.useRealTimers();
    }
    expect(listener.close).toHaveBeenCalledWith(launchId);
    expect(await exists(settingsFile)).toBe(false);
  });

  it("keeps the listener until every claude it configured has exited", async () => {
    const listener = fakeListener();
    const sessions = create({ listener });
    const { mine } = owners();
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    await sessions.handlers["terminal.start"]({ id: terminalId(2), ...size }, mine);
    ptys[0]?.kill.mockImplementation(() => {
      ptys[0]?.exit(0, 1);
      return Promise.resolve();
    });
    await sessions.closeAll();
    expect(listener.stop).not.toHaveBeenCalled();
    ptys[1]?.exit(0, 9);
    await vi.waitFor(() => {
      expect(listener.stop).toHaveBeenCalledTimes(1);
    });
  });

  it("waits for the whole process tree to end, not only for claude to exit", async () => {
    const sessions = create();
    const { mine } = owners();
    await sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine);
    const treeEnded = Promise.withResolvers<undefined>();
    ptys[0]?.kill.mockImplementation(() => {
      ptys[0]?.exit(0, 1);
      return treeEnded.promise;
    });
    let closed = false;
    const closing = sessions.closeAll().then(() => {
      closed = true;
    });
    await delay(50);
    expect(closed).toBe(false);
    treeEnded.resolve(undefined);
    await closing;
  });

  it("refuses a duplicate id and a seventeenth terminal counted across pages", async () => {
    const { handlers } = create();
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

  it("counts a terminal that is still being killed against the limit", async () => {
    const { handlers } = create();
    const { mine } = owners();
    for (let index = 1; index <= 16; index += 1) {
      await handlers["terminal.start"]({ id: terminalId(index), ...size }, mine);
    }
    ptys[0]?.kill.mockImplementation(() => new Promise<void>(() => undefined));
    await handlers["terminal.close"]({ id: terminalId(1) }, mine);
    await expect(
      handlers["terminal.start"]({ id: terminalId(17), ...size }, mine),
    ).rejects.toMatchObject({ code: "limit" });
  });

  it("refuses a new terminal once quitting has begun", async () => {
    const sessions = create();
    const { mine } = owners();
    await sessions.closeAll();
    await expect(
      sessions.handlers["terminal.start"]({ id: terminalId(1), ...size }, mine),
    ).rejects.toMatchObject({ code: "failed" });
    expect(ptys).toHaveLength(0);
  });

  it("stops only the terminals running inside a folder", async () => {
    const sessions = create();
    const { mine } = owners();
    const workspace = folders.get(otherWorkspace) ?? "";
    await sessions.handlers["terminal.start"](
      { id: terminalId(1), ...size, workspace: other },
      mine,
    );
    await sessions.handlers["terminal.start"]({ id: terminalId(2), ...size }, mine);
    ptys[0]?.kill.mockImplementation(() => {
      ptys[0]?.exit(0, 1);
      return Promise.resolve();
    });
    expect(sessions.sessionsInside.countInside(workspace)).toBe(1);
    await sessions.sessionsInside.stopInside(workspace);
    expect(ptys[0]?.kill).toHaveBeenCalledTimes(1);
    expect(ptys[1]?.kill).not.toHaveBeenCalled();
    expect(sessions.sessionsInside.countInside(workspace)).toBe(0);
    expect(sessions.sessionsInside.countInside(folders.get("main") ?? "")).toBe(1);
  });

  it("counts and waits for a terminal in a folder that is still being ended", async () => {
    const sessions = create();
    const { mine } = owners();
    const workspace = folders.get(otherWorkspace) ?? "";
    await sessions.handlers["terminal.start"](
      { id: terminalId(1), ...size, workspace: other },
      mine,
    );
    const killed = Promise.withResolvers<undefined>();
    ptys[0]?.kill.mockImplementation(() => killed.promise);
    await sessions.handlers["terminal.close"]({ id: terminalId(1) }, mine);
    expect(sessions.sessionsInside.countInside(workspace)).toBe(1);
    let stopped = false;
    const stopping = sessions.sessionsInside.stopInside(workspace).then(() => {
      stopped = true;
    });
    await delay(50);
    expect(stopped).toBe(false);
    ptys[0]?.exit(0, 1);
    killed.resolve(undefined);
    await stopping;
    expect(sessions.sessionsInside.countInside(workspace)).toBe(0);
  });
});
