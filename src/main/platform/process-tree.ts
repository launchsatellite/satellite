import { execFile } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type ProcessEntry, psTimeoutMs, readProcessTable, subtreeOf } from "./process-table.ts";

export const forceKillGraceMs = 2000;
export const treeKillBoundMs = forceKillGraceMs + 2 * psTimeoutMs;
export const subtreeStopBoundMs = forceKillGraceMs + 3 * psTimeoutMs;
const taskkillTimeoutMs = treeKillBoundMs - forceKillGraceMs;
const termCheckMs = 300;

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    return;
  }
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
    execFile(
      taskkill,
      ["/pid", String(pid), "/T", "/F"],
      { windowsHide: true, timeout: taskkillTimeoutMs },
      () => {
        resolve();
      },
    );
  });
}

export async function endUnixTree(
  root: number,
  exited: Promise<void>,
  graceMs: number,
): Promise<void> {
  const deadline = Date.now() + graceMs;
  const entries = await readProcessTable();
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
  if (survivors(known, await readProcessTable()).length === 0) return;
  await delay(Math.max(0, deadline - Date.now()));
  for (const entry of survivors(known, await readProcessTable())) signal(entry.pid, "SIGKILL");
}

function mayBeSignalled(entry: ProcessEntry): boolean {
  return entry.pid > 1 && entry.pid !== process.pid;
}

async function freshSubtree(target: ProcessEntry): Promise<ProcessEntry[]> {
  const table = await readProcessTable();
  const found = table.find((entry) => entry.identity === target.identity);
  return found === undefined ? [] : subtreeOf(found, table).filter(mayBeSignalled);
}

function subtreeSurvivors(
  known: ReadonlySet<string>,
  table: readonly ProcessEntry[],
): ProcessEntry[] {
  const found = new Map<number, ProcessEntry>();
  for (const entry of table.filter((candidate) => known.has(candidate.identity))) {
    for (const member of subtreeOf(entry, table)) found.set(member.pid, member);
  }
  return [...found.values()].filter(mayBeSignalled);
}

export async function endSubtree(target: ProcessEntry): Promise<void> {
  const subtree = await freshSubtree(target);
  if (subtree.length === 0) return;
  if (process.platform === "win32") {
    const taskkill = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
    const ids = subtree.flatMap((entry) => ["/PID", String(entry.pid)]);
    await new Promise<void>((resolve) => {
      execFile(taskkill, ["/F", ...ids], { windowsHide: true, timeout: taskkillTimeoutMs }, () => {
        resolve();
      });
    });
    return;
  }
  const deadline = Date.now() + forceKillGraceMs;
  const known = new Set(subtree.map((entry) => entry.identity));
  for (const entry of subtree) signal(entry.pid, "SIGTERM");
  await delay(termCheckMs);
  if (subtreeSurvivors(known, await readProcessTable()).length === 0) return;
  await delay(Math.max(0, deadline - Date.now()));
  for (const entry of subtreeSurvivors(known, await readProcessTable())) {
    signal(entry.pid, "SIGKILL");
  }
}
