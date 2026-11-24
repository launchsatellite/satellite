import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { grammars } from "tm-grammars";
import { z } from "zod";

interface GrammarNotice {
  files: string[];
  text: string;
}

const bundlable = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0"]);
const readUnclassified = new Map([
  ["apex", "BSD-3-Clause, read from the notice"],
  ["elixir", "Apache-2.0, read from the notice"],
]);
const grammarModule = /[\\/]node_modules[\\/]@shikijs[\\/]langs[\\/]dist[\\/]([a-z0-9-]+)\.mjs$/;
const divider = /^=+$/m;

function notices(): GrammarNotice[] {
  const text = readFileSync("node_modules/tm-grammars/NOTICE", "utf8");
  return text
    .split(divider)
    .slice(1)
    .map((block) => block.trim())
    .filter((block) => block.startsWith("Files:"))
    .map((block) => ({
      files: (/^Files:\s+(.*)$/m.exec(block)?.[1] ?? "")
        .split(/,\s*/)
        .map((file) => file.replace(/\.json$/, "")),
      text: block,
    }));
}

const sections = notices();

export function grammarNotice(name: string): string | undefined {
  const notice = sections.find(({ files }) => files.includes(name));
  if (notice === undefined) return undefined;
  const spdx = /^SPDX:\s+(.*)$/m.exec(notice.text)?.[1] ?? "";
  return bundlable.has(spdx) || readUnclassified.has(name) ? notice.text : undefined;
}

export function grammarName(moduleId: string): string | undefined {
  return grammarModule.exec(moduleId)?.[1];
}

export function unlicensedGrammarStub(moduleId: string): string | undefined {
  const name = grammarName(moduleId);
  if (name === undefined || grammarNotice(name) !== undefined) return undefined;
  const scopeName = grammars.find((grammar) => grammar.name === name)?.scopeName;
  if (scopeName === undefined) throw new Error(`the grammar ${name} is not in tm-grammars`);
  return `export default [Object.freeze(${JSON.stringify({ name, scopeName, patterns: [], repository: {} })})];\n`;
}

export function grammarNotices(names: Iterable<string>): string {
  const texts = new Set<string>();
  for (const name of [...names].sort()) {
    const text = grammarNotice(name);
    if (text === undefined) throw new Error(`the grammar ${name} ships without a licence`);
    texts.add(text);
  }
  return [...texts].join("\n\n");
}

const highlighterKeys = new Set(["aliases", "embeddedLangs", "embeddedLangsLazy"]);
const shippedFrom = /JSON\.parse\(("(?:[^"\\]|\\.)*")\)/;
const entryImport = /shiki\/langs\/([a-z0-9-]+)\.mjs/g;

export function checkEntryGrammars(): void {
  const table = readFileSync("src/renderer/diff/syntax-grammars.ts", "utf8");
  for (const [, name = ""] of table.matchAll(entryImport)) {
    if (grammarNotice(name) === undefined) {
      throw new Error(`the grammar ${name} has no licence Satellite can ship`);
    }
  }
}

export function checkSameGrammar(name: string): void {
  const shipped = readFileSync(`node_modules/@shikijs/langs/dist/${name}.mjs`, "utf8");
  const literal = shippedFrom.exec(shipped)?.[1];
  const noticed: unknown = JSON.parse(
    readFileSync(`node_modules/tm-grammars/grammars/${name}.json`, "utf8"),
  );
  const parsed: unknown =
    literal === undefined ? undefined : JSON.parse(z.string().parse(JSON.parse(literal)));
  const grammar = z.record(z.string(), z.unknown()).parse(parsed);
  const own = Object.fromEntries(
    Object.entries(grammar).filter(([key]) => !highlighterKeys.has(key)),
  );
  if (!isDeepStrictEqual(own, noticed)) {
    throw new Error(`the shipped ${name} grammar differs from the one tm-grammars licenses`);
  }
}
