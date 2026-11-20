import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ptyHelpers = [
  "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
  "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper",
];

for (const helper of ptyHelpers) {
  if (existsSync(helper)) chmodSync(helper, 0o755);
}

if (process.env["ELECTRON_SKIP_BINARY_DOWNLOAD"] === undefined) {
  const installer = fileURLToPath(import.meta.resolve("electron/install.js"));
  const { status } = spawnSync(process.execPath, [installer], { stdio: "inherit" });
  process.exitCode = status ?? 1;
}
