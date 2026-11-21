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

const old = args.includes("--write-tree") && claimedVersion() !== undefined;
if (old) {
  process.stderr.write("usage: git merge-tree [<options>] <branch1> <branch2>\n");
  process.exitCode = 129;
} else {
  const run = spawnSync("git", args, { stdio: "inherit" });
  process.exitCode = run.status ?? 1;
}
