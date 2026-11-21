import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { callOf } from "./gh-call.ts";
import { loadScenario, type Scenario } from "../scenario.ts";
import { appendStandInEvent } from "./stand-in-log.ts";

type GhEntry = Scenario["gh"][number];
type CallEntry = Extract<GhEntry, { call: unknown }>;

const { scenario } = await loadScenario(process.env["SATELLITE_VERIFY_SCENARIO"] ?? "");
const args = process.argv.slice(2);
const call = callOf(args);
appendStandInEvent({ type: "start", tool: "gh", pid: process.pid, args, cwd: process.cwd(), call });

function isCallEntry(entry: GhEntry): entry is CallEntry {
  return "call" in entry;
}

function marked(name: string): boolean {
  return existsSync(join(process.env["SATELLITE_HOME"] ?? "", name));
}

function exactAnswer(): GhEntry | undefined {
  return scenario.gh.find(
    (candidate) =>
      "args" in candidate &&
      candidate.args.length === args.length &&
      candidate.args.every((arg, index) => arg === args[index]),
  );
}

function callAnswer(): CallEntry | undefined {
  const entries = scenario.gh.filter(isCallEntry).filter((entry) => entry.call === call);
  const reached = entries.filter((entry) => entry.after !== undefined && marked(entry.after));
  return reached.at(-1) ?? entries.find((entry) => entry.after === undefined);
}

function noAnswer(): { stdout: string; stderr: string; exitCode: number } {
  const stderr = call === "pull-request" ? 'no pull requests found for branch "stand-in"\n' : "";
  return { stdout: "", stderr, exitCode: 1 };
}

function headOfFolder(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function printed(answer: GhEntry): { stdout: string; stderr: string; exitCode: number } {
  const json = isCallEntry(answer) ? answer.json : undefined;
  return {
    stdout:
      json === undefined
        ? (answer.stdout ?? "")
        : JSON.stringify(json).replaceAll("@head", headOfFolder()),
    stderr: answer.stderr ?? "",
    exitCode: answer.exitCode ?? 0,
  };
}

const found = exactAnswer() ?? (call === null ? undefined : callAnswer());
if (found === undefined && call === null && ["pr", "api", "run"].includes(args[0] ?? "")) {
  process.stderr.write("stand-in gh got arguments Satellite must never send\n");
  process.exitCode = 97;
} else if (found === undefined && call === null) {
  process.stderr.write(`stand-in gh has no answer for ${args.join(" ")}\n`);
  process.exitCode = 1;
} else {
  const { stdout, stderr, exitCode } = found === undefined ? noAnswer() : printed(found);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = exitCode;
}
