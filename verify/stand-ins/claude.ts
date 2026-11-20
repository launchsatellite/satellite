import { setTimeout as delay } from "node:timers/promises";
import { loadScenario } from "../scenario.ts";
import { appendStandInEvent } from "./stand-in-log.ts";

const ctrlC = "\u0003";
const ctrlD = "\u0004";
const escapeEnter = "\u001b\r";

async function main(): Promise<void> {
  const { scenario } = await loadScenario(process.env["SATELLITE_VERIFY_SCENARIO"] ?? "");
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    process.stdout.write(`${scenario.claude.version}\n`);
    return;
  }
  appendStandInEvent({ type: "start", tool: "claude", pid: process.pid, args });
  process.stdout.on("resize", () => {
    appendStandInEvent({
      type: "resize",
      cols: process.stdout.columns,
      rows: process.stdout.rows,
    });
  });
  for (const step of scenario.claude.script) {
    if ("print" in step) process.stdout.write(step.print);
    else await delay(step.wait);
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data: string) => {
    appendStandInEvent({ type: "input", data });
    process.stdout.write(data.replaceAll(escapeEnter, "\r\n"));
    if (data.includes(ctrlC) || data.includes(ctrlD)) process.exit(0);
  });
}

await main();
