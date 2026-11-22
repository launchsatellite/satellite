import { changeLetter, changesLimits, type ChangeLetter } from "../../shared/bridge-contract.ts";
import { storedObjects, readGit, type GitStop } from "../workspaces/git-command.ts";
import type { ToolRun } from "../platform/tools.ts";
import { isObjectName, lineCount, readWorktreeSide, worktreeStamps } from "./file-sides.ts";

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
  shape?: "link" | "mode";
  stamp: string;
}
type ListedChange = Omit<ChangeRecord, "stamp"> & { statDirty?: true };
type ChangeListRead =
  | {
      kind: "files";
      records: ChangeRecord[];
      more: number;
      longPaths: number;
      untrackedLeftOut: boolean;
    }
  | { kind: "unavailable"; reason: "not-local" | "too-many" | "hung" | "failed" };
interface ParsedList {
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

const changesReadMs = 15_000;

const rawHeader =
  /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([A-Z])\d{0,3}$/;
const statPrefix = /^(\d+|-)\t(\d+|-)\t/;
const unmergedPrefix = /^[0-7]{6} (?:[0-9a-f]{40}|[0-9a-f]{64}) [1-3]\t/;
const digits = /^\d+$/;
const allZeros = /^0+$/;
const promisorMissing = /^fatal: could not fetch [0-9a-f]+ from promisor remote$/m;
const lazyFetchOff = /^warning: lazy fetching disabled/m;
const objectUnread = /^fatal: unable to read [0-9a-f]+$/m;
const countCap = 1_000_000;
const touchedFiles = 50;
const touchedKept = 512;
const touchedVerdicts = new Map<string, boolean>();
const touchedBytes = 33_554_432;
const submoduleMode = "160000";
const linkMode = "120000";
const diffWithoutIndexWrite = [
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
let lateLists = 0;
const letters = new Set<string>(changeLetter.options);
const failed: ChangeListRead = { kind: "unavailable", reason: "failed" };
const notLocal: ChangeListRead = { kind: "unavailable", reason: "not-local" };
const tooMany: ChangeListRead = { kind: "unavailable", reason: "too-many" };
const hung: ChangeListRead = { kind: "unavailable", reason: "hung" };

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
  const link = !submodule && (raw.sourceMode === linkMode || raw.targetMode === linkMode);
  const modeOnly =
    !submodule &&
    !link &&
    !binary &&
    (letter === "M" || letter === "R") &&
    raw.sourceMode !== raw.targetMode &&
    stat.added === "0" &&
    stat.removed === "0";
  return {
    path: raw.path,
    from: raw.from,
    letter,
    tracked: true,
    kind: submodule ? "submodule" : binary ? "binary" : "text",
    added: counted ? countOf(stat.added) : null,
    removed: counted ? countOf(stat.removed) : null,
    ...(link ? { shape: "link" as const } : modeOnly ? { shape: "mode" as const } : {}),
    sourceOid: allZeros.test(raw.sourceOid) ? null : raw.sourceOid,
    targetOid: allZeros.test(raw.targetOid) ? null : raw.targetOid,
    ...(binary && unchangedContent(raw) && allZeros.test(raw.targetOid) ? { statDirty: true } : {}),
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
  return readGit(folder, args, changesReadMs, signal, { gitVariables: storedObjects });
}

function stdoutOf(run: ToolRun | GitStop): string | undefined {
  return typeof run === "object" && run.exitCode === 0 ? run.stdout : undefined;
}

function isNamed(change: ListedChange): boolean {
  return (
    change.path.length <= changesLimits.pathChars &&
    (change.from?.length ?? 0) <= changesLimits.pathChars
  );
}

function oncePerPath(changes: ListedChange[]): { kept: ListedChange[]; collapsed: number } {
  const seen = new Set<string>();
  let collapsed = 0;
  const kept = changes.filter((change) => {
    if (seen.has(change.path)) {
      if (change.path.includes("\ufffd")) collapsed += 1;
      return false;
    }
    seen.add(change.path);
    return true;
  });
  return { kept, collapsed };
}

function sizeOfStamp(stamp: string | undefined): number | undefined {
  const size = /^(\d{1,16}):/.exec(stamp ?? "")?.[1];
  return size === undefined ? undefined : Number(size);
}

async function withoutTouched(
  folder: string,
  changes: ListedChange[],
  signal: AbortSignal,
): Promise<ListedChange[]> {
  const candidates = changes.filter((change) => change.statDirty === true && change.letter !== "U");
  if (candidates.length === 0) return changes;
  const stamps = await worktreeStamps(
    folder,
    candidates.map((change) => change.path),
    signal,
  );
  const unchanged = new Set<ListedChange>();
  let left = touchedBytes;
  for (const change of candidates.slice(0, touchedFiles)) {
    const stamp = stamps.get(change.path);
    const size = sizeOfStamp(stamp);
    if (size === undefined || signal.aborted || change.sourceOid === null) continue;
    const key = `${folder}\0${change.path}\0${stamp ?? ""}\0${change.sourceOid}`;
    let same = touchedVerdicts.get(key);
    if (same === undefined) {
      if (size > left) continue;
      left -= size;
      const hashed = await gitOutput(
        folder,
        ["hash-object", "--no-filters", "--", change.path],
        signal,
      );
      const hash = stdoutOf(hashed)?.trim();
      if (hash === undefined) continue;
      same = hash === change.sourceOid;
      touchedVerdicts.set(key, same);
      const oldest = touchedVerdicts.keys().next().value;
      if (touchedVerdicts.size > touchedKept && oldest !== undefined)
        touchedVerdicts.delete(oldest);
    }
    if (same) unchanged.add(change);
  }
  return changes.filter((change) => !unchanged.has(change));
}

async function countLines(
  folder: string,
  untracked: ListedChange[],
  signal: AbortSignal,
): Promise<void> {
  let left = changesLimits.countedBytes;
  const counted = untracked.filter((change) => change.kind !== "repository");
  for (const change of counted.slice(0, changesLimits.countedFiles)) {
    if (left <= 0 || signal.aborted) return;
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

function notInWorktree(record: ChangeRecord): ChangeRecord {
  const letter = record.letter === "M" || record.letter === "T" ? "D" : record.letter;
  return { ...record, letter, added: null, removed: null };
}

async function stamped(
  folder: string,
  changes: ListedChange[],
  signal: AbortSignal,
): Promise<ChangeRecord[]> {
  lateLists += 1;
  const late = `late:${String(lateLists)}`;
  const stamps = await worktreeStamps(
    folder,
    changes.map((change) => change.path),
    signal,
  );
  return changes.flatMap((change) => {
    const stamp = stamps.get(change.path) ?? late;
    const record = { ...change, stamp: `${change.sourceOid ?? "new"}:${stamp}` };
    if (stamp !== "gone" || record.letter === "D") return [record];
    return record.tracked ? [notInWorktree(record)] : [];
  });
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
  if (changes.length > changesLimits.parsed) changes.sort(byPath);
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
  if (!(await isObjectName(folder, compareWith, signal))) return failed;
  const [diff, others, conflicted] = await Promise.all([
    gitOutput(folder, [...diffWithoutIndexWrite, compareWith, "--"], signal),
    gitOutput(folder, untrackedArgs, signal),
    gitOutput(folder, unmergedArgs, signal),
  ]);
  const untrackedLeftOut = others === "output";
  const runs = [diff, untrackedLeftOut ? "" : others, conflicted];
  if (runs.includes("output")) return tooMany;
  if (runs.includes("time") || runs.includes("stuck")) return hung;
  if (typeof diff === "object" && diff.exitCode !== 0) {
    const missing =
      promisorMissing.test(diff.stderr) ||
      (lazyFetchOff.test(diff.stderr) && objectUnread.test(diff.stderr));
    return missing ? notLocal : failed;
  }
  const diffOut = stdoutOf(diff);
  const othersOut = untrackedLeftOut ? "" : stdoutOf(others);
  const conflictedOut = stdoutOf(conflicted);
  const parsed = diffOut === undefined ? undefined : parseDiff(diffOut);
  const fields = othersOut === undefined ? undefined : parseUntracked(othersOut);
  const unmerged = conflictedOut === undefined ? undefined : parseUnmerged(conflictedOut);
  if (parsed === undefined || fields === undefined || unmerged === undefined) return failed;
  const untracked = fields.map(untrackedChange).sort(byPath);
  await countLines(folder, untracked, signal);
  if (signal.aborted) return failed;
  const once = oncePerPath([...withUnmerged(parsed.records, unmerged), ...untracked]);
  const merged = await withoutTouched(folder, once.kept, signal);
  const named = merged.filter(isNamed).sort(byPath);
  const kept = named.slice(0, changesLimits.files);
  return {
    kind: "files",
    records: await stamped(folder, kept, signal),
    more: named.length - kept.length + parsed.more + once.collapsed,
    longPaths: merged.length - named.length,
    untrackedLeftOut,
  };
}
