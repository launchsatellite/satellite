import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node-pty";
import { endUnixTree, endWindowsTree } from "./process-tree.ts";
import type { ResolvedCommand } from "./tools.ts";

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): Promise<void>;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exitCode: number) => void): void;
}

const forceKillGraceMs = 2000;

export function spawnPty(
  command: ResolvedCommand,
  options: { cwd: string; cols: number; rows: number; env: Record<string, string> },
): PtyProcess {
  const pty = spawn(command.file, [...command.args], {
    name: "xterm-256color",
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    env: { ...options.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });
  let ended = false;
  const exited = new Promise<void>((resolve) => {
    pty.onExit(() => {
      ended = true;
      resolve();
    });
  });
  let killing: Promise<void> | undefined;
  const endWindows = async () => {
    await endWindowsTree(pty.pid);
    await Promise.race([exited, delay(forceKillGraceMs)]);
    if (!ended) pty.kill();
  };
  return {
    pid: pty.pid,
    write(data) {
      if (!ended) pty.write(data);
    },
    resize(cols, rows) {
      if (!ended) pty.resize(cols, rows);
    },
    pause() {
      pty.pause();
    },
    resume() {
      pty.resume();
    },
    kill() {
      killing ??=
        process.platform === "win32"
          ? endWindows()
          : endUnixTree(pty.pid, exited, forceKillGraceMs);
      return killing;
    },
    onData(listener) {
      pty.onData(listener);
    },
    onExit(listener) {
      pty.onExit(({ exitCode }) => {
        listener(exitCode);
      });
    },
  };
}
