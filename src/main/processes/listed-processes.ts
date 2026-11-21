import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { type ProcessEntry, subtreeOf } from "../platform/process-table.ts";

export interface SessionRoot {
  readonly session: string;
  readonly workspace: WorkspaceRef;
  readonly pid: number;
  readonly spawnedAt: number;
}

export interface OwnedProcess {
  readonly root: SessionRoot;
  readonly entry: ProcessEntry;
  readonly subtree: readonly ProcessEntry[];
}

interface Position {
  readonly entry: ProcessEntry;
  readonly root: SessionRoot;
  readonly shellAbove: boolean;
  readonly owned: boolean;
  readonly listed: boolean;
  readonly shadowed: boolean;
}

export const minimumAgeMs = 10_000;
export const rootSlackMs = 2000;
const shellNames = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "fish",
  "ksh",
  "cmd",
  "powershell",
  "pwsh",
]);

function mayBeOwned(entry: ProcessEntry): boolean {
  return entry.pid > 1 && entry.pid !== process.pid && !entry.defunct && entry.started !== null;
}

function isAged(entry: ProcessEntry, now: number | null): boolean {
  return now !== null && entry.started !== null && now - entry.started >= minimumAgeMs;
}

function positionsUnder(
  root: SessionRoot,
  entries: readonly ProcessEntry[],
  now: number | null,
  seen: Set<number>,
): Position[] {
  const rootEntry = entries.find((entry) => entry.pid === root.pid);
  if (rootEntry?.started == null || rootEntry.started > root.spawnedAt + rootSlackMs) return [];
  const found = new Map<number, Position>([
    [
      rootEntry.pid,
      { entry: rootEntry, root, shellAbove: false, owned: false, listed: false, shadowed: false },
    ],
  ]);
  seen.add(rootEntry.pid);
  for (const entry of subtreeOf(rootEntry, entries)) {
    const above = found.get(entry.parent);
    if (above === undefined || seen.has(entry.pid)) continue;
    seen.add(entry.pid);
    const shellAbove =
      above.shellAbove || (above.entry !== rootEntry && shellNames.has(above.entry.name));
    const owned = shellAbove && mayBeOwned(entry);
    const shadowed = above.shadowed || above.listed;
    found.set(entry.pid, {
      entry,
      root,
      shellAbove,
      owned,
      listed: owned && isAged(entry, now) && !shadowed,
      shadowed,
    });
  }
  return [...found.values()];
}

function positionsOf(
  entries: readonly ProcessEntry[],
  roots: readonly SessionRoot[],
  now: number | null,
): Position[] {
  const seen = new Set<number>();
  return roots.flatMap((root) => positionsUnder(root, entries, now, seen));
}

function ownedOf(position: Position, entries: readonly ProcessEntry[]): OwnedProcess {
  return {
    root: position.root,
    entry: position.entry,
    subtree: subtreeOf(position.entry, entries),
  };
}

function order(first: OwnedProcess, second: OwnedProcess): number {
  return (
    first.root.workspace.projectId.localeCompare(second.root.workspace.projectId) ||
    first.root.workspace.workspace.localeCompare(second.root.workspace.workspace) ||
    (first.entry.started ?? 0) - (second.entry.started ?? 0) ||
    first.entry.pid - second.entry.pid
  );
}

export function listedProcesses(
  entries: readonly ProcessEntry[],
  roots: readonly SessionRoot[],
  now: number,
): OwnedProcess[] {
  return positionsOf(entries, roots, now)
    .filter((position) => position.listed)
    .map((position) => ownedOf(position, entries))
    .sort(order);
}

export function ownedProcess(
  entries: readonly ProcessEntry[],
  roots: readonly SessionRoot[],
  pid: number,
  started: number,
): OwnedProcess | undefined {
  const position = positionsOf(entries, roots, null).find(
    (candidate) =>
      candidate.owned && candidate.entry.pid === pid && candidate.entry.started === started,
  );
  return position === undefined ? undefined : ownedOf(position, entries);
}
