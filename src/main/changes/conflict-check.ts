import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { changesLimits } from "../../shared/bridge-contract.ts";
import { isMissing } from "../platform/file-system.ts";
import { isFullyQualified } from "../platform/paths.ts";
import {
  gitReadMs,
  storedObjects,
  readGit,
  runGit,
  whenGitExits,
} from "../workspaces/git-command.ts";
import { isObjectName, oidPattern } from "./file-sides.ts";

export type ConflictCheck =
  | { kind: "none" }
  | { kind: "files"; files: number; names: string[] }
  | { kind: "old-git" }
  | { kind: "slow" }
  | { kind: "unchecked" };

const conflictReadMs = 15_000;

const quarantineFolder = "quarantine";
const noConfigFile = "no-config";
const unsupportedExit = 129;
const countCap = 1_000_000;
const cachedChecks = 512;
export const retryFailedMs = 30_000;
export const retryOldGitMs = 600_000;
const none: ConflictCheck = { kind: "none" };
const oldGit: ConflictCheck = { kind: "old-git" };
const slow: ConflictCheck = { kind: "slow" };
const unchecked: ConflictCheck = { kind: "unchecked" };
const shallowBytes = 1_048_576;
const results = new Map<string, { found: ConflictCheck | null; at: number }>();
const sweeps = new Map<string, Promise<void>>();
let unsupportedAt: number | null = null;
let queue: Promise<unknown> = Promise.resolve();

function sweep(home: string): Promise<void> {
  const known = sweeps.get(home);
  if (known !== undefined) return known;
  const swept = rm(join(home, quarantineFolder), { recursive: true, force: true }).catch(
    () => undefined,
  );
  sweeps.set(home, swept);
  return swept;
}

function isUsablePath(path: string): boolean {
  return (
    isFullyQualified(path) &&
    !path.includes(delimiter) &&
    !path.includes("\n") &&
    !path.includes("\r") &&
    !path.startsWith('"')
  );
}

function parseConflicts(stdout: string): ConflictCheck | undefined {
  if (!stdout.endsWith("\0")) return undefined;
  const [, ...fields] = stdout.slice(0, -1).split("\0");
  const names = [...new Set(fields.filter((field) => field !== ""))];
  if (names.length === 0) return undefined;
  return {
    kind: "files",
    files: Math.min(names.length, countCap),
    names: names
      .filter((name) => name.length <= changesLimits.pathChars)
      .slice(0, changesLimits.conflictNames),
  };
}

async function gitPath(
  folder: string,
  name: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const run = await runGit(
    folder,
    ["rev-parse", "--path-format=absolute", "--git-path", name],
    gitReadMs,
    signal,
    { gitVariables: storedObjects },
  );
  if (run?.exitCode !== 0 || !run.stdout.endsWith("\n")) return undefined;
  return run.stdout.slice(0, -1);
}

async function shallowLines(path: string): Promise<string | null | undefined> {
  if (!isFullyQualified(path)) return undefined;
  const info = await stat(path).catch((error: unknown) => (isMissing(error) ? null : undefined));
  if (info === null) return null;
  if (info === undefined || !info.isFile() || info.size > shallowBytes) return undefined;
  const text = await readFile(path, "utf8");
  const lines = text.split("\n");
  if (lines.pop() !== "" || !lines.every((line) => oidPattern.test(line))) return undefined;
  return text;
}

async function makeScratchRepository(
  home: string,
  folder: string,
  sha256: boolean,
  shallow: string | null,
): Promise<void> {
  const root = join(home, quarantineFolder);
  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  await mkdir(folder, { mode: 0o700 });
  await mkdir(join(folder, "objects"), { mode: 0o700 });
  await mkdir(join(folder, "refs"), { mode: 0o700 });
  await writeFile(join(folder, "HEAD"), "ref: refs/heads/main\n");
  await writeFile(join(folder, noConfigFile), "");
  if (shallow !== null) await writeFile(join(folder, "shallow"), shallow);
  if (sha256) {
    await writeFile(
      join(folder, "config"),
      "[core]\n\trepositoryformatversion = 1\n\tbare = true\n[extensions]\n\tobjectformat = sha256\n",
    );
  }
}

async function trialMerge(
  home: string,
  folder: string,
  head: string,
  base: string,
  signal?: AbortSignal,
): Promise<ConflictCheck | undefined> {
  const objects = await gitPath(folder, "objects", signal);
  const shallowPath = await gitPath(folder, "shallow", signal);
  if (objects === undefined || shallowPath === undefined) return undefined;
  signal?.throwIfAborted();
  if (!isUsablePath(objects)) return unchecked;
  const shallow = await shallowLines(shallowPath);
  if (shallow === undefined) return unchecked;
  const scratch = join(home, quarantineFolder, randomUUID());
  let stuck = false;
  try {
    await makeScratchRepository(home, scratch, head.length === 64, shallow);
    const run = await readGit(
      scratch,
      [
        "--git-dir",
        scratch,
        "merge-tree",
        "--write-tree",
        "--name-only",
        "--no-messages",
        "-z",
        head,
        base,
      ],
      conflictReadMs,
      signal,
      {
        gitVariables: {
          GIT_ALTERNATE_OBJECT_DIRECTORIES: objects,
          GIT_CONFIG_GLOBAL: join(scratch, noConfigFile),
          GIT_CONFIG_SYSTEM: join(scratch, noConfigFile),
        },
      },
    );
    stuck = run === "stuck";
    if (run === "time" || run === "stuck") return slow;
    if (typeof run === "string") {
      signal?.throwIfAborted();
      return undefined;
    }
    if (run.exitCode === unsupportedExit) {
      unsupportedAt = Date.now();
      return oldGit;
    }
    if (run.exitCode === 0) return none;
    return run.exitCode === 1 ? parseConflicts(run.stdout) : undefined;
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    if (stuck) {
      void whenGitExits(scratch).then(() =>
        rm(scratch, { recursive: true, force: true }).catch(() => undefined),
      );
    }
  }
}

async function oneAtATime<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  const turn = queue.then(
    () => undefined,
    () => undefined,
  );
  const running = turn.then(() => {
    signal?.throwIfAborted();
    return work();
  });
  queue = running;
  return running;
}

function isOldGit(): boolean {
  if (unsupportedAt === null) return false;
  if (Date.now() - unsupportedAt < retryOldGitMs) return true;
  unsupportedAt = null;
  return false;
}

function remembered(key: string): ConflictCheck | null | undefined {
  const known = results.get(key);
  if (known === undefined) return undefined;
  if (known.found === null || known.found.kind === "slow") {
    if (Date.now() - known.at >= retryFailedMs) {
      results.delete(key);
      return undefined;
    }
  }
  results.delete(key);
  results.set(key, known);
  return known.found;
}

export function knownConflict(
  folder: string,
  head: string,
  base: string,
): ConflictCheck | null | undefined {
  if (isOldGit()) return oldGit;
  return remembered(`${folder}\0${head}\0${base}`);
}

export async function conflictCheck(
  home: string,
  folder: string,
  head: string,
  base: string,
  signal?: AbortSignal,
): Promise<ConflictCheck | null> {
  await sweep(home);
  if (isOldGit()) return oldGit;
  const key = `${folder}\0${head}\0${base}`;
  const known = remembered(key);
  if (known !== undefined) return known;
  const named =
    (await isObjectName(folder, head, signal)) && (await isObjectName(folder, base, signal));
  signal?.throwIfAborted();
  if (!named) return null;
  return oneAtATime(signal, async () => {
    const found = (await trialMerge(home, folder, head, base, signal)) ?? null;
    if (found?.kind === "old-git") return found;
    results.set(key, { found, at: Date.now() });
    const oldest = results.keys().next().value;
    if (results.size > cachedChecks && oldest !== undefined) results.delete(oldest);
    return found;
  });
}
