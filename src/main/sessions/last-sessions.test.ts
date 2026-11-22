import { mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLastSessions } from "./last-sessions.ts";

const projectId = "0b9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e";
const workspace = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const first = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const second = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const main = { projectId, workspace: "main" } as const;
const other = { projectId, workspace } as const;

describe("createLastSessions", () => {
  it("keeps every change made at once, in order", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "satellite-last-")));
    const last = createLastSessions(home);
    await Promise.all([
      last.set(main, first),
      last.set(other, second),
      last.forget(main, first),
      last.set(main, second),
    ]);
    await last.flush();
    expect(await last.get(main)).toBe(second);
    expect(await last.get(other)).toBe(second);
    const reloaded = createLastSessions(home);
    expect(await reloaded.get(main)).toBe(second);
    expect(await reloaded.get(other)).toBe(second);
  });

  it("leaves a file a newer Satellite saved exactly as it is", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "satellite-last-")));
    const saved = JSON.stringify({ version: 2, last: [] });
    await writeFile(join(home, "sessions.json"), saved);
    const last = createLastSessions(home);
    await last.set(main, first);
    await last.flush();
    expect(await last.get(main)).toBe(first);
    expect(await readFile(join(home, "sessions.json"), "utf8")).toBe(saved);
    expect(await readdir(home)).toEqual(["sessions.json"]);
  });

  it("saves a change still waiting in line when flushed", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "satellite-last-")));
    const last = createLastSessions(home);
    void last.set(main, first);
    void last.set(other, second);
    await last.flush();
    const reloaded = createLastSessions(home);
    expect(await reloaded.get(main)).toBe(first);
    expect(await reloaded.get(other)).toBe(second);
  });

  it("forgets every workspace no longer on record, and keeps it forgotten on disk", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "satellite-last-")));
    const last = createLastSessions(home);
    await last.set(main, first);
    await last.set(other, second);
    await last.keepOnly([main]);
    await last.flush();
    const reloaded = createLastSessions(home);
    expect(await reloaded.get(main)).toBe(first);
    expect(await reloaded.get(other)).toBeUndefined();
  });

  it("ignores a session id that is not a UUID", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "satellite-last-")));
    const last = createLastSessions(home);
    await expect(last.set(main, "--help")).resolves.toBeUndefined();
    expect(await last.get(main)).toBeUndefined();
  });
});
