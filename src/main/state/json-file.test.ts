import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createJsonWriter, readJsonFile } from "./json-file.ts";

const schema = z.strictObject({ version: z.literal(1), names: z.array(z.string()) });
const fallback: z.output<typeof schema> = { version: 1, names: [] };
const setAsideName = /^state\.unreadable-\d+\.json$/;

async function folder(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "satellite-json-file-"));
  return { dir, file: join(dir, "state.json") };
}

async function expectSetAside(content: string): Promise<void> {
  const { dir, file } = await folder();
  await writeFile(file, content);
  const result = await readJsonFile(file, schema, fallback);
  expect(result.value).toEqual(fallback);
  expect(result.setAside).toMatch(setAsideName);
  expect(await readFile(join(dir, result.setAside ?? ""), "utf8")).toBe(content);
  expect(await readdir(dir)).not.toContain("state.json");
}

describe("readJsonFile", () => {
  it("answers the fallback and sets nothing aside when the file is missing", async () => {
    const { dir, file } = await folder();
    expect(await readJsonFile(file, schema, fallback)).toEqual({
      value: fallback,
      setAside: undefined,
    });
    expect(await readdir(dir)).toEqual([]);
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

  it("answers the fallback when the path is a folder", async () => {
    const { file } = await folder();
    await mkdir(file);
    const result = await readJsonFile(file, schema, fallback);
    expect(result.value).toEqual(fallback);
  });

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

describe("createJsonWriter", () => {
  it("keeps the last of many overlapping writes and leaves no temp file", async () => {
    const { dir, file } = await folder();
    const write = createJsonWriter(file);
    const values = Array.from({ length: 20 }, (_, index) => ({
      version: 1,
      names: [String(index + 1)],
    }));
    await Promise.all(values.map((value) => write(value)));
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(values[19]);
    expect(await readdir(dir)).toEqual(["state.json"]);
  });

  it.skipIf(process.platform === "win32")(
    "writes the file readable only by its owner",
    async () => {
      const { file } = await folder();
      await createJsonWriter(file)(fallback);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    },
  );
});
