import { execFile } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

interface ProcessEntry {
  readonly pid: number;
  readonly parent: number;
  readonly group: number;
  readonly identity: string;
}

const listTimeoutMs = 1000;
const processLine = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/;

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    return;
  }
}

function listProcesses(): Promise<ProcessEntry[]> {
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "lstart="],
      { encoding: "utf8", timeout: listTimeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          resolve([]);
          return;
        }
        const entries: ProcessEntry[] = [];
        for (const line of stdout.split("\n")) {
          const match = processLine.exec(line);
          if (match === null) continue;
          const [, pid = "", parent = "", group = "", started = ""] = match;
          entries.push({
            pid: Number(pid),
            parent: Number(parent),
            group: Number(group),
            identity: `${pid} ${started}`,
          });
        }
        resolve(entries);
      },
    );
  });
}

function withDescendants(
  roots: readonly ProcessEntry[],
  entries: readonly ProcessEntry[],
): ProcessEntry[] {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of entries) {
    const siblings = children.get(entry.parent);
    if (siblings === undefined) children.set(entry.parent, [entry]);
    else siblings.push(entry);
  }
  const found = [...roots];
  const seen = new Set(found.map((entry) => entry.pid));
  for (const current of found) {
    for (const child of children.get(current.pid) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      found.push(child);
    }
  }
  return found;
}

function survivors(known: ReadonlySet<string>, entries: readonly ProcessEntry[]): ProcessEntry[] {
  return withDescendants(
    entries.filter((entry) => known.has(entry.identity)),
    entries,
  );
}

export function endWindowsTree(pid: number): Promise<void> {
  const taskkill = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
  return new Promise((resolve) => {
    execFile(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {
      resolve();
    });
  });
}

export async function endUnixTree(
  root: number,
  exited: Promise<void>,
  graceMs: number,
): Promise<void> {
  const deadline = Date.now() + graceMs;
  const entries = await listProcesses();
  const tree = withDescendants(
    entries.filter((entry) => entry.pid === root || entry.group === root),
    entries,
  );
  const known = new Set(tree.map((entry) => entry.identity));
  if (entries.length === 0 || tree.some((entry) => entry.group === root)) signal(-root, "SIGHUP");
  if (entries.length === 0) signal(root, "SIGHUP");
  for (const entry of tree) signal(entry.pid, "SIGHUP");
  const ended = await Promise.race([
    exited.then(() => true),
    delay(Math.max(0, deadline - Date.now()), false),
  ]);
  if (entries.length === 0) {
    if (!ended) signal(-root, "SIGKILL");
    return;
  }
  if (survivors(known, await listProcesses()).length === 0) return;
  await delay(Math.max(0, deadline - Date.now()));
  for (const entry of survivors(known, await listProcesses())) signal(entry.pid, "SIGKILL");
}
