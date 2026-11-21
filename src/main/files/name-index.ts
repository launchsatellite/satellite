import { posix } from "node:path";
import { filesLimits } from "../../shared/bridge-contract.ts";
import { fuzzyScore } from "../../shared/fuzzy-match.ts";
import { confinedFolder, isChangePath } from "../changes/file-sides.ts";
import { noLazyFetch, readGit } from "../workspaces/git-command.ts";

type NameIndex =
  { kind: "names"; names: string[] } | { kind: "too-many" | "hung" | "failed" };

const findReadMs = 15_000;
const rankedPerTurn = 2000;
const readablePasses = 8;

interface Ranked {
  name: string;
  score: number;
}

function byRank(a: Ranked, b: Ranked): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.name.length !== b.name.length) return a.name.length - b.name.length;
  return a.name < b.name ? -1 : 1;
}

export async function readNames(
  root: string,
  signal?: AbortSignal,
  limit = filesLimits.findNames,
  timeoutMs = findReadMs,
): Promise<NameIndex> {
  const run = await readGit(
    root,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    timeoutMs,
    signal,
    { gitVariables: noLazyFetch },
  );
  if (run === "output") return { kind: "too-many" };
  if (run === "time" || run === "stuck") return { kind: "hung" };
  if (typeof run === "string" || run.exitCode !== 0) return { kind: "failed" };
  const names = new Set<string>();
  for (const name of run.stdout.split("\0")) {
    if (name.endsWith("/") || !isChangePath(name)) continue;
    names.add(name);
    if (names.size > limit) return { kind: "too-many" };
  }
  return { kind: "names", names: [...names] };
}

function keep(list: Ranked[], entry: Ranked): void {
  const last = list.at(-1);
  if (list.length >= filesLimits.findResults && last !== undefined && byRank(entry, last) >= 0) {
    return;
  }
  const at = list.findIndex((other) => byRank(entry, other) < 0);
  list.splice(at === -1 ? list.length : at, 0, entry);
  if (list.length > filesLimits.findResults) list.pop();
}

function nextTurn(): Promise<void> {
  return new Promise((settle) => {
    setImmediate(settle);
  });
}

export async function rankFiles(
  query: string,
  names: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const byName: Ranked[] = [];
  const byPath: Ranked[] = [];
  for (let from = 0; from < names.length; from += rankedPerTurn) {
    signal?.throwIfAborted();
    for (const name of names.slice(from, from + rankedPerTurn)) {
      const fileScore = fuzzyScore(query, name.slice(name.lastIndexOf("/") + 1));
      if (fileScore !== undefined) {
        keep(byName, { name, score: fileScore });
        continue;
      }
      const pathScore = fuzzyScore(query, name);
      if (pathScore !== undefined) keep(byPath, { name, score: pathScore });
    }
    await nextTurn();
  }
  signal?.throwIfAborted();
  return [...byName, ...byPath].slice(0, filesLimits.findResults).map((entry) => entry.name);
}

export async function readableNames(root: string, paths: readonly string[]): Promise<string[]> {
  const parents = new Map<string, Promise<boolean>>();
  const readable = (parent: string): Promise<boolean> => {
    const known = parents.get(parent);
    if (known !== undefined) return known;
    const asked = confinedFolder(root, parent).then((folder) => typeof folder === "string");
    parents.set(parent, asked);
    return asked;
  };
  const kept: string[] = [];
  for (const path of paths) if (await readable(posix.dirname(path))) kept.push(path);
  return kept;
}

export async function rankReadable(
  root: string,
  query: string,
  names: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const refused: string[] = [];
  for (let pass = 0; pass < readablePasses; pass += 1) {
    const pool =
      refused.length === 0
        ? names
        : names.filter((name) => !refused.some((parent) => name.startsWith(`${parent}/`)));
    const ranked = await rankFiles(query, pool, signal);
    const kept = await readableNames(root, ranked);
    if (kept.length === ranked.length || pass === readablePasses - 1) return kept;
    const readable = new Set(kept);
    for (const name of ranked) {
      const parent = posix.dirname(name);
      if (!readable.has(name) && !refused.includes(parent)) refused.push(parent);
    }
  }
  return [];
}
