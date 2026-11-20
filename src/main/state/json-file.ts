import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { open, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { z } from "zod";

export type JsonReadOutcome =
  | { kind: "read" }
  | { kind: "missing" }
  | { kind: "set-aside"; name: string }
  | { kind: "not-moved" }
  | { kind: "not-read" };
export interface JsonWriter {
  write(value: unknown): Promise<void>;
  flush(): Promise<void>;
}
interface PendingWrite {
  value: unknown;
  settled: PromiseWithResolvers<void>;
}

const maxFileBytes = 1024 * 1024;
const renameRetries = 5;
const renameRetryMs = 50;
const retriedRenameCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
const keptSetAside = 5;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function isTempOf(name: string, base: string): boolean {
  const prefix = `.${base}.`;
  const suffix = ".tmp";
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return false;
  return uuid.test(name.slice(prefix.length, -suffix.length));
}

async function removeLeftovers(file: string): Promise<void> {
  const folder = dirname(file);
  const base = basename(file);
  const names = await readdir(folder).catch(() => []);
  for (const name of names.filter((candidate) => isTempOf(candidate, base))) {
    await unlink(join(folder, name)).catch(() => undefined);
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let retry = 0; ; retry += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      const retried = typeof code === "string" && retriedRenameCodes.has(code);
      if (!retried || retry >= renameRetries) throw error;
      await delay(renameRetryMs);
    }
  }
}

function setAsideTime(candidate: string, name: string): number | undefined {
  const prefix = `${name}.unreadable-`;
  const suffix = ".json";
  if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) return undefined;
  const time = candidate.slice(prefix.length, -suffix.length);
  return /^\d+$/.test(time) ? Number(time) : undefined;
}

async function keepNewestSetAside(dir: string, name: string): Promise<void> {
  const names = await readdir(dir).catch(() => []);
  const setAside = names
    .flatMap((candidate) => {
      const time = setAsideTime(candidate, name);
      return time === undefined ? [] : [{ candidate, time }];
    })
    .sort((a, b) => b.time - a.time);
  for (const { candidate } of setAside.slice(keptSetAside)) {
    await unlink(join(dir, candidate)).catch(() => undefined);
  }
}

async function setAside(file: string): Promise<JsonReadOutcome> {
  const { dir, name } = parse(file);
  const aside = `${name}.unreadable-${String(Date.now())}.json`;
  try {
    await renameWithRetry(file, join(dir, aside));
    await keepNewestSetAside(dir, name);
    return { kind: "set-aside", name: aside };
  } catch {
    return { kind: "not-moved" };
  }
}

function parseJson(text: string): { ok: true; json: unknown } | { ok: false } {
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function isSmallRegularFile(info: Stats): boolean {
  return info.isFile() && info.size <= maxFileBytes;
}

async function readSmallFile(
  file: string,
): Promise<{ kind: "missing" } | { kind: "unfit" } | { kind: "text"; text: string }> {
  let info: Stats;
  try {
    info = await stat(file);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "missing" };
    throw error;
  }
  if (!isSmallRegularFile(info)) return { kind: "unfit" };
  const handle = await open(file, "r");
  try {
    if (!isSmallRegularFile(await handle.stat())) return { kind: "unfit" };
    return { kind: "text", text: await handle.readFile("utf8") };
  } finally {
    await handle.close();
  }
}

async function writeAtomically(file: string, value: unknown): Promise<void> {
  const temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function readJsonFile<T>(
  file: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<{ value: T; outcome: JsonReadOutcome }> {
  await removeLeftovers(file);
  let text: string;
  try {
    const read = await readSmallFile(file);
    if (read.kind === "missing") return { value: fallback, outcome: { kind: "missing" } };
    if (read.kind === "unfit") return { value: fallback, outcome: await setAside(file) };
    text = read.text;
  } catch {
    return { value: fallback, outcome: { kind: "not-read" } };
  }
  const parsedJson = parseJson(text);
  const parsed = parsedJson.ok ? schema.safeParse(parsedJson.json) : undefined;
  if (parsed?.success === true) return { value: parsed.data, outcome: { kind: "read" } };
  return { value: fallback, outcome: await setAside(file) };
}

export function createJsonWriter(file: string): JsonWriter {
  let pending: PendingWrite | undefined;
  let writing: Promise<void> | undefined;
  const pump = (): void => {
    const next = pending;
    pending = undefined;
    if (next === undefined) {
      writing = undefined;
      return;
    }
    writing = writeAtomically(file, next.value)
      .then(
        () => {
          next.settled.resolve();
        },
        (error: unknown) => {
          next.settled.reject(error);
        },
      )
      .then(pump);
  };
  return {
    write(value) {
      pending ??= { value, settled: Promise.withResolvers() };
      pending.value = value;
      const settled = pending.settled.promise;
      if (writing === undefined) pump();
      return settled;
    },
    async flush() {
      while (writing !== undefined) await writing;
    },
  };
}
