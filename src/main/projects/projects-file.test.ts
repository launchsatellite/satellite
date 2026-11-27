import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { samePath } from "../platform/paths.ts";
import { createProjectsFile } from "./projects-file.ts";

const setAsideNotice =
  "Satellite couldn't read its saved projects, so it set that file aside and started with an empty list.";

const newerNotice =
  "Your projects were saved by a newer Satellite, so this one leaves them untouched and shows none until you open that newer version.";

async function homeWith(content: unknown): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "satellite-projects-file-"));
  await writeFile(join(home, "projects.json"), JSON.stringify(content));
  return home;
}

function userPath(path: string): string {
  return process.platform === "win32"
    ? `C:\\Users\\<name>\\${path.split("/").join("\\")}`
    : `/Users/<name>/${path}`;
}

function workspace(name: string, path: string) {
  return { id: randomUUID(), name, path, branch: name };
}

async function setAsideFiles(home: string): Promise<string[]> {
  return (await readdir(home)).filter((name) => name.startsWith("projects.unreadable-"));
}

describe("createProjectsFile", { timeout: 20_000 }, () => {
  it("reads a version 1 file as version 2 with no workspaces", async () => {
    const project = { id: randomUUID(), path: userPath("code/alpha") };
    const loaded = await createProjectsFile(
      await homeWith({ version: 1, projects: [project] }),
    ).load();
    expect(loaded).toEqual({
      projects: [{ ...project, workspaces: [] }],
      notice: null,
      writable: true,
      read: true,
      newer: false,
    });
  });

  it("writes version 2 after a change", async () => {
    const project = { id: randomUUID(), path: userPath("code/alpha") };
    const home = await homeWith({ version: 1, projects: [project] });
    const file = createProjectsFile(home);
    const { projects } = await file.load();
    const changed = projects.map((stored) => ({
      ...stored,
      workspaces: [workspace("fix-login", userPath(".satellite/worktrees/alpha/fix-login"))],
    }));
    await file.save(changed);
    const written: unknown = JSON.parse(await readFile(join(home, "projects.json"), "utf8"));
    expect(written).toEqual({ version: 2, projects: changed });
    expect((await createProjectsFile(home).load()).projects).toEqual(changed);
  });

  it("leaves a file from a newer version exactly as it is and saves nothing over it", async () => {
    const home = await homeWith({ version: 3, projects: [{ id: randomUUID(), future: true }] });
    const before = await readFile(join(home, "projects.json"));
    const file = createProjectsFile(home);
    const loaded = await file.load();
    expect(loaded).toEqual({
      projects: [],
      notice: newerNotice,
      writable: false,
      read: false,
      newer: true,
    });
    await expect(file.save([])).rejects.toThrow();
    expect(await setAsideFiles(home)).toEqual([]);
    expect(await readFile(join(home, "projects.json"))).toEqual(before);
  });

  it("sets aside a file of a known version that does not parse", async () => {
    const home = await homeWith({ version: 2, projects: [{ id: "not-an-id" }] });
    const loaded = await createProjectsFile(home).load();
    expect(loaded.projects).toEqual([]);
    expect(loaded.notice).toBe(setAsideNotice);
    expect(await setAsideFiles(home)).toHaveLength(1);
  });

  it("keeps the first record of a folder written twice and drops the rest", async () => {
    const alpha = userPath("code/alpha");
    const path = userPath(".satellite/worktrees/alpha/fix-login");
    const first = workspace("fix-login", path);
    const kept = workspace("other", `${path}-2`);
    const home = await homeWith({
      version: 2,
      projects: [
        {
          id: randomUUID(),
          path: alpha,
          workspaces: [first, workspace("fix-login", path), workspace("alpha", alpha), kept],
        },
        { id: randomUUID(), path: userPath("code/beta"), workspaces: [workspace("again", path)] },
      ],
    });
    const loaded = await createProjectsFile(home).load();
    expect(loaded.notice).toBeNull();
    expect(loaded.projects.map((project) => project.workspaces)).toEqual([[first, kept], []]);
    expect(await setAsideFiles(home)).toHaveLength(0);
  });

  it("sets aside a file that holds one project twice under another spelling", async () => {
    const alpha = userPath("code/alpha");
    const cased = await homeWith({
      version: 1,
      projects: [
        { id: randomUUID(), path: alpha },
        { id: randomUUID(), path: userPath("code/Alpha") },
      ],
    });
    const loaded = await createProjectsFile(cased).load();
    const foldsCase = samePath(alpha, userPath("code/Alpha"));
    expect(loaded.notice).toBe(foldsCase ? setAsideNotice : null);
    expect(loaded.projects).toHaveLength(foldsCase ? 0 : 2);
  });

  it("sets aside a project with 41 workspace records", async () => {
    const workspaces = Array.from({ length: 41 }, (_, index) =>
      workspace(`w${String(index)}`, userPath(`.satellite/worktrees/alpha/w${String(index)}`)),
    );
    const project = { id: randomUUID(), path: userPath("code/alpha") };
    const home = await homeWith({
      version: 2,
      projects: [{ ...project, workspaces }],
    });
    const loaded = await createProjectsFile(home).load();
    expect(loaded.projects).toEqual([]);
    expect(loaded.notice).toBe(setAsideNotice);
    const forty = await homeWith({
      version: 2,
      projects: [{ ...project, workspaces: workspaces.slice(0, 40) }],
    });
    expect((await createProjectsFile(forty).load()).projects[0]?.workspaces).toHaveLength(40);
  });
});
