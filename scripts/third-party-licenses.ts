import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import { z } from "zod";
import { curatedThemes } from "../src/shared/themes/curated-themes.ts";
import {
  grammarName,
  grammarNotice,
  grammarNotices,
  unlicensedGrammarStub,
} from "./grammar-notices.ts";

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

const packageFolder = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/@]+)[\\/]/;
const licenceFile = /^licen[cs]e(?:\.md|\.txt)?$/i;

async function workerPackageSection(folder: string, listed: string): Promise<string | undefined> {
  const { name, version, license } = await manifest(folder);
  if (listed.includes(`## ${name} - `)) return undefined;
  const file = (await readdir(folder)).find((entry) => licenceFile.test(entry));
  if (file === undefined) throw new Error(`${name} ships in a worker without a licence file`);
  const text = await readFile(join(folder, file), "utf8");
  return `## ${name} - ${version} (${license ?? "see below"})\n\n${text.trim()}\n`;
}

async function grammarSection(grammars: Set<string>): Promise<string[]> {
  if (grammars.size === 0) return [];
  const { version } = await manifest(join("node_modules", "tm-grammars"));
  const heading = `## The code viewer's grammars, from tm-grammars - ${version}`;
  return [
    `${heading}\n\nGrammars ${[...grammars].sort().join(", ")}.\n\n${grammarNotices(grammars)}\n`,
  ];
}

async function shippedOutsideTheBundle(
  listed: string,
  grammars: Set<string>,
  workerPackages: Set<string>,
): Promise<string[]> {
  const { dependencies = {}, devDependencies = {} } = await manifest(".");
  const runtime = Object.keys(dependencies).filter((name) => !listed.includes(`## ${name} - `));
  const fonts = Object.keys(devDependencies).filter((name) =>
    /^@fontsource(-variable)?\//.test(name),
  );
  return [
    ...(await Promise.all(runtime.map((name) => section(name, "LICENSE")))),
    ...(await Promise.all(fonts.map((name) => section(name, "LICENSE")))),
    await section("material-icon-theme", "LICENSE"),
    await section("monaco-editor", "ThirdPartyNotices.txt"),
    ...curatedThemes.map(
      ({ name, site, licence }) => `## The ${name} theme, ${site}\n\n${licence}\n`,
    ),
    ...(
      await Promise.all(
        [...workerPackages].sort().map((folder) => workerPackageSection(folder, listed)),
      )
    ).filter((text) => text !== undefined),
    ...(await grammarSection(grammars)),
  ];
}

export function thirdPartyLicenses(): { page: Plugin; worker: Plugin } {
  const grammars = new Set<string>();
  const workerPackages = new Set<string>();
  const collect = (bundle: Record<string, { type: string; moduleIds?: string[] }>) => {
    for (const output of Object.values(bundle)) {
      for (const id of output.moduleIds ?? []) {
        const name = grammarName(id);
        if (name !== undefined && grammarNotice(name) !== undefined) grammars.add(name);
      }
    }
  };
  const stub = (id: string) => unlicensedGrammarStub(id);
  return {
    page: {
      name: "satellite-third-party-licenses",
      apply: "build",
      load: stub,
      generateBundle(_options, bundle) {
        collect(bundle);
      },
      async writeBundle({ dir }) {
        if (dir === undefined) return;
        const path = join(dir, thirdPartyLicensesFile);
        const listed = await readFile(path, "utf8");
        const extra = await shippedOutsideTheBundle(listed, grammars, workerPackages);
        await writeFile(path, [listed.trimEnd(), ...extra].join("\n\n"));
      },
    },
    worker: {
      name: "satellite-third-party-licenses-worker",
      apply: "build",
      load: stub,
      generateBundle(_options, bundle) {
        collect(bundle);
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          for (const id of output.moduleIds) {
            const folder = packageFolder.exec(id)?.[1];
            if (folder !== undefined) workerPackages.add(folder);
          }
        }
      },
    },
  };
}
