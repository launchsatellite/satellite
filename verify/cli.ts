import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import {
  buildApp,
  errorReason,
  generatedText,
  launchApp,
  pasteIntoFocus,
  LaunchFailure,
  readTree,
  withTimeout,
  type AppSession,
  type AppTarget,
} from "./driver.ts";

interface StepContext {
  session: AppSession;
  screenshots: string[];
}
interface Step {
  step: string;
  timeoutMs: number;
  run: (context: StepContext) => Promise<unknown>;
}
interface StepResult {
  step: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  output?: string;
  tree?: unknown;
}
interface Output {
  scenario: string;
  home: string | null;
  repo: string | null;
  steps: StepResult[];
  consoleErrors: string[];
  screenshots: string[];
  leftover?: string;
}
interface Arguments {
  scenario: string;
  target: AppTarget;
  realClaude: boolean;
  keep: boolean;
  steps: Step[];
}

const defaultSteps = ["wait-for=app-window", "tree", "shot=window"];
const textLimit = 2000;
const pasteLimit = 1_000_000;
const waitLimitMs = 60_000;
const stepTimeoutMs = 15_000;

const noFocus = "nothing in the window has focus, click an element first";

function boundedInt(text: string, step: string, min: number, max: number): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${step} needs a whole number from ${String(min)} to ${String(max)}`);
  }
  return value;
}

async function focusedTestId(page: Page): Promise<string> {
  const testId = await page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return null;
    return active.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
  });
  if (testId === null) throw new Error(noFocus);
  return testId;
}

async function paste(page: Page, text: string): Promise<string> {
  const target = await pasteIntoFocus(page, text);
  if (target === undefined) throw new Error(noFocus);
  return target;
}

function parseStep(raw: string): Step {
  const separator = raw.indexOf("=");
  const name = separator === -1 ? raw : raw.slice(0, separator);
  const value = separator === -1 ? "" : raw.slice(separator + 1);
  const step = (run: Step["run"], timeoutMs = stepTimeoutMs): Step => ({
    step: raw,
    timeoutMs,
    run,
  });
  const needsValue = (): string => {
    if (value === "") throw new Error(`step ${name} needs a value, as in ${name}=...`);
    return value;
  };
  switch (name) {
    case "tree":
      return step(({ session }) => readTree(session.page));
    case "text": {
      const testId = needsValue();
      return step(async ({ session }) =>
        (await session.page.getByTestId(testId).innerText()).slice(0, textLimit),
      );
    }
    case "click": {
      const testId = needsValue();
      return step(({ session }) => session.page.getByTestId(testId).click());
    }
    case "type": {
      const text = needsValue();
      return step(async ({ session }) => {
        const target = await focusedTestId(session.page);
        await session.page.keyboard.type(text);
        return target;
      });
    }
    case "press": {
      const key = needsValue();
      return step(({ session }) => session.page.keyboard.press(key));
    }
    case "paste": {
      const text = needsValue();
      return step(({ session }) => paste(session.page, text));
    }
    case "paste-size": {
      const size = boundedInt(needsValue(), name, 1, pasteLimit);
      return step(({ session }) => paste(session.page, generatedText(size)));
    }
    case "resize": {
      const match = /^(\d+)x(\d+)$/.exec(needsValue());
      if (match?.[1] === undefined || match[2] === undefined) {
        throw new Error("step resize needs <width>x<height>, as in resize=1280x800");
      }
      const width = boundedInt(match[1], name, 200, 8000);
      const height = boundedInt(match[2], name, 200, 8000);
      return step(({ session }) => session.page.setViewportSize({ width, height }));
    }
    case "theme": {
      const colorScheme = needsValue();
      if (colorScheme !== "light" && colorScheme !== "dark") {
        throw new Error("step theme needs light or dark");
      }
      return step(({ session }) => session.page.emulateMedia({ colorScheme }));
    }
    case "wait": {
      const ms = boundedInt(needsValue(), name, 0, waitLimitMs);
      return step(() => delay(ms), ms + stepTimeoutMs);
    }
    case "wait-for": {
      const testId = needsValue();
      return step(
        ({ session }) =>
          session.page.getByTestId(testId).waitFor({ state: "visible", timeout: waitLimitMs }),
        waitLimitMs + stepTimeoutMs,
      );
    }
    case "shot": {
      const shotName = needsValue();
      return step(async ({ session, screenshots }) => {
        const path = await session.screenshot(shotName);
        screenshots.push(path);
        return path;
      });
    }
    case "log":
      return step(({ session }) => session.standInEvents());
    default:
      throw new Error(`unknown step ${raw}`);
  }
}

function parseArguments(argv: string[]): Arguments {
  const [scenario, ...rest] = argv;
  if (scenario === undefined || scenario.startsWith("--")) {
    throw new Error("name a scenario first, as in npm run verify -- default");
  }
  let target: AppTarget = { kind: "built" };
  let realClaude = false;
  let keep = false;
  const steps: Step[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index] ?? "";
    if (argument === "--dev") target = { kind: "dev" };
    else if (argument === "--app") {
      index += 1;
      const executable = rest[index];
      if (executable === undefined) throw new Error("--app needs the path of an executable");
      target = { kind: "packaged", executable: resolve(executable) };
    } else if (argument === "--real-claude") realClaude = true;
    else if (argument === "--keep") keep = true;
    else if (argument.startsWith("--")) throw new Error(`unknown option ${argument}`);
    else steps.push(parseStep(argument));
  }
  return {
    scenario,
    target,
    realClaude,
    keep,
    steps: steps.length > 0 ? steps : defaultSteps.map(parseStep),
  };
}

async function runSteps(
  session: AppSession,
  steps: Step[],
): Promise<StepContext & { results: StepResult[] }> {
  const context: StepContext = { session, screenshots: [] };
  const results: StepResult[] = [];
  for (const { step, timeoutMs, run } of steps) {
    try {
      const value = await withTimeout(run(context), timeoutMs, `step ${step}`);
      results.push(value === undefined ? { step, ok: true } : { step, ok: true, value });
    } catch (error) {
      const tree = await readTree(session.page).catch((treeError: unknown) =>
        errorReason(treeError),
      );
      results.push({ step, ok: false, error: errorReason(error), tree });
      break;
    }
  }
  return { ...context, results };
}

function print(output: Output): boolean {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return output.steps.every((result) => result.ok) && output.leftover === undefined;
}

function failed(scenario: string, step: string, error: unknown): Output {
  const output: Output = {
    scenario,
    home: null,
    repo: null,
    steps: [{ step, ok: false, error: errorReason(error) }],
    consoleErrors: [],
    screenshots: [],
  };
  if (!(error instanceof LaunchFailure)) return output;
  return {
    ...output,
    home: error.home ?? null,
    repo: error.repo ?? null,
    steps: [{ step, ok: false, error: errorReason(error), output: error.output, tree: error.tree }],
    consoleErrors: error.consoleErrors,
  };
}

async function main(): Promise<boolean> {
  let args: Arguments;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    return print(failed(process.argv[2] ?? "", "arguments", error));
  }
  if (args.target.kind === "built") {
    try {
      await buildApp();
    } catch (error) {
      return print(failed(args.scenario, "build", error));
    }
  }
  let session: AppSession;
  try {
    session = await launchApp(args);
  } catch (error) {
    return print(failed(args.scenario, "launch", error));
  }
  session.page.setDefaultTimeout(stepTimeoutMs);
  const { results, screenshots } = await runSteps(session, args.steps);
  const output: Output = {
    scenario: args.scenario,
    home: session.home,
    repo: session.repo,
    steps: results,
    consoleErrors: session.consoleErrors,
    screenshots,
  };
  try {
    const { leftover } = await session.close();
    if (leftover !== undefined) output.leftover = leftover;
  } catch (error) {
    results.push({ step: "close", ok: false, error: errorReason(error) });
  }
  return print(output);
}

process.exitCode = (await main()) ? 0 : 1;
