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
const saved = { ...defaultInterfaceState, columns: { sidebar: 300, rail: 400 } };

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
    expect(state).toEqual({ ...defaultInterfaceState, guideSeen: true });
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
    expect(state).toEqual({ ...defaultInterfaceState, guideSeen: true });
    expect(notice).toMatch(/set that file aside and started fresh\.$/);
  });

  it("writes the layout as version 6 with whether the guide was seen, the sidebar and the rail", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const interfaceFile = createInterfaceFile(home);
    await interfaceFile.save({ ...saved, notifications: false, sidebar: "hidden", rail: "hidden" });
    await interfaceFile.flush();
    const written: unknown = JSON.parse(await readFile(join(home, "interface.json"), "utf8"));
    expect(written).toMatchObject({
      version: 6,
      sidebar: "hidden",
      rail: "hidden",
      notifications: false,
      files: [],
      guideSeen: false,
    });
    await interfaceFile.save({ ...saved, guideSeen: true });
    await interfaceFile.flush();
    const { state } = await createInterfaceFile(home).load();
    expect(state.guideSeen).toBe(true);
  });

  it("starts with the guide not seen when there is no layout file", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const { state, notice } = await createInterfaceFile(home).load();
    expect(state).toEqual({ ...defaultInterfaceState, guideSeen: false });
    expect(notice).toBeNull();
  });

  it("counts a layout file it set aside as one whose guide was seen", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    await writeFile(join(home, "interface.json"), "{");
    const { state, notice } = await createInterfaceFile(home).load();
    expect(state).toEqual({ ...defaultInterfaceState, guideSeen: true });
    expect(notice).toMatch(/set that file aside and started fresh\.$/);
  });

  it("saves the fresh state once it set a layout file aside, so the guide stays seen", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const file = join(home, "interface.json");
    await writeFile(file, "{");
    const interfaceFile = createInterfaceFile(home);
    await interfaceFile.load();
    await interfaceFile.flush();
    const next = await createInterfaceFile(home).load();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      ...defaultInterfaceState,
      version: 6,
      guideSeen: true,
    });
    expect(next).toEqual({ state: { ...defaultInterfaceState, guideSeen: true }, notice: null });
  });

  it("reads a version 1, 2 and 3 file as one whose guide was seen, a version 4 and 5 file as it is, each with the sidebar kept and the rail shown at its starting width", async () => {
    const layout = '"selected":null,"columns":{"left":300,"right":500},"theme":"dark"';
    const files = [
      [`{"version":1,${layout}}`, true, true],
      [`{"version":2,${layout},"notifications":false}`, false, true],
      [`{"version":3,${layout},"notifications":false,"files":[]}`, false, true],
      [`{"version":4,${layout},"notifications":false,"files":[],"guideSeen":false}`, false, false],
      [
        `{"version":5,${layout},"sidebar":"shown","notifications":false,"files":[],"guideSeen":false}`,
        false,
        false,
      ],
    ] as const;
    for (const [text, notifications, guideSeen] of files) {
      const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
      await writeFile(join(home, "interface.json"), text);
      const { state, notice } = await createInterfaceFile(home).load();
      expect(state).toEqual({
        selected: null,
        columns: { sidebar: 300, rail: 348 },
        sidebar: "shown",
        rail: "shown",
        theme: "dark",
        notifications,
        files: [],
        guideSeen,
      });
      expect(notice).toBeNull();
    }
  });

  it("keeps a version 5 sidebar width and starts the rail of version 6 at its starting width", async () => {
    const rail = 348;
    const widths = [
      [200, 360, 200],
      [248, 440, 248],
      [360, 640, 360],
    ] as const;
    for (const [left, right, sidebar] of widths) {
      const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
      await writeFile(
        join(home, "interface.json"),
        `{"version":5,"selected":null,"columns":{"left":${String(left)},"right":${String(right)}},"sidebar":"hidden","theme":"dark","notifications":true,"files":[],"guideSeen":true}`,
      );
      const { state, notice } = await createInterfaceFile(home).load();
      expect(state.columns).toEqual({ sidebar, rail });
      expect(state).toMatchObject({ sidebar: "hidden", rail: "shown" });
      expect(notice).toBeNull();
    }
  });

  it("reads a curated theme back and an unknown or malformed theme as System without setting the file aside", async () => {
    const themes = [
      ["dracula", "dracula"],
      ["solarized-neon", "system"],
      [7, "system"],
      ["x".repeat(500), "system"],
    ] as const;
    for (const [theme, read] of themes) {
      const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
      await writeFile(
        join(home, "interface.json"),
        JSON.stringify({ version: 6, ...saved, theme }),
      );
      const { state, notice } = await createInterfaceFile(home).load();
      expect(state).toEqual({ ...saved, theme: read });
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
      const text = JSON.stringify({ version: 6, ...saved, files });
      await writeFile(join(home, "interface.json"), text);
      const { state, notice } = await createInterfaceFile(home).load();
      expect(state).toEqual({ ...defaultInterfaceState, guideSeen: true });
      expect(notice).toMatch(/set that file aside and started fresh\.$/);
    }
  });

  it("sets aside a version 6 file with a field it does not know, a version 5 file with a rail and a version 7 file", async () => {
    const files = [
      { version: 7, ...saved },
      { version: 6, ...saved, extra: true },
      { version: 5, ...saved },
    ];
    for (const content of files) {
      const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
      await writeFile(join(home, "interface.json"), JSON.stringify(content));
      const { state, notice } = await createInterfaceFile(home).load();
      expect(state).toEqual({ ...defaultInterfaceState, guideSeen: true });
      expect(notice).toMatch(/set that file aside and started fresh\.$/);
    }
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

  it("lists the projects again only when the saved tabs changed", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const handlers = interfaceHandlers(
      createInterfaceFile(home),
      () => undefined,
      () => {
        listed += 1;
        return Promise.resolve(known);
      },
    );
    let listed = 0;
    const tabs = [{ projectId, workspace: "main" as const, paths: ["ok.ts"], active: 0 }];
    await handlers["interface.save"]({ state: { ...saved, files: tabs } }, owner);
    await handlers["interface.save"](
      { state: { ...saved, files: tabs, columns: { sidebar: 300, rail: 400 } } },
      owner,
    );
    expect(listed).toBe(1);
    await handlers["interface.save"](
      {
        state: {
          ...saved,
          files: [{ projectId, workspace: "main" as const, paths: ["ok.ts", "b.ts"], active: 0 }],
        },
      },
      owner,
    );
    expect(listed).toBe(2);
  });

  it("lets overlapping saves land in the order they arrived, the last one on disk", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const file = createInterfaceFile(home);
    const slow: { release: () => void } = { release: () => undefined };
    let calls = 0;
    const handlers = interfaceHandlers(
      file,
      () => undefined,
      () => {
        calls += 1;
        if (calls > 1) return Promise.resolve(known);
        return new Promise((settle) => {
          slow.release = () => {
            settle(known);
          };
        });
      },
    );
    const first = handlers["interface.save"](
      { state: { ...saved, columns: { sidebar: 300, rail: 400 } } },
      owner,
    );
    const second = handlers["interface.save"](
      { state: { ...saved, columns: { sidebar: 310, rail: 410 } } },
      owner,
    );
    await new Promise((settle) => setTimeout(settle, 20));
    slow.release();
    await Promise.all([first, second]);
    await file.flush();
    const written: unknown = JSON.parse(await readFile(join(home, "interface.json"), "utf8"));
    expect(written).toMatchObject({ columns: { sidebar: 310, rail: 410 } });
  });

  it("lets a flush wait for every save that arrived, even one queued behind a write", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const file = createInterfaceFile(home);
    const handlers = interfaceHandlers(
      file,
      () => undefined,
      () => Promise.resolve(known),
    );
    for (const sidebar of [300, 310, 320]) {
      void handlers["interface.save"](
        { state: { ...saved, columns: { sidebar, rail: 400 } } },
        owner,
      );
    }
    await file.flush();
    const written: unknown = JSON.parse(await readFile(join(home, "interface.json"), "utf8"));
    expect(written).toMatchObject({ columns: { sidebar: 320, rail: 400 } });
  });

  it("keeps the saved tabs, path checked, when the project list fails, and writes nothing on load", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const text = JSON.stringify({ version: 6, ...hostile });
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
