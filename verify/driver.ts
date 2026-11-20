import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import { buildRepo } from "./repo-recipe.ts";
import { loadScenario, type RepoStep } from "./scenario.ts";
import { readStandInEvents, type StandInEvent } from "./stand-ins/stand-in-log.ts";

export type AppTarget =
  { kind: "built" } | { kind: "dev" } | { kind: "packaged"; executable: string };
export interface LaunchOptions {
  scenario: string;
  target: AppTarget;
  realClaude?: boolean;
  keep?: boolean;
}
export interface AppSession {
  page: Page;
  home: string;
  repo: string;
  standInEvents(): Promise<StandInEvent[]>;
  consoleErrors: string[];
  screenshot(name: string): Promise<string>;
  close(): Promise<void>;
}

interface AppCommand {
  file: string;
  args: string[];
  cwd: string;
  origin: string;
}

const repoRoot = join(import.meta.dirname, "..");
const electronVite = join(repoRoot, "node_modules/electron-vite/bin/electron-vite.js");
const devElectron = join(import.meta.dirname, "dev-electron.ts");
const startTimeoutMs = 60_000;
const exitTimeoutMs = 10_000;
const outputTailLength = 4000;
const consoleErrorLimit = 200;
const devToolsLine = /DevTools listening on (ws:\/\/\S+)/;
const shotName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const strippedVariables = new Set(["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "SATELLITE_CLAUDE"]);

export const outputDir = join(repoRoot, "verify-output");

function command(target: AppTarget, repo: string): AppCommand {
  const debugging = "--remote-debugging-port=0";
  const origin = "app://satellite";
  if (target.kind === "built") {
    return { file: electronBinary(), args: [repoRoot, debugging], cwd: repo, origin };
  }
  if (target.kind === "packaged") {
    return { file: target.executable, args: [debugging], cwd: repo, origin };
  }
  return {
    file: process.execPath,
    args: [electronVite, "dev", "--entry", devElectron, "--", repo, debugging],
    cwd: repoRoot,
    origin: "http://localhost:",
  };
}

function standIn(tool: "claude" | "gh"): string {
  return JSON.stringify([process.execPath, join(import.meta.dirname, "stand-ins", `${tool}.ts`)]);
}

function appEnvironment(
  options: LaunchOptions,
  home: string,
  log: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !strippedVariables.has(key)),
  );
  if (options.target.kind === "dev") env["ELECTRON_EXEC_PATH"] = process.execPath;
  env["SATELLITE_HOME"] = home;
  env["SATELLITE_VERIFY_SCENARIO"] = options.scenario;
  env["SATELLITE_VERIFY_LOG"] = log;
  env["SATELLITE_GH"] = standIn("gh");
  if (options.realClaude !== true) env["SATELLITE_CLAUDE"] = standIn("claude");
  return env;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || hasExited(child)) return;
  if (process.platform === "win32") {
    const taskkill = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
    execFile(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return true;
  const exited = new Promise<boolean>((resolve) =>
    child.once("exit", () => {
      resolve(true);
    }),
  );
  return Promise.race([exited, delay(timeoutMs, false, { ref: false })]);
}

function waitForDevTools(child: ChildProcess, output: () => string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      fail(`the app printed no DevTools address within ${String(startTimeoutMs / 1000)} seconds`);
    }, startTimeoutMs);
    const onData = (): void => {
      const match = devToolsLine.exec(output());
      if (match?.[1] === undefined) return;
      cleanup();
      resolve(match[1]);
    };
    const onExit = (code: number | null): void => {
      fail(`the app exited with code ${String(code)} before it opened`);
    };
    const onError = (error: Error): void => {
      fail(`the app could not start. ${error.message}`);
    };
    function cleanup(): void {
      clearTimeout(timer);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
    }
    function fail(reason: string): void {
      cleanup();
      const tail = output();
      reject(new Error(tail === "" ? `${reason}.` : `${reason}. Its output ended with\n${tail}`));
    }
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function prepareFolders(
  temp: string,
  home: string,
  repo: string,
  steps: RepoStep[],
): Promise<void> {
  const gitconfig = join(temp, "gitconfig");
  await mkdir(home);
  await mkdir(repo);
  await writeFile(
    gitconfig,
    "[user]\n\tname = Satellite Verify\n\temail = verify@satellite.invalid\n",
  );
  await buildRepo(repo, steps, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_TERMINAL_PROMPT: "0",
  });
}

async function stopApp(child: ChildProcess, browser: Browser | undefined): Promise<void> {
  if (!(await waitForExit(child, exitTimeoutMs))) {
    killTree(child);
    await waitForExit(child, exitTimeoutMs);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  await browser?.close().catch(() => undefined);
}

async function removeTemp(temp: string, keep: boolean | undefined): Promise<void> {
  if (keep !== true) await rm(temp, { recursive: true, force: true, maxRetries: 5 });
}

async function findAppPage(browser: Browser, origin: string): Promise<Page> {
  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(origin));
    if (page !== undefined) return page;
    await delay(100);
  }
  throw new Error(`no page with origin ${origin} appeared`);
}

export function electronBinary(): string {
  const binary: unknown = createRequire(import.meta.url)("electron");
  if (typeof binary !== "string") throw new Error("the electron package did not name its binary");
  return binary;
}

export async function buildApp(): Promise<void> {
  const child = spawn(process.execPath, [electronVite, "build"], {
    cwd: repoRoot,
    stdio: ["ignore", 2, 2],
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`electron-vite build failed with code ${String(code)}`);
}

export async function launchApp(options: LaunchOptions): Promise<AppSession> {
  const { scenario } = await loadScenario(options.scenario);
  const temp = await mkdtemp(join(tmpdir(), "satellite-verify-"));
  const home = join(temp, "home");
  const repo = join(temp, "repo");
  const log = join(temp, "stand-ins.jsonl");
  const shots = join(
    outputDir,
    `${options.scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    await prepareFolders(temp, home, repo, scenario.repo);
    const { file, args, cwd, origin } = command(options.target, repo);
    child = spawn(file, args, {
      cwd,
      env: appEnvironment(options, home, log),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let output = "";
    const collect = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-outputTailLength);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    browser = await chromium.connectOverCDP(await waitForDevTools(child, () => output));
    const page = await findAppPage(browser, origin);
    const consoleErrors: string[] = [];
    const record = (text: string): void => {
      if (consoleErrors.length < consoleErrorLimit) consoleErrors.push(text);
    };
    page.on("console", (message) => {
      if (message.type() === "error") record(message.text());
    });
    page.on("pageerror", (error) => {
      record(error.message);
    });
    await page.getByTestId("app-window").waitFor({ timeout: startTimeoutMs });
    const app = child;
    const connection = browser;
    return {
      page,
      home,
      repo,
      consoleErrors,
      standInEvents: () => readStandInEvents(log),
      async screenshot(name) {
        if (!shotName.test(name)) throw new Error(`screenshot name ${name} must be kebab-case`);
        const path = join(shots, `${name}.png`);
        await mkdir(shots, { recursive: true });
        await page.screenshot({ path });
        return path;
      },
      async close() {
        await page
          .evaluate(() => {
            window.close();
          })
          .catch(() => undefined);
        await stopApp(app, connection);
        await removeTemp(temp, options.keep);
      },
    };
  } catch (error) {
    if (child !== undefined) {
      killTree(child);
      await stopApp(child, browser);
    }
    await removeTemp(temp, options.keep);
    throw error;
  }
}
