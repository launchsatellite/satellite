import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { removeSettingsFile, sweepSettingsFiles, writeSettingsFile } from "./settings-files.ts";

const held = vi.hoisted(() => new Set<string>());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    unlink: (path: string) =>
      held.has(path)
        ? Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" }))
        : actual.unlink(path),
  };
});

const posixOnly = process.platform === "win32";

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), "satellite-settings-"));
}

describe("settings files", () => {
  it.skipIf(posixOnly)("writes the file only its owner can read", async () => {
    const folder = await home();
    const launchId = randomUUID();
    const path = await writeSettingsFile(folder, launchId, { hooks: {} });
    expect(path).toBe(join(folder, "sessions", `${launchId}.json`));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(folder, "sessions"))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ hooks: {} });
    await removeSettingsFile(path);
    await removeSettingsFile(path);
    expect(await readdir(join(folder, "sessions"))).toEqual([]);
  });

  it("never overwrites a file", async () => {
    const folder = await home();
    const launchId = randomUUID();
    const path = await writeSettingsFile(folder, launchId, { first: true });
    await expect(writeSettingsFile(folder, launchId, { second: true })).rejects.toThrow();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ first: true });
    await expect(writeSettingsFile(folder, "../escape", {})).rejects.toThrow();
  });

  it.skipIf(posixOnly)("never writes through a link", async () => {
    const folder = await home();
    const outside = await home();
    const launchId = randomUUID();
    await mkdir(join(folder, "sessions"));
    await symlink(join(outside, "target.json"), join(folder, "sessions", `${launchId}.json`));
    await expect(writeSettingsFile(folder, launchId, {})).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
    const linked = await home();
    await symlink(outside, join(linked, "sessions"));
    await expect(writeSettingsFile(linked, randomUUID(), {})).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });

  it("sweeps only leftover launch files", async () => {
    const folder = await home();
    const outside = await home();
    const sessions = join(folder, "sessions");
    const leftover = await writeSettingsFile(folder, randomUUID(), {});
    const target = join(outside, `${randomUUID()}.json`);
    await writeFile(target, "{}");
    const linkName = `${randomUUID()}.json`;
    const linkMade = await symlink(target, join(sessions, linkName)).then(
      () => true,
      () => false,
    );
    const kept = ["notes.txt", `${randomUUID()}.txt`, `${randomUUID().toUpperCase()}.json`];
    for (const name of kept) await writeFile(join(sessions, name), "");
    const keptFolder = `${randomUUID()}.json`;
    await mkdir(join(sessions, keptFolder));
    await writeFile(join(sessions, keptFolder, `${randomUUID()}.json`), "");
    await sweepSettingsFiles(folder);
    await expect(lstat(leftover)).rejects.toThrow();
    if (linkMade) await expect(lstat(join(sessions, linkName))).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("{}");
    expect((await readdir(sessions)).sort()).toEqual([...kept, keptFolder].sort());
    expect(await readdir(join(sessions, keptFolder))).toHaveLength(1);
    await sweepSettingsFiles(await home());
  });

  it("sweeps past a file it cannot remove", async () => {
    const folder = await home();
    const stuck = await writeSettingsFile(folder, randomUUID(), { hooks: {} });
    await writeSettingsFile(folder, randomUUID(), { hooks: {} });
    held.add(stuck);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sweepSettingsFiles(folder)).resolves.toBeUndefined();
    logged.mockRestore();
    held.delete(stuck);
    expect(await readdir(join(folder, "sessions"))).toEqual([stuck.slice(-41)]);
  });

  it.skipIf(posixOnly)("never sweeps a linked folder", async () => {
    const folder = await home();
    const outside = await home();
    const victim = join(outside, `${randomUUID()}.json`);
    await writeFile(victim, "{}");
    await symlink(outside, join(folder, "sessions"));
    await sweepSettingsFiles(folder);
    expect(await readFile(victim, "utf8")).toBe("{}");
  });
});
