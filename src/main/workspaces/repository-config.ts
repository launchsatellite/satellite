import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeFailure } from "../bridge/registry.ts";
import { isMissing } from "../platform/file-system.ts";
import { AbandonedRun, resolveTool, runTool, type ToolRun } from "../platform/tools.ts";

export type ConfigPair = readonly [key: string, value: string];
export interface ConfigEntry {
  scope: string;
  key: string;
  value: string | null;
}
export interface RepositoryConfig {
  blanks: ConfigPair[];
  partial: boolean;
  includes: boolean;
}
interface Known {
  stamp: string;
  config: RepositoryConfig;
}

const configReadMs = 5000;
const cachedFolders = 512;
const probeOid = "1".repeat(40);
const probeRemote = "satellite-lazy-fetch-probe";
const filterKey = /^filter\.(.+)\.(clean|process)$/s;
const includeKey = /^(include|includeif\..+)\.path$/s;
const configPattern =
  "^(filter\\..+\\.(clean|process)|include\\.path|includeif\\..+\\.path|remote\\..+\\.promisor|extensions\\.partialclone)$";
const ownScopes = new Set(["local", "worktree"]);
const falseWords = new Set(["false", "no", "off", "0", ""]);
export const partialCloneRefusal =
  "This git can't safely open a partial clone. Update git to 2.45 or newer, then try again.";

const verdicts = new Map<string, Promise<boolean>>();
const configFiles = new Map<string, Promise<string[] | undefined>>();
const known = new Map<string, Known>();

export function parseConfigEntries(stdout: string): ConfigEntry[] | undefined {
  if (stdout === "") return [];
  if (!stdout.endsWith("\0")) return undefined;
  const fields = stdout.slice(0, -1).split("\0");
  if (fields.length % 2 !== 0) return undefined;
  const entries: ConfigEntry[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const scope = fields[index] ?? "";
    const line = fields[index + 1] ?? "";
    const newline = line.indexOf("\n");
    entries.push(
      newline === -1
        ? { scope, key: line, value: null }
        : { scope, key: line.slice(0, newline), value: line.slice(newline + 1) },
    );
  }
  return entries;
}

export function readConfigEntries(entries: readonly ConfigEntry[]): RepositoryConfig {
  const drivers = new Set<string>();
  let partial = false;
  let includes = false;
  for (const { scope, key, value } of entries) {
    const own = ownScopes.has(scope);
    const driver = filterKey.exec(key)?.[1];
    if (own && driver !== undefined) drivers.add(driver);
    if (own && includeKey.test(key)) includes = true;
    if (key === "extensions.partialclone") partial = true;
    if (/^remote\..+\.promisor$/s.test(key) && !falseWords.has((value ?? "true").toLowerCase())) {
      partial = true;
    }
  }
  const blanks = [...drivers].flatMap((driver): ConfigPair[] => [
    [`filter.${driver}.clean`, ""],
    [`filter.${driver}.process`, ""],
    [`filter.${driver}.required`, "false"],
  ]);
  return { blanks, partial, includes };
}

export function lazyFetchVerdict(control: ToolRun | undefined, probe: ToolRun | undefined) {
  return (
    control !== undefined &&
    control.stderr.includes(probeRemote) &&
    probe !== undefined &&
    probe.exitCode !== 0 &&
    !probe.stderr.includes(probeRemote)
  );
}

export function refusesReads(honoursNoLazyFetch: boolean, config: RepositoryConfig | undefined) {
  return !honoursNoLazyFetch && config?.partial !== false;
}

function unlessAbandoned(error: unknown): undefined {
  if (error instanceof AbandonedRun) throw error;
  return undefined;
}

function quoted(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function probeLazyFetch(): Promise<boolean> {
  let folder: string | undefined;
  try {
    folder = await mkdtemp(join(tmpdir(), "satellite-lazy-"));
    const empty = join(folder, "empty");
    await mkdir(join(folder, "objects"));
    await mkdir(join(folder, "refs"));
    await writeFile(join(folder, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(empty, "");
    await writeFile(
      join(folder, "config"),
      `[core]\n\trepositoryformatversion = 1\n\tbare = true\n[extensions]\n\tpartialclone = origin\n[remote "origin"]\n\turl = ${quoted(join(folder, probeRemote))}\n\tpromisor = true\n`,
    );
    const once = (lazy: "0" | "1") =>
      runTool("git", ["--git-dir", folder ?? "", "cat-file", "-e", probeOid], {
        timeoutMs: configReadMs,
        gitVariables: {
          GIT_NO_LAZY_FETCH: lazy,
          GIT_CONFIG_GLOBAL: empty,
          GIT_CONFIG_SYSTEM: empty,
        },
      });
    return lazyFetchVerdict(await once("0"), await once("1"));
  } catch {
    return false;
  } finally {
    if (folder !== undefined)
      await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function honoursNoLazyFetch(): Promise<boolean> {
  const command = await resolveTool("git");
  if (command === undefined) return true;
  const key = JSON.stringify(command);
  let verdict = verdicts.get(key);
  if (verdict === undefined) {
    verdict = probeLazyFetch();
    verdicts.set(key, verdict);
  }
  return verdict;
}

async function readFiles(folder: string): Promise<string[] | undefined> {
  const run = await runTool(
    "git",
    ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir"],
    { timeoutMs: configReadMs },
  ).catch(unlessAbandoned);
  const [common, own, rest] = run?.exitCode === 0 ? run.stdout.split("\n") : [];
  if (common === undefined || own === undefined || rest !== "") return undefined;
  return [join(common, "config"), join(own, "config.worktree")];
}

async function stampOf(files: readonly string[]): Promise<string | undefined> {
  const parts: string[] = [];
  for (const file of files) {
    try {
      const info = await stat(file, { bigint: true });
      parts.push(
        `${String(info.ino)}:${String(info.size)}:${String(info.mtimeNs)}:${String(info.ctimeNs)}`,
      );
    } catch (error) {
      if (!isMissing(error)) return undefined;
      parts.push("-");
    }
  }
  return parts.join(" ");
}

async function readConfig(folder: string): Promise<RepositoryConfig | undefined> {
  const run = await runTool(
    "git",
    ["-C", folder, "config", "--show-scope", "--includes", "-z", "--get-regexp", configPattern],
    { timeoutMs: configReadMs },
  ).catch(unlessAbandoned);
  if (run === undefined || (run.exitCode !== 0 && !(run.exitCode === 1 && run.stdout === ""))) {
    return undefined;
  }
  const entries = parseConfigEntries(run.stdout);
  return entries === undefined ? undefined : readConfigEntries(entries);
}

export async function repositoryConfig(folder: string): Promise<RepositoryConfig | undefined> {
  let files = configFiles.get(folder);
  if (files === undefined) {
    if (configFiles.size >= cachedFolders) configFiles.clear();
    files = readFiles(folder);
    configFiles.set(folder, files);
    const forget = () => {
      if (configFiles.get(folder) === files) configFiles.delete(folder);
    };
    void files.then((found) => {
      if (found === undefined) forget();
    }, forget);
  }
  const found = await files;
  const stamp = found === undefined ? undefined : await stampOf(found);
  const cached = known.get(folder);
  if (stamp !== undefined && cached?.stamp === stamp) return cached.config;
  const config = await readConfig(folder);
  if (config === undefined || stamp === undefined || config.includes) known.delete(folder);
  else {
    if (known.size >= cachedFolders) known.clear();
    known.set(folder, { stamp, config });
  }
  return config;
}

export async function refusePartialClone(folder: string): Promise<void> {
  if (await honoursNoLazyFetch()) return;
  if (refusesReads(false, await repositoryConfig(folder))) {
    throw new BridgeFailure("tool-missing", partialCloneRefusal);
  }
}
