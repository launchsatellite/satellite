import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const home = process.env["SATELLITE_HOME"] ?? "";

function claimedVersion(): string | undefined {
  try {
    return readFileSync(join(home, "git-version"), "utf8").trim();
  } catch {
    return undefined;
  }
}

const version = args.includes("--version") ? claimedVersion() : undefined;
if (version !== undefined) {
  process.stdout.write(`git version ${version}\n`);
  process.exitCode = 0;
} else {
  const run = spawnSync("git", args, { stdio: "inherit" });
  process.exitCode = run.status ?? 1;
}
