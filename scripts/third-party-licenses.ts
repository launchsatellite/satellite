import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import { z } from "zod";

const manifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  license: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

export const thirdPartyLicensesFile = "third-party-licenses.md";

async function manifest(folder: string): Promise<z.infer<typeof manifestSchema>> {
  return manifestSchema.parse(JSON.parse(await readFile(join(folder, "package.json"), "utf8")));
}

async function section(name: string, file: string): Promise<string> {
  const folder = join("node_modules", name);
  const { version, license } = await manifest(folder);
  const text = await readFile(join(folder, file), "utf8");
  const label = file === "LICENSE" ? `(${license ?? "see below"})` : "third-party notices";
  return `## ${name} - ${version} ${label}\n\n${text.trim()}\n`;
}

async function shippedOutsideTheBundle(listed: string): Promise<string[]> {
  const { dependencies = {}, devDependencies = {} } = await manifest(".");
  const runtime = Object.keys(dependencies).filter((name) => !listed.includes(`## ${name} - `));
  const fonts = Object.keys(devDependencies).filter((name) =>
    /^@fontsource(-variable)?\//.test(name),
  );
  return [
    ...(await Promise.all(runtime.map((name) => section(name, "LICENSE")))),
    ...(await Promise.all(fonts.map((name) => section(name, "LICENSE")))),
    await section("monaco-editor", "ThirdPartyNotices.txt"),
  ];
}

export function thirdPartyLicenses(): Plugin {
  return {
    name: "satellite-third-party-licenses",
    apply: "build",
    async writeBundle({ dir }) {
      if (dir === undefined) return;
      const path = join(dir, thirdPartyLicensesFile);
      const listed = await readFile(path, "utf8");
      const extra = await shippedOutsideTheBundle(listed);
      await writeFile(path, [listed.trimEnd(), ...extra].join("\n\n"));
    },
  };
}
