import { chmodSync, existsSync } from "node:fs";

const helpers = [
  "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
  "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper",
];

for (const helper of helpers) {
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
