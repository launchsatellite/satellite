import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { samePath } from "../platform/paths.ts";
import { createProjectsFile } from "./projects-file.ts";

const setAsideNotice =
  "Satellite couldn't read its saved projects, so it set that file aside and started with an empty list.";

async function homeWith(content: unknown): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "satellite-projects-file-"));
  await writeFile(join(home, "projects.json"), JSON.stringify(content));
  return home;
}

function workspace(name: string, path: string) {
  return { id: randomUUID(), name, path, branch: name };
}

async function setAsideFiles(home: string): Promise<string[]> {
  return (await readdir(home)).filter((name) => name.startsWith("projects.unreadable-"));
}

describe("createProjectsFile", () => {
  it("reads a version 1 file as version 2 with no workspaces", async () => {
    const project = { id: randomUUID(), path: "/Users/<name>/code/alpha" };
    const loaded = await createProjectsFile(
      await homeWith({ version: 1, projects: [project] }),
    ).load();
    expect(loaded).toEqual({
      projects: [{ ...project, workspaces: [] }],
      notice: null,
      writable: true,
    });
  });

  it("writes version 2 after a change", async () => {
    const project = { id: randomUUID(), path: "/Users/<name>/code/alpha" };
    const home = await homeWith({ version: 1, projects: [project] });
    const file = createProjectsFile(home);
    const { projects } = await file.load();
    const changed = projects.map((stored) => ({
      ...stored,
      workspaces: [workspace("fix-login", "/Users/<name>/.satellite/worktrees/alpha/fix-login")],
    }));
    await file.save(changed);
    const written: unknown = JSON.parse(await readFile(join(home, "projects.json"), "utf8"));
    expect(written).toEqual({ version: 2, projects: changed });
    expect((await createProjectsFile(home).load()).projects).toEqual(changed);
  });

  it("sets aside a file from a newer version", async () => {
    const home = await homeWith({ version: 3, projects: [] });
    const loaded = await createProjectsFile(home).load();
    expect(loaded.projects).toEqual([]);
    expect(loaded.notice).toBe(setAsideNotice);
    expect(await setAsideFiles(home)).toHaveLength(1);
  });

  it("sets aside a file with two workspaces on one path", async () => {
    const path = "/Users/<name>/.satellite/worktrees/alpha/fix-login";
    const fileWith = (otherPath: string) => ({
      version: 2,
      projects: [
        {
          id: randomUUID(),
          path: "/Users/<name>/code/alpha",
          workspaces: [workspace("fix-login", path), workspace("other", otherPath)],
        },
      ],
    });
    const home = await homeWith(fileWith(path));
    const loaded = await createProjectsFile(home).load();
    expect(loaded.projects).toEqual([]);
    expect(loaded.notice).toBe(setAsideNotice);
    expect(await setAsideFiles(home)).toHaveLength(1);
    const apart = await homeWith(fileWith(`${path}-2`));
    expect((await createProjectsFile(apart).load()).projects[0]?.workspaces).toHaveLength(2);
  });

  it("sets aside a file that holds one folder twice under another spelling", async () => {
    const alpha = "/Users/<name>/code/alpha";
    const onProject = await homeWith({
      version: 2,
      projects: [{ id: randomUUID(), path: alpha, workspaces: [workspace("fix-login", alpha)] }],
    });
    expect((await createProjectsFile(onProject).load()).notice).toBe(setAsideNotice);
    const cased = await homeWith({
      version: 1,
      projects: [
        { id: randomUUID(), path: alpha },
        { id: randomUUID(), path: "/Users/<name>/code/Alpha" },
      ],
    });
    const loaded = await createProjectsFile(cased).load();
    const foldsCase = samePath(alpha, "/Users/<name>/code/Alpha");
    expect(loaded.notice).toBe(foldsCase ? setAsideNotice : null);
    expect(loaded.projects).toHaveLength(foldsCase ? 0 : 2);
  });

  it("sets aside a project with 21 workspaces", async () => {
    const workspaces = Array.from({ length: 21 }, (_, index) =>
      workspace(`w${String(index)}`, `/Users/<name>/.satellite/worktrees/alpha/w${String(index)}`),
    );
    const project = { id: randomUUID(), path: "/Users/<name>/code/alpha" };
    const home = await homeWith({
      version: 2,
      projects: [{ ...project, workspaces }],
    });
    const loaded = await createProjectsFile(home).load();
    expect(loaded.projects).toEqual([]);
    expect(loaded.notice).toBe(setAsideNotice);
    const twenty = await homeWith({
      version: 2,
      projects: [{ ...project, workspaces: workspaces.slice(0, 20) }],
    });
    expect((await createProjectsFile(twenty).load()).projects[0]?.workspaces).toHaveLength(20);
  });
});
