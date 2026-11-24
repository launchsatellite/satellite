import { readFileSync } from "node:fs";
import { grammars } from "tm-grammars";

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
