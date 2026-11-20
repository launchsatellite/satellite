import { loadScenario } from "../scenario.ts";
import { appendStandInEvent } from "./stand-in-log.ts";

const { scenario } = await loadScenario(process.env["SATELLITE_VERIFY_SCENARIO"] ?? "");
const args = process.argv.slice(2);
appendStandInEvent({ type: "start", tool: "gh", pid: process.pid, args });
const answer = scenario.gh.find(
  (candidate) =>
    candidate.args.length === args.length &&
    candidate.args.every((arg, index) => arg === args[index]),
);
if (answer === undefined) {
  process.stderr.write(`stand-in gh has no answer for ${args.join(" ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(answer.stdout ?? "");
  process.stderr.write(answer.stderr ?? "");
  process.exitCode = answer.exitCode ?? 0;
}
