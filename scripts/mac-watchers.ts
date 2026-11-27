import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const lock = z
  .object({
    packages: z.record(
      z.string(),
      z.object({ version: z.string(), integrity: z.string() }).partial(),
    ),
  })
  .parse(JSON.parse(readFileSync("package-lock.json", "utf8")));

function run(command: string, args: string[], cwd?: string): string {
  const { status, stdout } = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
  return stdout.trim();
}

for (const arch of ["arm64", "x64"]) {
  const name = `@parcel/watcher-darwin-${arch}`;
  const folder = join("node_modules", name);
  if (existsSync(folder)) continue;
  const locked = lock.packages[`node_modules/${name}`];
  if (locked?.version === undefined || locked.integrity === undefined) {
    throw new Error(`package-lock.json holds no ${name}`);
  }
  const temp = mkdtempSync(join(tmpdir(), "satellite-watcher-"));
  const tarball = join(temp, run("npm", ["pack", "--silent", `${name}@${locked.version}`], temp));
  const digest = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
  if (digest !== locked.integrity) throw new Error(`${name} doesn't match package-lock.json`);
  mkdirSync(folder, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", folder, "--strip-components=1"]);
  console.log(`Added ${name} ${locked.version} for the other Mac architecture.`);
}
