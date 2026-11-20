import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createJsonWriter, readJsonFile } from "./json-file.ts";

const opens = vi.hoisted(() => ({ exclusive: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => {
      if (args[1] === "wx") opens.exclusive += 1;
      return actual.open(...args);
    },
  };
});

const schema = z.strictObject({ version: z.literal(1), names: z.array(z.string()) });
const fallback: z.output<typeof schema> = { version: 1, names: [] };
const setAsideName = /^state\.unreadable-\d+\.json$/;
const permissionsApply = process.platform !== "win32" && process.getuid?.() !== 0;

async function folder(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "satellite-json-file-"));
  return { dir, file: join(dir, "state.json") };
}

async function expectSetAside(content: string): Promise<void> {
  const { dir, file } = await folder();
  await writeFile(file, content);
  const { value, outcome } = await readJsonFile(file, schema, fallback);
  expect(value).toEqual(fallback);
  if (outcome.kind !== "set-aside") throw new Error(`expected a set-aside, got ${outcome.kind}`);
  expect(outcome.name).toMatch(setAsideName);
  expect(await readFile(join(dir, outcome.name), "utf8")).toBe(content);
  expect(await readdir(dir)).not.toContain("state.json");
}

describe("readJsonFile", { timeout: 20_000 }, () => {
  it("answers the fallback and sets nothing aside when the file is missing", async () => {
    const { dir, file } = await folder();
    expect(await readJsonFile(file, schema, fallback)).toEqual({
      value: fallback,
      outcome: { kind: "missing" },
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it("keeps only the newest five set-aside copies of a file", async () => {
    const { dir, file } = await folder();
    const older = [1, 2, 3, 4, 5, 6].map((time) => `state.unreadable-${String(time)}.json`);
    for (const name of older) await writeFile(join(dir, name), "{");
    await writeFile(join(dir, "other.unreadable-1.json"), "{");
    await writeFile(file, "{");
    const { outcome } = await readJsonFile(file, schema, fallback);
    if (outcome.kind !== "set-aside") throw new Error(`expected a set-aside, got ${outcome.kind}`);
    expect((await readdir(dir)).sort()).toEqual(
      ["other.unreadable-1.json", outcome.name, ...older.slice(2)].sort(),
    );
  });

  it("sets aside truncated JSON and answers the fallback", async () => {
    await expectSetAside('{"version":1,"names":["a"');
  });

  it("sets aside a file with an unknown version", async () => {
    await expectSetAside('{"version":2,"names":[]}');
  });

  it("sets aside a file whose entries fail the schema", async () => {
    await expectSetAside('{"version":1,"names":[3]}');
  });

  it("sets aside a file over 32 MiB", async () => {
    await expectSetAside(`{"version":1,"names":["${"a".repeat(32 * 1024 * 1024)}"]}`);
  });

  it("answers the fallback when the path is a folder", async () => {
    const { file } = await folder();
    await mkdir(file);
    const result = await readJsonFile(file, schema, fallback);
    expect(result.value).toEqual(fallback);
  });

  it.skipIf(!permissionsApply)(
    "keeps a bad file in place and says so when it cannot be moved aside",
    async () => {
      const { dir, file } = await folder();
      await writeFile(file, "{");
      await chmod(dir, 0o500);
      const result = await readJsonFile(file, schema, fallback);
      await chmod(dir, 0o700);
      expect(result).toEqual({ value: fallback, outcome: { kind: "not-moved" } });
      expect(await readFile(file, "utf8")).toBe("{");
    },
  );

  it.skipIf(!permissionsApply)(
    "leaves a file it cannot open untouched and answers the fallback",
    async () => {
      const { dir, file } = await folder();
      await writeFile(file, '{"version":1,"names":["a"]}');
      await chmod(file, 0o000);
      const result = await readJsonFile(file, schema, fallback);
      await chmod(file, 0o600);
      expect(result).toEqual({ value: fallback, outcome: { kind: "not-read" } });
      expect(await readdir(dir)).toEqual(["state.json"]);
    },
  );

  it("deletes temp files a crash left behind", async () => {
    const { dir, file } = await folder();
    const leftover = ".state.json.6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6.tmp";
    await writeFile(join(dir, leftover), "{");
    await writeFile(file, '{"version":1,"names":["a"]}');
    const result = await readJsonFile(file, schema, fallback);
    expect(result.value).toEqual({ version: 1, names: ["a"] });
    expect(await readdir(dir)).toEqual(["state.json"]);
  });
});

describe("createJsonWriter", { timeout: 20_000 }, () => {
  it("keeps the last of a burst of writes with at most two writes to disk", async () => {
    const { dir, file } = await folder();
    const writer = createJsonWriter(file);
    const values = Array.from({ length: 50 }, (_, index) => ({
      version: 1,
      names: [String(index + 1)],
    }));
    opens.exclusive = 0;
    await Promise.all(values.map((value) => writer.write(value)));
    expect(opens.exclusive).toBeLessThanOrEqual(2);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(values[49]);
    expect(await readdir(dir)).toEqual(["state.json"]);
  });

  it("keeps writing after a write fails", async () => {
    const { dir } = await folder();
    const target = join(dir, "later", "state.json");
    const writer = createJsonWriter(target);
    await expect(writer.write(fallback)).rejects.toThrow();
    await mkdir(join(dir, "later"));
    await writer.write({ version: 1, names: ["b"] });
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ version: 1, names: ["b"] });
  });

  it("refuses a write larger than a read accepts and keeps the file", async () => {
    const { file } = await folder();
    const writer = createJsonWriter(file);
    await writer.write({ version: 1, names: ["kept"] });
    await expect(
      writer.write({ version: 1, names: ["a".repeat(32 * 1024 * 1024)] }),
    ).rejects.toThrow();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, names: ["kept"] });
  });

  it("flushes the write in flight and the one waiting", async () => {
    const { file } = await folder();
    const writer = createJsonWriter(file);
    void writer.write({ version: 1, names: ["a"] });
    void writer.write({ version: 1, names: ["b"] });
    await writer.flush();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, names: ["b"] });
  });

  it.skipIf(process.platform === "win32")(
    "writes the file readable only by its owner",
    async () => {
      const { file } = await folder();
      await createJsonWriter(file).write(fallback);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    },
  );
});
