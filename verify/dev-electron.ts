import { spawn } from "node:child_process";
import { join } from "node:path";
import { electronBinary } from "./driver.ts";

const [workingFolder, ...args] = process.argv.slice(2);
const app = spawn(electronBinary(), [join(import.meta.dirname, ".."), ...args], {
  cwd: workingFolder,
  stdio: "inherit",
});
app.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === null ? 0 : 1);
});
