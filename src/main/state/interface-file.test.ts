import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultInterfaceState } from "../../shared/bridge-contract.ts";
import { createInterfaceFile } from "./interface-file.ts";

const permissionsApply = process.platform !== "win32" && process.getuid?.() !== 0;
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

  it("reads a layout saved before notifications as notifications on", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    await writeFile(
      join(home, "interface.json"),
      '{"version":1,"selected":null,"columns":{"left":300,"right":500},"theme":"dark"}',
    );
    const { state, notice } = await createInterfaceFile(home).load();
    expect(state).toEqual({
      selected: null,
      columns: { left: 300, right: 500 },
      theme: "dark",
      notifications: true,
    });
    expect(notice).toBeNull();
  });

  it("writes the layout as version 2", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-interface-file-"));
    const interfaceFile = createInterfaceFile(home);
    await interfaceFile.save({ ...saved, notifications: false });
    await interfaceFile.flush();
    const written: unknown = JSON.parse(await readFile(join(home, "interface.json"), "utf8"));
    expect(written).toMatchObject({ version: 2, notifications: false });
  });
});
