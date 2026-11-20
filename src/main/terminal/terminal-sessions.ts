import { stat } from "node:fs/promises";
import { bridgeLimits } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers, type BridgeOwner } from "../bridge/registry.ts";
import { spawnPty, type PtyProcess } from "../platform/pty.ts";
import { userHomeFolder } from "../platform/satellite-home.ts";
import { childEnvironment, resolveTool } from "../platform/tools.ts";
import { createOutputFlow, type OutputFlow } from "./output-flow.ts";

type TerminalHandlers = Pick<
  BridgeHandlers,
  "terminal.start" | "terminal.write" | "terminal.resize" | "terminal.close" | "terminal.ack"
>;

interface Session {
  readonly owner: BridgeOwner;
  pty?: PtyProcess;
  output?: OutputFlow;
  ended: boolean;
}

const spawnFailed =
  "Claude Code couldn't start. Nothing in your project changed. Start it again, and reinstall Claude Code if it keeps failing.";

async function workingFolder(): Promise<string> {
  const folder = process.cwd();
  try {
    return (await stat(folder)).isDirectory() ? folder : userHomeFolder();
  } catch {
    return userHomeFolder();
  }
}

function answered(act: () => void): Promise<Record<string, never>> {
  return Promise.resolve().then(() => {
    act();
    return {};
  });
}

export function createTerminalSessions(): {
  handlers: TerminalHandlers;
  closeAll(): Promise<void>;
} {
  const sessions = new Map<string, Session>();
  const watchedOwners = new WeakSet<BridgeOwner>();
  const ending = new Set<Promise<void>>();

  const end = (id: string, session: Session) => {
    if (sessions.get(id) === session) sessions.delete(id);
    session.ended = true;
    session.output?.stop();
    const killing = session.pty?.kill();
    if (killing === undefined) return;
    ending.add(killing);
    void killing.finally(() => ending.delete(killing));
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

  const launch = async (
    id: string,
    session: Session,
    size: { cols: number; rows: number },
  ): Promise<void> => {
    const command = await resolveTool("claude");
    if (command === undefined) {
      throw new BridgeFailure(
        "tool-missing",
        "Satellite can't find Claude Code. Install it, then start it again.",
      );
    }
    const [env, cwd] = await Promise.all([childEnvironment(), workingFolder()]);
    if (session.ended) return;
    let pty: PtyProcess;
    try {
      pty = spawnPty(command, { cwd, env, ...size });
    } catch (error) {
      console.error("Claude Code could not start", error);
      throw new BridgeFailure("failed", spawnFailed);
    }
    const output = createOutputFlow({
      emit(data) {
        session.owner.emit("terminal.data", { id, data });
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
    pty.onData((data) => {
      output.push(data);
    });
    pty.onExit((exitCode) => {
      output.finish();
      if (sessions.get(id) === session) sessions.delete(id);
      session.ended = true;
      session.owner.emit("terminal.exit", { id, exitCode });
    });
  };

  return {
    handlers: {
      "terminal.start": async ({ id, cols, rows }, owner) => {
        if (sessions.has(id)) {
          throw new BridgeFailure("invalid-request", "That terminal is already running.");
        }
        if (sessions.size >= bridgeLimits.terminals) {
          throw new BridgeFailure(
            "limit",
            `Satellite already runs ${String(bridgeLimits.terminals)} terminals. Close one first.`,
          );
        }
        const session: Session = { owner, ended: false };
        sessions.set(id, session);
        watch(owner);
        try {
          await launch(id, session, { cols, rows });
        } catch (error) {
          end(id, session);
          throw error;
        }
        return {};
      },
      "terminal.write": ({ id, data }, owner) =>
        answered(() => {
          held(id, owner).pty?.write(data);
        }),
      "terminal.resize": ({ id, cols, rows }, owner) =>
        answered(() => {
          held(id, owner).pty?.resize(cols, rows);
        }),
      "terminal.close": ({ id }, owner) =>
        answered(() => {
          end(id, held(id, owner));
        }),
      "terminal.ack": ({ id, chars }, owner) =>
        answered(() => {
          held(id, owner).output?.ack(chars);
        }),
    },
    async closeAll() {
      for (const [id, session] of sessions) end(id, session);
      await Promise.all(ending);
    },
  };
}
