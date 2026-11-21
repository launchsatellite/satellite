import { filesLimits } from "../../shared/bridge-contract.ts";
import { fuzzyScore } from "../../shared/fuzzy-match.ts";
import { isChangePath } from "../changes/file-sides.ts";
import { noLazyFetch, readGit } from "../workspaces/git-command.ts";

export type NameIndex =
  { kind: "names"; names: string[] } | { kind: "too-many" | "hung" | "failed" };

export const findReadMs = 15_000;
const rankedPerTurn = 2000;

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
