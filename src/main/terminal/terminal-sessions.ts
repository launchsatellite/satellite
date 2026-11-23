import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  bridgeLimits,
  type SessionEnding,
  type SessionStatus,
  type WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { needsYou } from "../../shared/needs-you.ts";
import { BridgeFailure, type BridgeHandlers, type BridgeOwner } from "../bridge/registry.ts";
import type { Needing } from "../inbox/notices.ts";
import { isInsidePath } from "../platform/paths.ts";
import { treeKillBoundMs } from "../platform/process-tree.ts";
import { spawnPty, windowsPty, type PtyProcess } from "../platform/pty.ts";
import { childEnvironment, claudeEnvironment, resolveTool } from "../platform/tools.ts";
import { claudeArgs, hookSettings, type ClaudeStart } from "../sessions/claude-launch.ts";
import type { HookListener } from "../sessions/hook-listener.ts";
import type { LastSessions } from "../sessions/last-sessions.ts";
import type { RunningRoot } from "../processes/processes-handlers.ts";
import { launchableClaude } from "../tools/tool-check.ts";
import {
  answersQuestion,
  declinesQuestion,
  interruptsTurn,
  nextState,
  type SessionEvent,
  type SessionState,
} from "../sessions/session-status.ts";
import {
  removeSettingsFile,
  sweepSettingsFiles,
  writeSettingsFile,
} from "../sessions/settings-files.ts";
import { createOutputFlow, type OutputFlow } from "./output-flow.ts";

type TerminalHandlers = Pick<
  BridgeHandlers,
  | "sessions.resumable"
  | "terminal.start"
  | "terminal.write"
  | "terminal.resize"
  | "terminal.close"
  | "terminal.ack"
>;
type StartRequest = Parameters<BridgeHandlers["terminal.start"]>[0];

export interface WorkspaceSessions {
  countInside(folder: string): number;
  stopInside(folder: string): Promise<void>;
}
export interface TerminalSessions {
  handlers: TerminalHandlers;
  sessionsInside: WorkspaceSessions;
  hookEvent(launchId: string, event: SessionEvent, sessionId: string | null): void;
  roots(): RunningRoot[];
  quitStates(): { sessions: number; midTask: number; unseen: number };
  closeAll(): Promise<void>;
}
interface TerminalOptions {
  home: string;
  folder: (ref: WorkspaceRef) => Promise<string>;
  listener: Promise<HookListener | undefined>;
  last: LastSessions;
  onNeeding: (needing: readonly Needing[]) => void;
}
interface Session {
  readonly id: string;
  readonly owner: BridgeOwner;
  readonly workspace: WorkspaceRef;
  readonly resumed: boolean;
  readonly finished: PromiseWithResolvers<void>;
  cwd?: string;
  sessionId?: string;
  launchId?: string;
  hooks?: HookListener;
  settingsFile?: string;
  released?: Promise<void>;
  pty?: PtyProcess;
  spawnedAt?: number;
  killing?: Promise<void>;
  output?: OutputFlow;
  state: SessionState;
  shown: SessionStatus;
  shownReady: boolean;
  shownHooksOff: boolean;
  statusTimer?: NodeJS.Timeout;
  quietTimer?: NodeJS.Timeout;
  hooked: boolean;
  hooksOff: boolean;
  typed: boolean;
  submittedAt?: number;
  outputAt: number;
  writesFreeAt: number;
  writeWaiting: boolean;
  ended: boolean;
  endedBySatellite: boolean;
  closedByPage: boolean;
}

const spawnFailed =
  "Claude Code couldn't start. Nothing in your project changed. Start it again, and reinstall Claude Code if it keeps failing.";
const statusGapMs = 100;
const pasteStart = "\u001b[200~";
export const interruptQuietMs = 3000;
export const hooksOffAfterMs = 8000;
export const outputGapMs = 1500;
export const writeCharsPerSecond = 1_048_576;
const writesTooFast =
  "Satellite is still typing the last paste into Claude Code. Wait a moment, then paste again.";
export const exitGraceMs = 1000;
const stopBoundMs = treeKillBoundMs + exitGraceMs + 500;
export const quitBoundMs = stopBoundMs + 500;

function answered(act: () => void): Promise<Record<string, never>> {
  return Promise.resolve().then(() => {
    act();
    return {};
  });
}

function endingOf(session: Session, exitCode: number, signal: number | undefined): SessionEnding {
  const failed = exitCode !== 0 || signal !== undefined;
  if (!failed || session.endedBySatellite) return "ended";
  return session.resumed && session.hooks !== undefined && !session.hooked
    ? "resume-failed"
    : "unexpected";
}

function isEnded(session: Session): boolean {
  return session.ended;
}

function hookUrl(port: number, launchId: string): string {
  return `http://127.0.0.1:${String(port)}/hook/${launchId}`;
}

export function createTerminalSessions({
  home,
  folder,
  listener,
  last,
  onNeeding,
}: TerminalOptions): TerminalSessions {
  const sessions = new Map<string, Session>();
  const unsettled = new Set<Session>();
  const running = new Set<Session>();
  const launches = new Map<string, Session>();
  const watchedOwners = new WeakSet<BridgeOwner>();
  let sweeping: Promise<void> | undefined;
  let closed = false;
  let stopping: Promise<void> | undefined;

  const stopListenerOnceIdle = () => {
    if (!closed || running.size > 0) return Promise.resolve();
    stopping ??= listener.then((hooks) => hooks?.stop());
    return stopping;
  };

  const showStatus = (session: Session) => {
    if (session.closedByPage || session.statusTimer !== undefined) return;
    if (
      session.shown === session.state.status &&
      session.shownReady === session.hooked &&
      session.shownHooksOff === session.hooksOff
    ) {
      return;
    }
    session.shown = session.state.status;
    session.shownReady = session.hooked;
    session.shownHooksOff = session.hooksOff;
    session.owner.emit("sessions.status", {
      id: session.id,
      status: session.shown,
      ready: session.shownReady,
      hooksOff: session.shownHooksOff,
    });
    session.statusTimer = setTimeout(() => {
      session.statusTimer = undefined;
      showStatus(session);
    }, statusGapMs);
  };

  const tellNeeding = () => {
    onNeeding(
      [...sessions.values()].flatMap(({ ended, state, workspace, owner }) =>
        !ended && needsYou(state.status) ? [{ workspace, owner, reason: "session" as const }] : [],
      ),
    );
  };

  const move = (session: Session, event: SessionEvent) => {
    session.state = nextState(session.state, event);
    tellNeeding();
    showStatus(session);
  };

  const awaitQuiet = (session: Session) => {
    clearTimeout(session.quietTimer);
    session.quietTimer = setTimeout(() => {
      session.quietTimer = undefined;
      if (session.ended || session.state.status !== "working") return;
      if (performance.now() - session.outputAt < interruptQuietMs) awaitQuiet(session);
      else move(session, { name: "Interrupted" });
    }, interruptQuietMs);
  };

  const heardKeys = (session: Session, data: string) => {
    if (!session.hooked && data === "\r" && session.typed) {
      session.submittedAt = performance.now();
      session.outputAt = session.submittedAt;
    }
    session.typed = data !== "\r" && (!data.startsWith("\u001b") || data.startsWith(pasteStart));
    const { status } = session.state;
    if (status === "needs-you" && declinesQuestion(data)) move(session, { name: "DeclineKey" });
    else if (status === "needs-you" && answersQuestion(data)) move(session, { name: "AnswerKey" });
    else if (status === "working" && interruptsTurn(data)) awaitQuiet(session);
  };

  const heardOutput = (session: Session) => {
    const now = performance.now();
    const since = session.submittedAt;
    if (since !== undefined && !session.hooked) {
      if (now - session.outputAt > outputGapMs) session.submittedAt = undefined;
      else if (now - since >= hooksOffAfterMs) {
        session.submittedAt = undefined;
        session.hooksOff = true;
        showStatus(session);
      }
    }
    session.outputAt = now;
  };

  const paced = async (session: Session, chars: number) => {
    if (session.writeWaiting) throw new BridgeFailure("limit", writesTooFast);
    const now = performance.now();
    session.writesFreeAt =
      Math.max(session.writesFreeAt, now) + (chars / writeCharsPerSecond) * 1000;
    const wait = session.writesFreeAt - now - 1000;
    if (wait <= 0) return;
    session.writeWaiting = true;
    await delay(wait);
    session.writeWaiting = false;
  };

  const release = (session: Session) => {
    session.released ??= (async () => {
      if (session.launchId !== undefined) {
        session.hooks?.close(session.launchId);
        launches.delete(session.launchId);
      }
      if (session.settingsFile !== undefined) {
        await removeSettingsFile(session.settingsFile).catch((error: unknown) => {
          console.error("A session's settings file could not be removed", error);
        });
      }
    })();
    return session.released;
  };

  const settle = (session: Session) => {
    unsettled.delete(session);
    session.finished.resolve();
  };

  const settled = (ending: readonly Session[]) =>
    Promise.race([
      Promise.all(
        ending.flatMap((session) => [
          session.finished.promise,
          session.killing ?? Promise.resolve(),
        ]),
      ),
      delay(stopBoundMs),
    ]);

  const end = (id: string, session: Session) => {
    if (sessions.get(id) === session) sessions.delete(id);
    if (session.ended) return;
    session.ended = true;
    clearTimeout(session.quietTimer);
    tellNeeding();
    session.endedBySatellite = true;
    session.output?.stop();
    const killing = session.pty?.kill();
    if (killing === undefined) return;
    session.killing = killing;
    void killing
      .then(() => delay(exitGraceMs))
      .then(() => release(session))
      .then(() => {
        settle(session);
      });
  };

  const alive = () =>
    new Set([...running, ...[...unsettled].filter((session) => session.pty === undefined)]);

  const inside = (folder: string) =>
    [...alive()].filter(
      (session) => session.cwd !== undefined && isInsidePath(folder, session.cwd),
    );

  const holds = (sessionId: string) =>
    [...alive()].some((session) => session.sessionId === sessionId);

  const untilEnded = async (sessionId: string) => {
    const holding = [...alive()].filter((session) => session.sessionId === sessionId);
    if (holding.length > 0 && holding.every((session) => session.ended)) await settled(holding);
  };

  const tellExit = (session: Session, exitCode: number, ending: SessionEnding) => {
    if (!session.closedByPage) {
      session.owner.emit("terminal.exit", { id: session.id, exitCode, ending });
    }
  };

  const held = (id: string, owner: BridgeOwner): Session => {
    const session = sessions.get(id);
    if (session?.owner !== owner) {
      throw new BridgeFailure("not-found", "That terminal is not running.");
    }
    return session;
  };

  const watch = (owner: BridgeOwner) => {
    if (watchedOwners.has(owner)) return;
    watchedOwners.add(owner);
    owner.onGone(() => {
      for (const [id, session] of sessions) if (session.owner === owner) end(id, session);
    });
  };

  const startOf = async (session: Session): Promise<ClaudeStart> => {
    if (!session.resumed) {
      session.sessionId = randomUUID();
      return { kind: "new", sessionId: session.sessionId };
    }
    const recorded = await last.get(session.workspace);
    if (recorded === undefined) {
      throw new BridgeFailure("not-found", "There's no session to resume here. Start a new one.");
    }
    await untilEnded(recorded);
    if (holds(recorded)) {
      throw new BridgeFailure("refused", "That session is already open in another tab.");
    }
    session.sessionId = recorded;
    return { kind: "resume", sessionId: recorded };
  };

  const prepareHooks = async (session: Session): Promise<string | undefined> => {
    const hooks = await listener;
    if (hooks === undefined) return undefined;
    const launchId = randomUUID();
    const secret = hooks.open(launchId);
    session.hooks = hooks;
    session.launchId = launchId;
    launches.set(launchId, session);
    sweeping ??= sweepSettingsFiles(home).catch((error: unknown) => {
      console.error("Leftover session settings files could not be swept", error);
    });
    await sweeping;
    session.settingsFile = await writeSettingsFile(
      home,
      launchId,
      hookSettings(hookUrl(hooks.port, launchId), secret),
    );
    return session.settingsFile;
  };

  const exited = async (session: Session, exitCode: number, signal: number | undefined) => {
    running.delete(session);
    session.output?.finish();
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    session.ended = true;
    clearTimeout(session.quietTimer);
    session.state = nextState(session.state, { name: "Exit" });
    tellNeeding();
    clearTimeout(session.statusTimer);
    session.statusTimer = undefined;
    showStatus(session);
    await release(session);
    const ending = endingOf(session, exitCode, signal);
    if (ending === "resume-failed" && session.sessionId !== undefined) {
      await last.forget(session.workspace, session.sessionId);
    }
    clearTimeout(session.statusTimer);
    tellExit(session, exitCode, ending);
    settle(session);
    await stopListenerOnceIdle();
  };

  const launch = async (session: Session, size: { cols: number; rows: number }) => {
    const cwd = await folder(session.workspace);
    if (isEnded(session)) return;
    session.cwd = cwd;
    const start = await startOf(session);
    const command = await resolveTool("claude");
    if (command === undefined) {
      throw new BridgeFailure(
        "tool-missing",
        "Satellite can't find Claude Code. Install it, then start it again.",
      );
    }
    const installed = await launchableClaude(command);
    if (installed.state === "too-old") {
      throw new BridgeFailure(
        "tool-missing",
        `Claude Code ${installed.version} is older than the ${installed.minimum} Satellite needs. Update it, then start it again.`,
      );
    }
    if (isEnded(session)) return;
    const settingsFile = await prepareHooks(session);
    const env = claudeEnvironment(await childEnvironment());
    if (isEnded(session)) return;
    let pty: PtyProcess;
    try {
      pty = spawnPty(command, claudeArgs(start, settingsFile), { cwd, env, ...size });
    } catch (error) {
      console.error("Claude Code could not start", error);
      throw new BridgeFailure("failed", spawnFailed);
    }
    session.spawnedAt = Date.now();
    const output = createOutputFlow({
      emit(data) {
        session.owner.emit("terminal.data", { id: session.id, data });
      },
      pause() {
        pty.pause();
      },
      resume() {
        pty.resume();
      },
    });
    session.pty = pty;
    session.output = output;
    running.add(session);
    pty.onData((data) => {
      heardOutput(session);
      output.push(data);
    });
    pty.onExit((exitCode, signal) => {
      void exited(session, exitCode, signal);
    });
  };

  const start = async (request: StartRequest, owner: BridgeOwner) => {
    const { id, workspace, resume, cols, rows } = request;
    if (closed) throw new BridgeFailure("failed", "Satellite is quitting.");
    if (sessions.has(id)) {
      throw new BridgeFailure("invalid-request", "That terminal is already running.");
    }
    if (unsettled.size >= bridgeLimits.terminals) {
      throw new BridgeFailure(
        "limit",
        `Satellite already runs ${String(bridgeLimits.terminals)} terminals. Close one first.`,
      );
    }
    const session: Session = {
      id,
      owner,
      workspace,
      resumed: resume,
      finished: Promise.withResolvers(),
      state: { status: "idle", askers: [] },
      shown: "idle",
      shownReady: false,
      shownHooksOff: false,
      hooked: false,
      hooksOff: false,
      typed: false,
      outputAt: 0,
      writesFreeAt: 0,
      writeWaiting: false,
      ended: false,
      endedBySatellite: false,
      closedByPage: false,
    };
    sessions.set(id, session);
    unsettled.add(session);
    watch(owner);
    try {
      await launch(session, { cols, rows });
    } catch (error) {
      end(id, session);
      await release(session);
      settle(session);
      throw error;
    }
    if (session.pty === undefined) {
      await release(session);
      settle(session);
      tellExit(session, 0, "ended");
    }
    return { windowsPty: windowsPty() };
  };

  return {
    handlers: {
      "sessions.resumable": async ({ workspace }) => {
        try {
          await folder(workspace);
        } catch {
          return { resumable: false };
        }
        const recorded = await last.get(workspace);
        if (recorded === undefined) return { resumable: false };
        await untilEnded(recorded);
        return { resumable: !holds(recorded) && (await last.get(workspace)) === recorded };
      },
      "terminal.start": start,
      "terminal.write": async ({ id, data }, owner) => {
        const session = held(id, owner);
        await paced(session, data.length);
        if (session.pty === undefined || session.ended) return {};
        heardKeys(session, data);
        session.pty.write(data);
        return {};
      },
      "terminal.resize": ({ id, cols, rows }, owner) =>
        answered(() => {
          held(id, owner).pty?.resize(cols, rows);
        }),
      "terminal.close": ({ id }, owner) =>
        answered(() => {
          const session = held(id, owner);
          session.closedByPage = true;
          end(id, session);
        }),
      "terminal.ack": ({ id, chars }, owner) =>
        answered(() => {
          held(id, owner).output?.ack(chars);
        }),
    },
    sessionsInside: {
      countInside: (folder) => inside(folder).length,
      async stopInside(folder) {
        const stopping = inside(folder);
        for (const session of stopping) end(session.id, session);
        await settled(stopping);
      },
    },
    hookEvent(launchId, event, sessionId) {
      const session = launches.get(launchId);
      if (session === undefined || session.ended) return;
      session.hooked = true;
      session.hooksOff = false;
      session.submittedAt = undefined;
      if (session.quietTimer !== undefined) {
        if (event.name === "PostToolUse" || event.name === "PostToolUseFailure") {
          awaitQuiet(session);
        } else {
          clearTimeout(session.quietTimer);
          session.quietTimer = undefined;
        }
      }
      if (sessionId !== null) session.sessionId = sessionId;
      if (event.name === "UserPromptSubmit" && session.sessionId !== undefined) {
        void last.set(session.workspace, session.sessionId);
      }
      move(session, event);
    },
    roots() {
      return [...running].flatMap(({ ended, owner, id, workspace, pty, spawnedAt }) =>
        ended || pty === undefined || spawnedAt === undefined
          ? []
          : [{ owner, root: { session: id, workspace, pid: pty.pid, spawnedAt } }],
      );
    },
    quitStates() {
      const live = [...running].filter(({ ended }) => !ended);
      return {
        sessions: live.length,
        midTask: live.filter(
          ({ hooks, hooksOff, state }) =>
            hooks !== undefined &&
            !hooksOff &&
            (state.status === "working" || needsYou(state.status)),
        ).length,
        unseen: live.filter(({ hooks, hooksOff }) => hooks === undefined || hooksOff).length,
      };
    },
    async closeAll() {
      closed = true;
      for (const [id, session] of sessions) end(id, session);
      await settled([...unsettled]);
      await stopListenerOnceIdle();
    },
  };
}
