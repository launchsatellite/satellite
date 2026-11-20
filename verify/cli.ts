import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import type { Page } from "playwright-core";
import { buildApp, launchApp, type AppSession, type AppTarget } from "./driver.ts";

interface StepContext {
  session: AppSession;
  screenshots: string[];
}
interface Step {
  step: string;
  run: (context: StepContext) => Promise<unknown>;
}
interface StepResult {
  step: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  tree?: unknown;
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
const pasteAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

function reason(error: unknown): string {
  return stripVTControlCharacters(error instanceof Error ? error.message : String(error));
}

function boundedInt(text: string, step: string, min: number, max: number): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${step} needs a whole number from ${String(min)} to ${String(max)}`);
  }
  return value;
}

async function readTree(page: Page): Promise<unknown> {
  const aria = await page.locator("body").ariaSnapshot();
  const testIds = await page.locator("[data-testid]").evaluateAll(
    (elements, limit) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        const text = element instanceof HTMLElement ? element.innerText : element.textContent;
        return {
          testId: element.getAttribute("data-testid") ?? "",
          visible:
            box.width > 0 &&
            box.height > 0 &&
            element.checkVisibility({ visibilityProperty: true }),
          text: text.slice(0, limit),
        };
      }),
    textLimit,
  );
  return { aria, testIds };
}

async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", data);
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, text);
}

function parseStep(raw: string): Step {
  const separator = raw.indexOf("=");
  const name = separator === -1 ? raw : raw.slice(0, separator);
  const value = separator === -1 ? "" : raw.slice(separator + 1);
  const step = (run: Step["run"]): Step => ({ step: raw, run });
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
      return step(({ session }) => session.page.keyboard.type(text));
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
      const text = pasteAlphabet.repeat(Math.ceil(size / pasteAlphabet.length)).slice(0, size);
      return step(({ session }) => paste(session.page, text));
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
      return step(() => delay(ms));
    }
    case "wait-for": {
      const testId = needsValue();
      return step(({ session }) =>
        session.page.getByTestId(testId).waitFor({ state: "visible", timeout: waitLimitMs }),
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
  for (const { step, run } of steps) {
    try {
      const value = await run(context);
      results.push(value === undefined ? { step, ok: true } : { step, ok: true, value });
    } catch (error) {
      const tree = await readTree(session.page).catch((treeError: unknown) => reason(treeError));
      results.push({ step, ok: false, error: reason(error), tree });
      break;
    }
  }
  return { ...context, results };
}

function print(output: unknown): void {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function report(failure: { scenario: string; failedStep: string; error: unknown }): false {
  print({
    scenario: failure.scenario,
    steps: [{ step: failure.failedStep, ok: false, error: reason(failure.error) }],
    consoleErrors: [],
    screenshots: [],
  });
  return false;
}

async function main(): Promise<boolean> {
  const fallbackScenario = process.argv[2] ?? "";
  let args: Arguments;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    return report({ scenario: fallbackScenario, failedStep: "arguments", error });
  }
  if (args.target.kind === "built") {
    try {
      await buildApp();
    } catch (error) {
      return report({ scenario: args.scenario, failedStep: "build", error });
    }
  }
  let session: AppSession;
  try {
    session = await launchApp(args);
  } catch (error) {
    return report({ scenario: args.scenario, failedStep: "launch", error });
  }
  const stop = (): void => {
    void session.close().finally(() => process.exit(130));
  };
  process.once("SIGINT", stop);
  session.page.setDefaultTimeout(stepTimeoutMs);
  const { results, screenshots } = await runSteps(session, args.steps).finally(() =>
    session.close(),
  );
  process.off("SIGINT", stop);
  const ok = results.every((result) => result.ok);
  print({
    scenario: args.scenario,
    home: session.home,
    repo: session.repo,
    steps: results,
    consoleErrors: session.consoleErrors,
    screenshots,
  });
  return ok;
}

process.exitCode = (await main()) ? 0 : 1;
