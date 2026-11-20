import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { loadScenario, type Scenario } from "../scenario.ts";
import { appendStandInEvent } from "./stand-in-log.ts";

const ctrlC = "\u0003";
const ctrlD = "\u0004";
const escapeEnter = "\u001b\r";
const ignoresHangup = "process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);";

async function flood(chars: number): Promise<void> {
  let written = 0;
  let line = 0;
  while (written < chars) {
    line += 1;
    const text = `line ${String(line).padStart(8, "0")} ${"x".repeat(60)}\r\n`.slice(
      0,
      chars - written,
    );
    written += text.length;
    if (!process.stdout.write(text)) await once(process.stdout, "drain");
  }
  process.stdout.write(`flood done ${String(line)} lines\r\n`);
}

function startStubbornChild(): void {
  const child = spawn(process.execPath, ["-e", ignoresHangup], { stdio: "ignore" });
  if (child.pid !== undefined) appendStandInEvent({ type: "child", pid: child.pid });
}

async function play(step: Scenario["claude"]["script"][number]): Promise<void> {
  if ("print" in step) process.stdout.write(step.print);
  else if ("wait" in step) await delay(step.wait);
  else if ("flood" in step) await flood(step.flood);
  else startStubbornChild();
}

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
  for (const step of scenario.claude.script) await play(step);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data: string) => {
    appendStandInEvent({ type: "input", data });
    process.stdout.write(data.replaceAll(escapeEnter, "\r\n"));
    if (data.includes(ctrlC) || data.includes(ctrlD)) process.exit(0);
  });
}

await main();
