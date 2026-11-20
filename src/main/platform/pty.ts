import { execFile, execFileSync } from "node:child_process";
import { join } from "node:path";
import { spawn, type IPty } from "node-pty";
import type { ResolvedCommand } from "./tools.ts";

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exitCode: number) => void): void;
}

const forceKillGraceMs = 2000;

function signal(pid: number, name: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

function descendantsOf(root: number): number[] {
  let listing: string;
  try {
    listing = execFileSync("ps", ["-A", "-o", "pid=", "-o", "ppid="], {
      encoding: "utf8",
      timeout: 2000,
    });
  } catch {
    return [];
  }
  const children = new Map<number, number[]>();
  for (const line of listing.split("\n")) {
    const [pid, parent] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || parent === undefined || Number.isNaN(pid)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const found: number[] = [];
  const pending = [root];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const child of children.get(next) ?? []) {
      found.push(child);
      pending.push(child);
    }
  }
  return found;
}

function endUnixTree(pty: IPty): void {
  const tree = [pty.pid, ...descendantsOf(pty.pid)];
  signal(-pty.pid, "SIGHUP");
  for (const pid of tree) signal(pid, "SIGHUP");
  setTimeout(() => {
    signal(-pty.pid, "SIGKILL");
    for (const pid of tree) if (signal(pid, 0)) signal(pid, "SIGKILL");
  }, forceKillGraceMs).unref();
}

function endWindowsTree(pty: IPty): void {
  const taskkill = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
  execFile(taskkill, ["/pid", String(pty.pid), "/T", "/F"], { windowsHide: true }, () => {
    try {
      pty.kill();
    } catch {
      return;
    }
  });
}

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
  pty.onExit(() => {
    ended = true;
  });
  return {
    pid: pty.pid,
    write(data) {
      if (!ended) pty.write(data);
    },
    resize(cols, rows) {
      if (!ended) pty.resize(cols, rows);
    },
    kill() {
      if (process.platform === "win32") endWindowsTree(pty);
      else endUnixTree(pty);
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
