import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const names = ["TMPDIR", "TMP", "TEMP"] as const;

export function setup(): () => void {
  const before = names.map((name) => process.env[name]);
  const folder = mkdtempSync(join(tmpdir(), "satellite-tests-"));
  for (const name of names) process.env[name] = folder;
  return () => {
    names.forEach((name, index) => {
      const value = before[index];
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    });
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  };
}
