import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const packageExtensions = new Set([".dmg", ".zip", ".exe", ".AppImage", ".deb"]);

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const [folder, label] = process.argv.slice(2);
if (folder === undefined || label === undefined || !/^[a-z0-9-]+$/.test(label)) {
  console.error("Usage: node scripts/checksums.ts <folder> <label>, the label in kebab-case");
  process.exit(2);
}

const entries = await readdir(folder, { withFileTypes: true });
const packages = entries
  .filter((entry) => entry.isFile() && packageExtensions.has(extname(entry.name)))
  .map((entry) => entry.name)
  .sort();
if (packages.length === 0) {
  console.error(`No packages found in ${folder}`);
  process.exit(1);
}

const lines = [];
for (const name of packages) lines.push(`${await sha256(join(folder, name))}  ${name}\n`);
const output = join(folder, `SHA256SUMS-${label}.txt`);
await writeFile(output, lines.join(""));
console.log(`Wrote ${output} for ${packages.join(", ")}`);
