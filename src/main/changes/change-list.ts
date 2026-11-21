import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { changeLetter, changesLimits, type ChangeLetter } from "../../shared/bridge-contract.ts";
import { runGit } from "../workspaces/git-command.ts";
import {
  isChangePath,
  isPartialClone,
  lineCount,
  noLazyFetch,
  oidPattern,
  readWorktreeSide,
} from "./file-sides.ts";

export interface ChangeRecord {
  path: string;
  from: string | null;
  letter: ChangeLetter;
  tracked: boolean;
  kind: "text" | "binary" | "submodule" | "repository";
  added: number | null;
  removed: number | null;
  sourceOid: string | null;
  targetOid: string | null;
  stamp: string;
}
export type ListedChange = Omit<ChangeRecord, "stamp">;
export type ChangeListRead =
  | { kind: "files"; records: ChangeRecord[]; more: number }
  | { kind: "unavailable"; reason: "not-local" | "failed" };
export interface ParsedList {
  records: ListedChange[];
  more: number;
}
interface RawRecord {
  sourceMode: string;
  targetMode: string;
  sourceOid: string;
  targetOid: string;
  status: string;
  from: string | null;
  path: string;
}
interface StatRecord {
  added: string;
  removed: string;
  from: string | null;
  path: string;
}

export const changesReadMs = 15_000;

const rawHeader =
  /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([A-Z])\d{0,3}$/;
const statPrefix = /^(\d+|-)\t(\d+|-)\t/;
const unmergedPrefix = /^[0-7]{6} (?:[0-9a-f]{40}|[0-9a-f]{64}) [1-3]\t/;
const digits = /^\d+$/;
const allZeros = /^0+$/;
const countCap = 1_000_000;
const submoduleMode = "160000";
const stampBatch = 32;
const diffArgs = [
  "-c",
  "diff.autoRefreshIndex=false",
  "diff",
  "--raw",
  "--numstat",
  "-z",
  "-M",
  "--no-abbrev",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--no-relative",
  "--ignore-submodules=dirty",
];
const untrackedArgs = ["ls-files", "--others", "--exclude-standard", "-z"];
const unmergedArgs = ["ls-files", "--unmerged", "-z"];
const letters = new Set<string>(changeLetter.options);
const failed: ChangeListRead = { kind: "unavailable", reason: "failed" };
const notLocal: ChangeListRead = { kind: "unavailable", reason: "not-local" };

function isLetter(letter: string): letter is ChangeLetter {
  return letters.has(letter);
}

function nulFields(stdout: string): string[] | undefined {
  if (stdout === "") return [];
  return stdout.endsWith("\0") ? stdout.slice(0, -1).split("\0") : undefined;
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function namedPath(fields: string[], at: number): string | undefined {
  const path = fields[at];
  return path === undefined || path === "" ? undefined : path;
}

function parseRaw(fields: string[]): { raws: RawRecord[]; next: number } | undefined {
  const raws: RawRecord[] = [];
  let at = 0;
  while (fields[at]?.startsWith(":") === true) {
    const header = rawHeader.exec(fields[at] ?? "");
    if (header === null) return undefined;
    const [, sourceMode = "", targetMode = "", sourceOid = "", targetOid = "", status = ""] =
      header;
    if (sourceOid.length !== targetOid.length) return undefined;
    const paired = status === "R" || status === "C";
    const first = namedPath(fields, at + 1);
    const second = paired ? namedPath(fields, at + 2) : first;
    if (first === undefined || second === undefined) return undefined;
    const from = paired ? first : null;
    raws.push({ sourceMode, targetMode, sourceOid, targetOid, status, from, path: second });
    at += paired ? 3 : 2;
  }
  return { raws, next: at };
}

function parseStats(fields: string[], start: number): StatRecord[] | undefined {
  const stats: StatRecord[] = [];
  let at = start;
  while (at < fields.length) {
    const field = fields[at] ?? "";
    const prefix = statPrefix.exec(field);
    if (prefix === null) return undefined;
    const [whole, added = "", removed = ""] = prefix;
    if ((added === "-") !== (removed === "-")) return undefined;
    const rest = field.slice(whole.length);
    if (rest !== "") {
      stats.push({ added, removed, from: null, path: rest });
      at += 1;
      continue;
    }
    const from = namedPath(fields, at + 1);
    const path = namedPath(fields, at + 2);
    if (from === undefined || path === undefined) return undefined;
    stats.push({ added, removed, from, path });
    at += 3;
  }
  return stats;
}

function countOf(value: string): number | null {
  return digits.test(value) ? Math.min(Number(value), countCap) : null;
}

function listedChange(raw: RawRecord, stat: StatRecord): ListedChange | null {
  const letter = raw.status;
  if (!isLetter(letter)) return null;
  const submodule = raw.sourceMode === submoduleMode || raw.targetMode === submoduleMode;
  const binary = stat.added === "-";
  const counted = !submodule && !binary && letter !== "U";
  return {
    path: raw.path,
    from: raw.from,
    letter,
    tracked: true,
    kind: submodule ? "submodule" : binary ? "binary" : "text",
    added: counted ? countOf(stat.added) : null,
    removed: counted ? countOf(stat.removed) : null,
    sourceOid: allZeros.test(raw.sourceOid) ? null : raw.sourceOid,
    targetOid: allZeros.test(raw.targetOid) ? null : raw.targetOid,
  };
}

function unchangedContent(raw: RawRecord): boolean {
  return raw.status === "M" && raw.sourceMode === raw.targetMode;
}

function untrackedChange(field: string): ListedChange {
  const repository = field.endsWith("/");
  return {
    path: repository ? field.slice(0, -1) : field,
    from: null,
    letter: "A",
    tracked: false,
    kind: repository ? "repository" : "text",
    added: null,
    removed: null,
    sourceOid: null,
    targetOid: null,
  };
}

function inMerge(change: ListedChange): ListedChange {
  return { ...change, letter: "U", added: null, removed: null };
}

function withUnmerged(changes: ListedChange[], unmerged: readonly string[]): ListedChange[] {
  const paths = new Set(unmerged);
  const listed = new Set(changes.map((change) => change.path));
  const unlisted = [...paths].filter((path) => !listed.has(path));
  return [
    ...changes.map((change) => (paths.has(change.path) ? inMerge(change) : change)),
    ...unlisted.map((path) => inMerge({ ...untrackedChange(path), tracked: true })),
  ];
}

async function gitOutput(folder: string, args: string[], signal: AbortSignal) {
  return runGit(folder, args, changesReadMs, signal, { gitVariables: noLazyFetch });
}

async function countLines(folder: string, untracked: ListedChange[]): Promise<void> {
  let left = changesLimits.countedBytes;
  const counted = untracked.filter((change) => change.kind !== "repository");
  for (const change of counted.slice(0, changesLimits.countedFiles)) {
    if (left <= 0) return;
    const side = await readWorktreeSide(
      folder,
      change.path,
      Math.min(changesLimits.sideBytes, left),
    );
    if (side.kind === "binary") change.kind = "binary";
    if (side.kind !== "text") continue;
    change.added = lineCount(side.text);
    change.removed = 0;
    left -= Buffer.byteLength(side.text);
  }
}

async function stampOf(folder: string, change: ListedChange): Promise<string> {
  const source = change.sourceOid ?? "new";
  if (!isChangePath(change.path)) return `${source}:gone`;
  try {
    const entry = await lstat(join(folder, change.path), { bigint: true });
    return `${source}:${String(entry.size)}:${String(entry.mtimeNs)}`;
  } catch {
    return `${source}:gone`;
  }
}

async function stamped(folder: string, changes: ListedChange[]): Promise<ChangeRecord[]> {
  const records: ChangeRecord[] = [];
  for (let start = 0; start < changes.length; start += stampBatch) {
    const batch = changes.slice(start, start + stampBatch);
    const stamps = await Promise.all(batch.map((change) => stampOf(folder, change)));
    batch.forEach((change, index) => {
      records.push({ ...change, stamp: stamps[index] ?? `${change.sourceOid ?? "new"}:gone` });
    });
  }
  return records;
}

export function parseDiff(stdout: string): ParsedList | undefined {
  const fields = nulFields(stdout);
  if (fields === undefined) return undefined;
  const raw = parseRaw(fields);
  if (raw === undefined) return undefined;
  const stats = parseStats(fields, raw.next);
  if (stats === undefined) return undefined;
  const changes: ListedChange[] = [];
  let next = 0;
  for (const record of raw.raws) {
    const stat = stats[next];
    if (stat?.path !== record.path || stat.from !== record.from) {
      if (unchangedContent(record)) continue;
      return undefined;
    }
    next += 1;
    const change = listedChange(record, stat);
    if (change !== null) changes.push(change);
  }
  if (next !== stats.length) return undefined;
  return {
    records: changes.slice(0, changesLimits.parsed),
    more: Math.max(0, changes.length - changesLimits.parsed),
  };
}

export function parseUntracked(stdout: string): string[] | undefined {
  return nulFields(stdout)?.filter((field) => field !== "" && field !== "/");
}

export function parseUnmerged(stdout: string): string[] | undefined {
  const fields = nulFields(stdout);
  if (fields === undefined) return undefined;
  const paths = new Set<string>();
  for (const field of fields) {
    const prefix = unmergedPrefix.exec(field);
    const path = prefix === null ? "" : field.slice(prefix[0].length);
    if (path === "") return undefined;
    paths.add(path);
  }
  return [...paths];
}

export async function readChangeList(
  folder: string,
  compareWith: string,
  signal: AbortSignal,
): Promise<ChangeListRead> {
  if (!oidPattern.test(compareWith)) return failed;
  const [diff, others, conflicted] = await Promise.all([
    gitOutput(folder, [...diffArgs, compareWith, "--"], signal),
    gitOutput(folder, untrackedArgs, signal),
    gitOutput(folder, unmergedArgs, signal),
  ]);
  if (diff !== undefined && diff.exitCode !== 0 && !signal.aborted) {
    return (await isPartialClone(folder, signal)) ? notLocal : failed;
  }
  const parsed = diff?.exitCode === 0 ? parseDiff(diff.stdout) : undefined;
  const fields = others?.exitCode === 0 ? parseUntracked(others.stdout) : undefined;
  const unmerged = conflicted?.exitCode === 0 ? parseUnmerged(conflicted.stdout) : undefined;
  if (parsed === undefined || fields === undefined || unmerged === undefined) return failed;
  const untracked = fields.map(untrackedChange).sort(byPath);
  await countLines(folder, untracked);
  if (signal.aborted) return failed;
  const merged = [...withUnmerged(parsed.records, unmerged), ...untracked].sort(byPath);
  const kept = merged.slice(0, changesLimits.files);
  return {
    kind: "files",
    records: await stamped(folder, kept),
    more: merged.length - kept.length + parsed.more,
  };
}
