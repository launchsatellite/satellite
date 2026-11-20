import { randomUUID } from "node:crypto";
import { open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { z } from "zod";

const renameRetries = 5;
const renameRetryMs = 50;
const retriedRenameCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
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

async function setAside(file: string): Promise<string | undefined> {
  const { dir, name } = parse(file);
  const aside = `${name}.unreadable-${String(Date.now())}.json`;
  try {
    await rename(file, join(dir, aside));
    return aside;
  } catch {
    return undefined;
  }
}

function parseJson(text: string): { ok: true; json: unknown } | { ok: false } {
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false };
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
): Promise<{ value: T; setAside: string | undefined }> {
  await removeLeftovers(file);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { value: fallback, setAside: undefined };
    return { value: fallback, setAside: await setAside(file) };
  }
  const parsedJson = parseJson(text);
  const parsed = parsedJson.ok ? schema.safeParse(parsedJson.json) : undefined;
  if (parsed?.success === true) return { value: parsed.data, setAside: undefined };
  return { value: fallback, setAside: await setAside(file) };
}

export function createJsonWriter(file: string): (value: unknown) => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  return (value) => {
    const write = queue.then(() => writeAtomically(file, value));
    queue = write.catch(() => undefined);
    return write;
  };
}
