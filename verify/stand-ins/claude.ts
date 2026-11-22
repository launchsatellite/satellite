import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { loadScenario, type Scenario } from "../scenario.ts";
import { appendStandInEvent } from "./stand-in-log.ts";

type ClaudeStep = Extract<Scenario["claude"], { script: unknown }>["script"][number];
type HookStep = Extract<ClaudeStep, { hook: unknown }>;
type Settings = z.output<typeof settingsSchema>;
interface Waiter {
  text: string;
  resolve: () => void;
}

const ctrlC = "\u0003";
const ctrlD = "\u0004";
const escapeEnter = "\u001b\r";
const ignoresHangup = "process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);";
const unreadLimit = 65536;
const hookTimeoutMs = 5000;
const trustQuestion = "Do you trust the files in this folder? Press Enter to trust it.\r\n";
const settingsSchema = z.object({
  hooks: z.record(
    z.string(),
    z.array(
      z.object({
        hooks: z.array(
          z.object({ url: z.string(), headers: z.record(z.string(), z.string()).optional() }),
        ),
      }),
    ),
  ),
});

const args = process.argv.slice(2);
let unread = "";
let waiter: Waiter | undefined;
let trusted = true;

function valueAfter(flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

async function readSettings(): Promise<Settings | undefined> {
  const file = valueAfter("--settings");
  if (file === undefined) return undefined;
  try {
    return settingsSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return undefined;
  }
}

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

function startDevServer(): void {
  const script = join(import.meta.dirname, "dev-server.ts");
  if (process.platform === "win32") {
    spawn(
      join(
        process.env["SystemRoot"] ?? String.raw`C:\Windows`,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", `& '${process.execPath}' '${script}'`],
      { stdio: "ignore" },
    );
    return;
  }
  spawn("/bin/sh", ["-c", '"$0" "$1"; exit $?', process.execPath, script], { stdio: "ignore" });
}

function meetWaiter(): void {
  if (waiter === undefined) return;
  const at = unread.indexOf(waiter.text);
  if (at === -1) return;
  unread = unread.slice(at + waiter.text.length);
  const met = waiter;
  waiter = undefined;
  met.resolve();
}

function awaitInput(text: string): Promise<void> {
  return new Promise((resolve) => {
    waiter = { text, resolve };
    meetWaiter();
  });
}

async function post(settings: Settings | undefined, step: HookStep): Promise<number> {
  const hook = settings?.hooks[step.hook]?.[0]?.hooks[0];
  if (!trusted || hook === undefined) return 0;
  const body = {
    session_id: valueAfter("--session-id") ?? valueAfter("--resume"),
    transcript_path: "",
    cwd: process.cwd(),
    hook_event_name: step.hook,
    ...step.fields,
  };
  try {
    const response = await fetch(hook.url, {
      method: "POST",
      headers: { ...hook.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(hookTimeoutMs),
    });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return 0;
  }
}

async function play(step: ClaudeStep, settings: Settings | undefined): Promise<void> {
  if ("print" in step) process.stdout.write(step.print);
  else if ("wait" in step) await delay(step.wait);
  else if ("flood" in step) await flood(step.flood);
  else if ("await" in step) await awaitInput(step.await);
  else if ("exit" in step) process.exit(step.exit);
  else if ("trust" in step) {
    process.stdout.write(trustQuestion);
    await awaitInput("\r");
    trusted = true;
  } else if ("hook" in step) {
    appendStandInEvent({ type: "hook", event: step.hook, status: await post(settings, step) });
  } else if (step.child === "dev-server") startDevServer();
  else startStubbornChild();
}

function listen(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data: string) => {
    appendStandInEvent({ type: "input", data });
    process.stdout.write(data.replaceAll(escapeEnter, "\r\n"));
    if (data.includes(ctrlC) || data.includes(ctrlD)) process.exit(0);
    unread = (unread + data).slice(-unreadLimit);
    meetWaiter();
  });
}

async function main(): Promise<void> {
  const { scenario } = await loadScenario(process.env["SATELLITE_VERIFY_SCENARIO"] ?? "");
  const claude = scenario.claude;
  if ("missing" in claude) {
    process.stderr.write("stand-in claude started for a scenario where Claude Code is missing\n");
    process.exitCode = 1;
    return;
  }
  if (args.includes("--version")) {
    process.stdout.write(`${claude.version}\n`);
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
  const settings = await readSettings();
  trusted = !claude.script.some((step) => "trust" in step);
  listen();
  const resumed = valueAfter("--resume");
  if (resumed !== undefined && claude.resumeFails === true) {
    process.stdout.write(`No conversation found with session ID: ${resumed}\r\n`);
    process.exit(1);
  }
  if (resumed !== undefined) process.stdout.write(`Resumed session ${resumed}\r\n`);
  for (const step of claude.script) await play(step, settings);
}

await main();
