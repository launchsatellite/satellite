import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultInterfaceState, filesLimits } from "../../shared/bridge-contract.ts";
import { createInterfaceFile, interfaceHandlers, keptTabs } from "./interface-file.ts";

const permissionsApply = process.platform !== "win32" && process.getuid?.() !== 0;
const projectId = "0b9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e";
const owner = { id: 1, emit: () => undefined, onGone: () => undefined };
const saved = { ...defaultInterfaceState, columns: { left: 300, right: 500 } };

describe("createInterfaceFile", () => {
  it.skipIf(!permissionsApply)("never writes over a layout file it could not open", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const file = join(home, "interface.json");
    const original =
      '{"version":1,"selected":null,"columns":{"left":280,"right":440},"theme":"dark"}';
    await writeFile(file, original);
    await chmod(file, 0o000);
    const interfaceFile = createInterfaceFile(home);
    const { state, notice } = await interfaceFile.load();
    await interfaceFile.save(saved);
    await interfaceFile.flush();
    await chmod(file, 0o600);
    expect(state).toEqual(defaultInterfaceState);
    expect(notice).toMatch(/won't save layout changes for now\.$/);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it.skipIf(!permissionsApply)(
    "never writes over a bad layout file it could not move aside",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
      const file = join(home, "interface.json");
      await writeFile(file, "{");
      await chmod(home, 0o500);
      const interfaceFile = createInterfaceFile(home);
      const { notice } = await interfaceFile.load();
      await chmod(home, 0o700);
      await interfaceFile.save(saved);
      await interfaceFile.flush();
      expect(notice).toMatch(/won't save layout changes for now\.$/);
      expect(await readFile(file, "utf8")).toBe("{");
    },
  );

  it("sets aside a version 1 layout that carries notifications", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    await writeFile(
      join(home, "interface.json"),
      '{"version":1,"selected":null,"columns":{"left":300,"right":500},"theme":"dark","notifications":false}',
    );
    const { state, notice } = await createInterfaceFile(home).load();
    expect(state).toEqual(defaultInterfaceState);
    expect(notice).toMatch(/set that file aside and started fresh\.$/);
  });

  it("writes the layout as version 3", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const interfaceFile = createInterfaceFile(home);
    await interfaceFile.save({ ...saved, notifications: false });
    await interfaceFile.flush();
    const written: unknown = JSON.parse(await readFile(join(home, "interface.json"), "utf8"));
    expect(written).toMatchObject({ version: 3, notifications: false, files: [] });
  });

  it("reads a version 1 and a version 2 file as version 3 with no tabs and keeps the rest", async () => {
    const layout = '"selected":null,"columns":{"left":300,"right":500},"theme":"dark"';
    const files = [
      [`{"version":1,${layout}}`, true],
      [`{"version":2,${layout},"notifications":false}`, false],
    ] as const;
    for (const [text, notifications] of files) {
      const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
      await writeFile(join(home, "interface.json"), text);
      const { state, notice } = await createInterfaceFile(home).load();
      expect(state).toEqual({
        selected: null,
        columns: { left: 300, right: 500 },
        theme: "dark",
        notifications,
        files: [],
      });
      expect(notice).toBeNull();
    }
  });

  it("round-trips tabs", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const files = [{ projectId, workspace: "main", paths: ["a.ts", "b/c.ts"], active: 1 }];
    const first = createInterfaceFile(home);
    await first.save({ ...saved, files });
    await first.flush();
    const { state, notice } = await createInterfaceFile(home).load();
    expect(state.files).toEqual(files);
    expect(notice).toBeNull();
  });

  it("sets aside a file whose active tab is out of range or that holds more than 12 paths or 50 workspaces", async () => {
    const paths = (count: number) => Array.from({ length: count }, (_, at) => `f${String(at)}.ts`);
    const tabs = (workspace: string, count: number, active: number) => ({
      projectId,
      workspace,
      paths: paths(count),
      active,
    });
    const fiftyOne = Array.from({ length: 51 }, () => randomUUID()).map((workspace) =>
      tabs(workspace, 1, 0),
    );
    const damaged = [
      [tabs("main", 2, 2)],
      [tabs("main", 13, 0)],
      [tabs("main", 1, 0), tabs("main", 1, 0)],
      [{ ...tabs("main", 2, 0), paths: ["a.ts", "a.ts"] }],
      fiftyOne,
    ];
    for (const files of damaged) {
      const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
      const text = JSON.stringify({ version: 3, ...saved, files });
      await writeFile(join(home, "interface.json"), text);
      const { state, notice } = await createInterfaceFile(home).load();
      expect(state).toEqual(defaultInterfaceState);
      expect(notice).toMatch(/set that file aside and started fresh\.$/);
    }
  });

  it("sets aside a version 3 file that an older version would not understand and a version 4 file", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    await writeFile(join(home, "interface.json"), JSON.stringify({ version: 4, ...saved }));
    const { state, notice } = await createInterfaceFile(home).load();
    expect(state).toEqual(defaultInterfaceState);
    expect(notice).toMatch(/set that file aside and started fresh\.$/);
  });
});

describe("keptTabs", () => {
  it("drops a workspace that is gone, a path that fails the path rule and an empty tab list", () => {
    const other = "7f3a1c2e-9b4d-4e5f-8a6b-0c1d2e3f4a5b";
    const kept = keptTabs(
      [
        {
          projectId,
          workspace: "main",
          paths: ["../x", "ok.ts", "/etc/hosts", "d/e.ts"],
          active: 3,
        },
        { projectId, workspace: "main2".padEnd(36, "0"), paths: ["a.ts"], active: 0 },
        { projectId, workspace: other, paths: [".git/config"], active: 0 },
        { projectId, workspace: other, paths: ["a.ts"], active: 0 },
      ],
      new Set([`${projectId}/main`, `${projectId}/${other}`]),
    );
    expect(kept).toEqual([
      { projectId, workspace: "main", paths: ["ok.ts", "d/e.ts"], active: 1 },
      { projectId, workspace: other, paths: ["a.ts"], active: 0 },
    ]);
  });
});

describe("saved tabs hold only what could be loaded again", () => {
  const known = new Set([`${projectId}/main`]);
  const hostile = {
    ...saved,
    files: [
      {
        projectId,
        workspace: "main" as const,
        paths: [
          "../x",
          "ok.ts",
          "a\u0001b.ts",
          "x".repeat(filesLimits.tabPathChars + 1),
          "d\u0085e",
        ],
        active: 0,
      },
      { projectId: randomUUID(), workspace: "main" as const, paths: ["a.ts"], active: 0 },
    ],
  };

  it("filters a hostile save by the rule that filters a load and writes only what is left", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const file = createInterfaceFile(home);
    const handlers = interfaceHandlers(
      file,
      () => undefined,
      () => Promise.resolve(known),
    );
    await handlers["interface.save"]({ state: hostile }, owner);
    await file.flush();
    const written: unknown = JSON.parse(await readFile(join(home, "interface.json"), "utf8"));
    expect(written).toMatchObject({
      files: [{ projectId, workspace: "main", paths: ["ok.ts"], active: 0 }],
    });
  });

  it("keeps the saved tabs, path checked, when the project list fails, and writes nothing on load", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const text = JSON.stringify({ version: 3, ...hostile });
    await writeFile(join(home, "interface.json"), text);
    const file = createInterfaceFile(home);
    const handlers = interfaceHandlers(
      file,
      () => undefined,
      () => Promise.reject(new Error("x")),
    );
    const { state } = await handlers["interface.load"]({}, owner);
    expect(state.files.map((entry) => entry.paths)).toEqual([["ok.ts"], ["a.ts"]]);
    await file.flush();
    expect(await readFile(join(home, "interface.json"), "utf8")).toBe(text);
  });

  it("keeps every workspace when the list is unknown", () => {
    expect(keptTabs(hostile.files, null)).toHaveLength(2);
  });
});
