import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type ProcessEntry,
  psTimeoutMs,
  readProcessTable,
  sameProcess,
  subtreeOf,
  windowsPowerShell,
} from "./process-table.ts";

export const forceKillGraceMs = 2000;
export const treeKillBoundMs = forceKillGraceMs + 2 * psTimeoutMs;
export const subtreeStopBoundMs = forceKillGraceMs + 4 * psTimeoutMs;
const taskkillTimeoutMs = treeKillBoundMs - forceKillGraceMs;
const termCheckMs = 300;
const killCheckMs = 200;
const windowsStopTimeoutMs = 5000;
const windowsStopChunk = 200;
const windowsStopVariable = "SATELLITE_STOP";
const windowsStopScript = `$ErrorActionPreference='Continue';foreach($pair in $env:${windowsStopVariable}.Split(',')){$id,$start=$pair.Split(':');try{$p=[Diagnostics.Process]::GetProcessById([int]$id);$null=$p.Handle;if([Math]::Abs(([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds()-[int64]$start) -le 1000){$p.Kill()}}catch{}}`;

export class StopRefused extends Error {}
export class StopNotConfirmed extends Error {}

export interface Delivery {
  readonly ready: boolean;
  send: (name: "SIGTERM" | "SIGKILL") => Promise<void>;
}
export type Prepare = (members: readonly ProcessEntry[]) => Promise<Delivery>;

async function readOrFail(
  read: () => Promise<ProcessEntry[]>,
  failure: new (message: string) => Error,
): Promise<ProcessEntry[]> {
  const table = await read();
  if (table.length === 0) throw new failure("the process table could not be read");
  return table;
}

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

function isKnown(known: readonly ProcessEntry[], entry: ProcessEntry): boolean {
  return known.some((candidate) => sameProcess(candidate, entry));
}

function survivors(
  known: readonly ProcessEntry[],
  entries: readonly ProcessEntry[],
): ProcessEntry[] {
  return withDescendants(
    entries.filter((entry) => isKnown(known, entry)),
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
  if (survivors(tree, await readProcessTable()).length === 0) return;
  await delay(Math.max(0, deadline - Date.now()));
  for (const entry of survivors(tree, await readProcessTable())) signal(entry.pid, "SIGKILL");
}

function mayBeSignalled(entry: ProcessEntry): boolean {
  return entry.pid > 1 && entry.pid !== process.pid;
}

async function freshSubtree(
  target: ProcessEntry,
  read: () => Promise<ProcessEntry[]>,
): Promise<ProcessEntry[]> {
  const table = await readOrFail(read, StopRefused);
  const found = table.find((entry) => sameProcess(entry, target));
  return found === undefined ? [] : subtreeOf(found, table).filter(mayBeSignalled);
}

function subtreeSurvivors(
  known: readonly ProcessEntry[],
  table: readonly ProcessEntry[],
): ProcessEntry[] {
  const found = new Map<number, ProcessEntry>();
  for (const entry of table.filter((candidate) => isKnown(known, candidate))) {
    for (const member of subtreeOf(entry, table)) found.set(member.pid, member);
  }
  return [...found.values()].filter((entry) => mayBeSignalled(entry) && !entry.defunct);
}

export function parseStartTicks(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const ticks = stat.slice(close + 2).split(" ")[19];
  return ticks !== undefined && /^\d+$/.test(ticks) ? ticks : null;
}

async function readStartTicks(pid: number): Promise<string | null> {
  try {
    return parseStartTicks(await readFile(`/proc/${String(pid)}/stat`, "utf8"));
  } catch {
    return null;
  }
}

export async function prepareLinux(
  members: readonly ProcessEntry[],
  startTicks: (pid: number) => Promise<string | null> = readStartTicks,
): Promise<Delivery> {
  const recorded = new Map<number, string>();
  for (const member of members) {
    const ticks = await startTicks(member.pid);
    if (ticks !== null) recorded.set(member.pid, ticks);
  }
  return {
    ready: recorded.size > 0,
    send: async (name) => {
      for (const member of members) {
        const expected = recorded.get(member.pid);
        if (expected !== undefined && (await startTicks(member.pid)) === expected) {
          signal(member.pid, name);
        }
      }
    },
  };
}

function prepareUnix(members: readonly ProcessEntry[]): Promise<Delivery> {
  return Promise.resolve({
    ready: true,
    send: (name) => {
      for (const member of members) signal(member.pid, name);
      return Promise.resolve();
    },
  });
}

export function windowsStopChunks(members: readonly ProcessEntry[]): string[] {
  const pairs = members.flatMap((member) =>
    Number.isSafeInteger(member.pid) &&
    member.pid > 0 &&
    member.started !== null &&
    Number.isSafeInteger(member.started)
      ? [`${String(member.pid)}:${String(member.started)}`]
      : [],
  );
  const chunks: string[] = [];
  for (let index = 0; index < pairs.length; index += windowsStopChunk) {
    chunks.push(pairs.slice(index, index + windowsStopChunk).join(","));
  }
  return chunks;
}

function runWindowsStop(pairs: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      windowsPowerShell(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsStopScript],
      {
        env: { ...process.env, [windowsStopVariable]: pairs },
        windowsHide: true,
        timeout: windowsStopTimeoutMs,
      },
      () => {
        resolve();
      },
    );
  });
}

function prepareWindows(members: readonly ProcessEntry[]): Promise<Delivery> {
  return Promise.resolve({
    ready: true,
    send: async () => {
      for (const chunk of windowsStopChunks(members)) await runWindowsStop(chunk);
    },
  });
}

function platformPrepare(): Prepare {
  if (process.platform === "win32") return prepareWindows;
  return process.platform === "linux" ? (members) => prepareLinux(members) : prepareUnix;
}

export async function endSubtree(
  target: ProcessEntry,
  read: () => Promise<ProcessEntry[]> = readProcessTable,
  prepare: Prepare = platformPrepare(),
): Promise<void> {
  const subtree = await freshSubtree(target, read);
  if (subtree.length === 0) return;
  const deadline = Date.now() + forceKillGraceMs;
  const first = await prepare(subtree);
  if (!first.ready) throw new StopRefused("the identity of the process could not be read");
  await first.send("SIGTERM");
  await delay(termCheckMs);
  const afterTerm = subtreeSurvivors(subtree, await readOrFail(read, StopNotConfirmed));
  if (afterTerm.length === 0) return;
  await delay(Math.max(0, deadline - Date.now()));
  const left = subtreeSurvivors(subtree, await readOrFail(read, StopNotConfirmed));
  if (left.length === 0) return;
  await (await prepare(left)).send("SIGKILL");
  await delay(killCheckMs);
  if (subtreeSurvivors(subtree, await readOrFail(read, StopNotConfirmed)).length > 0) {
    throw new StopNotConfirmed("the process is still running");
  }
}
