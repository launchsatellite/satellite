import { lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { errorCode, isMissing, restrictToUser } from "../platform/file-system.ts";

const folderName = "sessions";
const launchFile = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

async function isRealFolder(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function sessionsFolder(home: string): Promise<string> {
  const folder = join(home, folderName);
  await mkdir(folder, { mode: 0o700 }).catch((error: unknown) => {
    if (errorCode(error) !== "EEXIST") throw error;
  });
  if (!(await isRealFolder(folder)))
    throw new Error(`${folderName} in the Satellite home is not a folder`);
  await restrictToUser(folder);
  return folder;
}

export async function writeSettingsFile(
  home: string,
  launchId: string,
  settings: object,
): Promise<string> {
  const name = `${launchId}.json`;
  if (!launchFile.test(name)) throw new Error("A launch id must be a UUID");
  const path = join(await sessionsFolder(home), name);
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(settings));
  } catch (error) {
    await handle.close();
    await removeSettingsFile(path);
    throw error;
  }
  await handle.close();
  return path;
}

export async function removeSettingsFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export async function sweepSettingsFiles(home: string): Promise<void> {
  const folder = join(home, folderName);
  if (!(await isRealFolder(folder))) return;
  for (const name of await readdir(folder)) {
    if (!launchFile.test(name)) continue;
    const path = join(folder, name);
    const entry = await lstat(path).catch(() => undefined);
    if (entry?.isFile() !== true && entry?.isSymbolicLink() !== true) continue;
    await removeSettingsFile(path).catch((error: unknown) => {
      console.error("A leftover session settings file could not be removed", error);
    });
  }
}
