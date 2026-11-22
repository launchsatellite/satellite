import { release } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node-pty";
import type { WindowsPty } from "../../shared/bridge-contract.ts";
import { endUnixTree, endWindowsTree, forceKillGraceMs } from "./process-tree.ts";
import type { ResolvedCommand } from "./tools.ts";

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): Promise<void>;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exitCode: number, signal: number | undefined) => void): void;
}

const conptyBuild = 18309;

export function windowsPty(
  platform: NodeJS.Platform = process.platform,
  version: string = release(),
): WindowsPty | null {
  if (platform !== "win32") return null;
  const buildNumber = Number(version.split(".")[2]);
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) return null;
  return { backend: buildNumber >= conptyBuild ? "conpty" : "winpty", buildNumber };
}

export function spawnPty(
  command: ResolvedCommand,
  args: readonly string[],
  options: { cwd: string; cols: number; rows: number; env: Record<string, string> },
): PtyProcess {
  const pty = spawn(command.file, [...command.args, ...args], {
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
    if (!ended) await endWindowsTree(pty.pid);
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
          : endUnixTree(pty.pid, exited, forceKillGraceMs, ended);
      return killing;
    },
    onData(listener) {
      pty.onData(listener);
    },
    onExit(listener) {
      pty.onExit(({ exitCode, signal }) => {
        listener(exitCode, signal === 0 ? undefined : signal);
      });
    },
  };
}
