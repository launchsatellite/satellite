import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { z } from "zod";
import { endWindowsTree } from "../src/main/platform/process-tree.ts";
import { buildRepo, withoutGitVariables, writeInside } from "./repo-recipe.ts";
import { loadScenario, type Scenario } from "./scenario.ts";
import { readStandInEvents, type StandInEvent } from "./stand-ins/stand-in-log.ts";

export type AppTarget =
  { kind: "built" } | { kind: "dev" } | { kind: "packaged"; executable: string };
export interface LaunchOptions {
  scenario: string;
  target: AppTarget;
  realClaude?: boolean;
  keep?: boolean;
}
export interface CloseResult {
  exitedOnItsOwn: boolean;
  leftover?: string;
}
export type RecordedNotice = z.infer<typeof recordedNotice>;
export interface AppSession {
  readonly page: Page;
  home: string;
  repo: string;
  userHome: string;
  gitEnv: Record<string, string>;
  folder(name: string): string;
  answerFolderDialog(path: string | undefined): Promise<void>;
  dropFolder(path: string): Promise<void>;
  dropFiles(testId: string, paths: string[]): Promise<void>;
  selectDiffLines(side: "original" | "modified", start: number, end: number): Promise<void>;
  selectFileLines(start: number, end: number): Promise<void>;
  openedLinks(): Promise<string[]>;
  notices(): Promise<RecordedNotice[]>;
  standInEvents(): Promise<StandInEvent[]>;
  consoleErrors: string[];
  screenshot(name: string): Promise<string>;
  relaunch(whileClosed?: () => Promise<void>): Promise<void>;
  close(): Promise<CloseResult>;
}
export interface WindowTree {
  aria: string;
  testIds: { testId: string; visible: boolean; text: string }[];
}
interface RunningApp {
  child?: ChildProcess;
  browser?: Browser;
  page?: Page;
  output: string;
}
interface AppPaths {
  home: string;
  repo: string;
  userHome: string;
  gitConfig: string;
  log: string;
  dialog: string;
  links: string;
  notices: string;
  missingClaude: string | undefined;
  gitStandIn: boolean;
}
interface AppCommand {
  file: string;
  args: string[];
  cwd: string;
  origin: string;
}

const recordedNotice = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("notice"), title: z.string(), body: z.string() }),
  z.strictObject({ kind: z.literal("close") }),
  z.strictObject({ kind: z.literal("badge"), count: z.int() }),
]);
const repoRoot = join(import.meta.dirname, "..");
const electronVite = join(repoRoot, "node_modules/electron-vite/bin/electron-vite.js");
const devElectron = join(import.meta.dirname, "dev-electron.ts");
const startTimeoutMs = 60_000;
const exitTimeoutMs = 10_000;
const pageCallTimeoutMs = 5_000;
const outputTailLength = 4000;
const consoleErrorLimit = 200;
const textLimit = 2000;
const devToolsLine = /DevTools listening on (ws:\/\/\S+)/;
const shotName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const strippedVariables = new Set([
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "SATELLITE_CLAUDE",
  "SATELLITE_GIT",
  "CLAUDECODE",
]);
const strippedPrefixes = ["CLAUDE_CODE_"];
const homeVariables = new Set(["HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR"]);
const stopSignals: NodeJS.Signals[] =
  process.platform === "win32"
    ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]
    : ["SIGINT", "SIGTERM", "SIGHUP"];
const cleanups = new Set<() => Promise<unknown>>();
const startedApps = new Set<ChildProcess>();
let signalHandlersInstalled = false;
let stopping = false;

const outputFolder = join(repoRoot, "verify-output");
const lockFile = join(outputFolder, "run.lock");
const pasteAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
let lockHeld = false;

export const outputDir = outputFolder;
export const folderTarget = /^[a-z0-9-]+(?:\/[a-z0-9.-]+)*$/;

async function stopForSignal(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([...cleanups].map((cleanup) => cleanup()));
  process.exit(128 + constants.signals[signal]);
}

function killStartedAppsNow(): void {
  for (const child of startedApps) {
    const pid = child.pid;
    if (pid === undefined || hasExited(child)) continue;
    if (process.platform === "win32") {
      const taskkill = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
      spawnSync(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
      continue;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function stopOnSignals(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  process.on("exit", killStartedAppsNow);
  for (const signal of stopSignals) {
    process.on(signal, () => {
      void stopForSignal(signal);
    });
  }
}

function releaseLock(): void {
  try {
    if (readFileSync(lockFile, "utf8") === String(process.pid)) unlinkSync(lockFile);
  } catch {
    return;
  }
}

async function takeLock(): Promise<boolean> {
  try {
    const handle = await open(lockFile, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
}

async function holdCheckoutLock(): Promise<void> {
  if (lockHeld) return;
  await mkdir(outputDir, { recursive: true });
  if (!(await takeLock())) {
    const owner = Number(await readFile(lockFile, "utf8").catch(() => ""));
    if (Number.isInteger(owner) && owner > 0 && isProcessAlive(owner)) {
      throw new Error(
        `another verify run (process ${String(owner)}) is using this checkout. Wait for it to finish or run from your own worktree.`,
      );
    }
    await unlink(lockFile).catch(() => undefined);
    if (!(await takeLock())) throw new Error("another verify run took this checkout just now");
  }
  lockHeld = true;
  process.once("exit", releaseLock);
}

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

function standIn(tool: "claude" | "gh" | "git"): string {
  return JSON.stringify([process.execPath, join(import.meta.dirname, "stand-ins", `${tool}.ts`)]);
}

function isStripped(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    strippedVariables.has(upper) || strippedPrefixes.some((prefix) => upper.startsWith(prefix))
  );
}

function appEnvironment(
  options: LaunchOptions,
  { home, userHome, gitConfig, log, dialog, links, notices, missingClaude, gitStandIn }: AppPaths,
): Record<string, string | undefined> {
  const keepsUserHome = options.realClaude === true;
  const env: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(withoutGitVariables(process.env)).filter(
      ([key]) => !isStripped(key) && (keepsUserHome || !homeVariables.has(key.toUpperCase())),
    ),
  );
  if (options.target.kind === "dev") env["ELECTRON_EXEC_PATH"] = process.execPath;
  env["GIT_CONFIG_GLOBAL"] = gitConfig;
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["SATELLITE_HOME"] = home;
  env["SATELLITE_VERIFY_DRIVER_PID"] = String(process.pid);
  env["SATELLITE_VERIFY_SCENARIO"] = options.scenario;
  env["SATELLITE_VERIFY_LOG"] = log;
  env["SATELLITE_VERIFY_FOLDER_DIALOG"] = dialog;
  env["SATELLITE_VERIFY_LINKS"] = links;
  env["SATELLITE_VERIFY_NOTICES"] = notices;
  env["SATELLITE_GH"] = standIn("gh");
  if (gitStandIn) env["SATELLITE_GIT"] = standIn("git");
  if (!keepsUserHome) {
    env["HOME"] = userHome;
    if (process.platform === "win32") env["USERPROFILE"] = userHome;
  }
  if (missingClaude !== undefined) env["SATELLITE_CLAUDE"] = JSON.stringify([missingClaude]);
  else if (options.realClaude !== true) env["SATELLITE_CLAUDE"] = standIn("claude");
  return env;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    return;
  }
  if (hasExited(child)) return;
  void endWindowsTree(pid);
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
      reject(new Error(reason));
    }
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function recipeGitEnv(temp: string) {
  return {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(temp, "gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function prepareFolders(
  temp: string,
  { home, repo, userHome }: AppPaths,
  scenario: Scenario,
): Promise<void> {
  const gitEnv = recipeGitEnv(temp);
  await mkdir(home);
  await mkdir(repo);
  await mkdir(userHome);
  for (const file of scenario.home ?? []) await writeInside(home, file.path, file.content);
  for (const file of scenario.userHome ?? []) {
    await writeInside(userHome, file.path, file.content);
  }
  const noIgnores = join(temp, "git-ignore");
  await writeFile(noIgnores, "");
  await writeFile(
    gitEnv.GIT_CONFIG_GLOBAL,
    `[user]\n\tname = Satellite Verify\n\temail = verify@satellite.invalid\n[core]\n\texcludesFile = ${noIgnores.replaceAll("\\", "/")}\n`,
  );
  for (const folder of scenario.folders ?? []) {
    const target = join(temp, "folders", folder.name);
    await mkdir(target, { recursive: true });
    await buildRepo(target, folder.steps, gitEnv);
  }
  await buildRepo(repo, scenario.repo, gitEnv);
  if (scenario.workspaces !== undefined) await seedWorkspaces(home, repo, scenario, gitEnv);
}

async function seedWorkspaces(
  home: string,
  repo: string,
  scenario: Scenario,
  gitEnv: Record<string, string>,
): Promise<void> {
  const workspaces = [];
  for (const { name, steps } of scenario.workspaces ?? []) {
    const folder = join(home, "worktrees", "repo", name);
    await buildRepo(
      repo,
      [{ git: ["branch", "--no-track", name, "HEAD"] }, { git: ["worktree", "add", folder, name] }],
      gitEnv,
    );
    await buildRepo(folder, steps, gitEnv);
    workspaces.push({ id: randomUUID(), name, path: await realpath(folder), branch: name });
  }
  const project = { id: randomUUID(), path: await realpath(repo), workspaces };
  await writeFile(join(home, "projects.json"), JSON.stringify({ version: 2, projects: [project] }));
}

async function forceStop(child: ChildProcess): Promise<void> {
  killTree(child);
  await waitForExit(child, exitTimeoutMs);
  child.stdout?.destroy();
  child.stderr?.destroy();
}

async function removeTemp(temp: string, keep: boolean | undefined): Promise<string | undefined> {
  if (keep === true) return undefined;
  try {
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return undefined;
  } catch {
    return temp;
  }
}

function appPage(browser: Browser, origin: string): Page | undefined {
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith(origin));
}

async function findAppPage(browser: Browser, origin: string): Promise<Page> {
  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    if (!browser.isConnected()) throw new Error("the app closed before its page appeared");
    const page = appPage(browser, origin);
    if (page !== undefined) return page;
    await delay(100);
  }
  throw new Error(`no page with origin ${origin} appeared`);
}

function recordErrors(context: BrowserContext, consoleErrors: string[]): void {
  const record = (text: string): void => {
    if (consoleErrors.length < consoleErrorLimit) consoleErrors.push(text);
  };
  context.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  context.on("weberror", (error) => {
    record(error.error().message);
  });
}

async function startApp(
  options: LaunchOptions,
  paths: AppPaths,
  running: RunningApp,
  consoleErrors: string[],
): Promise<Page> {
  const { file, args, cwd, origin } = command(options.target, paths.repo);
  running.output = "";
  const child = spawn(file, args, {
    cwd,
    env: appEnvironment(options, paths),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  running.child = child;
  startedApps.add(child);
  child.once("exit", () => {
    startedApps.delete(child);
  });
  const collect = (chunk: Buffer): void => {
    running.output = (running.output + chunk.toString()).slice(-outputTailLength);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const address = await waitForDevTools(child, () => running.output);
  const browser = await chromium.connectOverCDP(address, { timeout: startTimeoutMs });
  running.browser = browser;
  for (const context of browser.contexts()) recordErrors(context, consoleErrors);
  const page = await findAppPage(browser, origin);
  await page.emulateMedia({ colorScheme: null, reducedMotion: "reduce" });
  const protocol = await page.context().newCDPSession(page);
  await protocol.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  running.page = page;
  await page.getByTestId("app-window").waitFor({ timeout: startTimeoutMs });
  return page;
}

async function stopApp(running: RunningApp): Promise<boolean> {
  const { child, browser, page } = running;
  await withTimeout(
    page?.evaluate(() => {
      window.close();
    }) ?? Promise.resolve(),
    pageCallTimeoutMs,
    "closing the window",
  ).catch(() => undefined);
  const exitedOnItsOwn = child === undefined ? true : await waitForExit(child, exitTimeoutMs);
  if (child !== undefined) await forceStop(child);
  await withTimeout(
    browser?.close() ?? Promise.resolve(),
    pageCallTimeoutMs,
    "disconnecting",
  ).catch(() => undefined);
  return exitedOnItsOwn;
}

async function dropOn(page: Page, testId: string, files: string[]): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`${testId} is not on screen to drop on`);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const data = { items: [], files, dragOperationsMask: 1 };
  const protocol = await page.context().newCDPSession(page);
  try {
    for (const type of ["dragEnter", "dragOver", "drop"] as const) {
      await protocol.send("Input.dispatchDragEvent", { type, x, y, data });
    }
  } finally {
    await protocol.detach();
  }
}

export class LaunchFailure extends Error {
  output = "";
  consoleErrors: string[] = [];
  tree: WindowTree | string | undefined;
  home: string | undefined;
  repo: string | undefined;
}

export function errorReason(error: unknown): string {
  return stripVTControlCharacters(error instanceof Error ? error.message : String(error));
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  const controller = new AbortController();
  const timeout = delay(timeoutMs, undefined, { signal: controller.signal }).then(() => {
    throw new Error(`${what} did not finish within ${String(timeoutMs / 1000)} seconds`);
  });
  return Promise.race([promise, timeout]).finally(() => {
    controller.abort();
  });
}

export async function readTree(page: Page): Promise<WindowTree> {
  const aria = await page.locator("body").ariaSnapshot({ timeout: pageCallTimeoutMs });
  const testIds = await withTimeout(
    page.locator("[data-testid]").evaluateAll(
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
    ),
    pageCallTimeoutMs,
    "reading the window",
  );
  return { aria, testIds };
}

export function electronBinary(): string {
  const binary: unknown = createRequire(import.meta.url)("electron");
  if (typeof binary !== "string") throw new Error("the electron package did not name its binary");
  return binary;
}

export async function buildApp(): Promise<void> {
  stopOnSignals();
  await holdCheckoutLock();
  const child = spawn(process.execPath, [electronVite, "build"], {
    cwd: repoRoot,
    stdio: ["ignore", 2, 2],
  });
  const cleanup = async (): Promise<void> => {
    child.kill("SIGKILL");
    await waitForExit(child, exitTimeoutMs);
  };
  cleanups.add(cleanup);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    if (code !== 0) throw new Error(`electron-vite build failed with code ${String(code)}`);
  } finally {
    cleanups.delete(cleanup);
  }
}

export async function launchApp(options: LaunchOptions): Promise<AppSession> {
  stopOnSignals();
  if (options.target.kind !== "packaged") await holdCheckoutLock();
  const { scenario } = await loadScenario(options.scenario);
  const temp = await realpath(await mkdtemp(join(tmpdir(), "satellite-verify-")));
  const home = join(temp, "home");
  const repo = join(temp, "repo");
  const userHome = join(temp, "user-home");
  const log = join(temp, "stand-ins.jsonl");
  const dialog = join(temp, "folder-dialog.txt");
  const links = join(temp, "links.txt");
  const notices = join(temp, "notices.jsonl");
  const missingClaude = "missing" in scenario.claude ? join(temp, "missing-claude") : undefined;
  const gitConfig = recipeGitEnv(temp).GIT_CONFIG_GLOBAL;
  const gitStandIn = scenario.gitStandIn === true;
  const paths = {
    home,
    repo,
    userHome,
    gitConfig,
    log,
    dialog,
    links,
    notices,
    missingClaude,
    gitStandIn,
  };
  const shots = join(
    outputDir,
    `${options.scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  const consoleErrors: string[] = [];
  const running: RunningApp = { output: "" };
  const abandon = async (): Promise<string | undefined> => {
    if (running.child !== undefined) await forceStop(running.child);
    await withTimeout(
      running.browser?.close() ?? Promise.resolve(),
      pageCallTimeoutMs,
      "disconnecting",
    ).catch(() => undefined);
    return removeTemp(temp, options.keep);
  };
  cleanups.add(abandon);
  let page: Page;
  try {
    await prepareFolders(temp, paths, scenario);
    page = await startApp(options, paths, running, consoleErrors);
  } catch (error) {
    const failure = new LaunchFailure(errorReason(error), { cause: error });
    failure.output = running.output;
    failure.consoleErrors = consoleErrors;
    failure.tree =
      running.page === undefined
        ? undefined
        : await readTree(running.page).catch((treeError: unknown) => errorReason(treeError));
    failure.home = home;
    failure.repo = repo;
    await abandon();
    cleanups.delete(abandon);
    throw failure;
  }
  let closing: Promise<CloseResult> | undefined;
  let relaunching: Promise<void> | undefined;
  const relaunchOnce = async (whileClosed?: () => Promise<void>): Promise<void> => {
    await stopApp(running);
    running.child = undefined;
    running.browser = undefined;
    running.page = undefined;
    await whileClosed?.();
    if (closing !== undefined) throw new Error("the app was closed during the restart");
    page = await startApp(options, paths, running, consoleErrors);
  };
  const closeOnce = async (): Promise<CloseResult> => {
    const exitedOnItsOwn = await stopApp(running);
    if (relaunching !== undefined) {
      await relaunching.catch(() => undefined);
      await stopApp(running);
    }
    const leftover = await removeTemp(temp, options.keep);
    cleanups.delete(abandon);
    return leftover === undefined ? { exitedOnItsOwn } : { exitedOnItsOwn, leftover };
  };
  return {
    get page() {
      return page;
    },
    home,
    repo,
    userHome,
    gitEnv: recipeGitEnv(temp),
    folder(name) {
      const segments = name.split("/");
      if (!folderTarget.test(name) || segments.some((part) => part === "." || part === "..")) {
        throw new Error(`folder ${name} must be kebab-case segments joined by /`);
      }
      return join(temp, "folders", ...segments);
    },
    answerFolderDialog: (path) => writeFile(dialog, path ?? ""),
    dropFolder: (path) => dropOn(page, "column-repository", [path]),
    dropFiles: (testId, files) => dropOn(page, testId, files),
    async selectDiffLines(side, start, end) {
      const number = (line: number) =>
        page
          .locator(
            `[data-testid="diff"][data-side="${side}"] .line-numbers, [data-testid="diff"] .editor.${side} .line-numbers`,
          )
          .filter({ hasText: new RegExp(`^${String(line)}$`) });
      await number(start).click();
      await number(end).click({ modifiers: ["Shift"] });
      await page.waitForFunction(() => document.activeElement?.closest("[data-testid='diff']"));
    },
    async selectFileLines(start, end) {
      const number = (line: number) =>
        page
          .locator('[data-testid="file-text"] .line-numbers')
          .filter({ hasText: new RegExp(`^${String(line)}$`) });
      await number(start).click();
      await number(end).click({ modifiers: ["Shift"] });
      await page.waitForFunction(() =>
        document.activeElement?.closest("[data-testid='file-text']"),
      );
    },
    async openedLinks() {
      const text = await readFile(links, "utf8").catch(() => "");
      return text.split("\n").filter((line) => line !== "");
    },
    async notices() {
      const text = await readFile(notices, "utf8").catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
        throw error;
      });
      return text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => recordedNotice.parse(JSON.parse(line)));
    },
    consoleErrors,
    standInEvents: () => readStandInEvents(log),
    async screenshot(name) {
      if (!shotName.test(name)) throw new Error(`screenshot name ${name} must be kebab-case`);
      const path = join(shots, `${name}.png`);
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path, timeout: startTimeoutMs });
      return path;
    },
    relaunch(whileClosed) {
      if (closing !== undefined) return Promise.reject(new Error("the app is already closed"));
      relaunching = relaunchOnce(whileClosed);
      return relaunching;
    },
    close() {
      closing ??= closeOnce();
      return closing;
    },
  };
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export function generatedText(size: number): string {
  return pasteAlphabet.repeat(Math.ceil(size / pasteAlphabet.length)).slice(0, size);
}

export async function pasteIntoFocus(page: Page, text: string): Promise<string | undefined> {
  const target = await page.evaluate((data) => {
    const active = document.activeElement;
    if (active === null || active === document.body) return null;
    const transfer = new DataTransfer();
    transfer.setData("text/plain", data);
    active.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
    return active.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
  }, text);
  return target ?? undefined;
}
