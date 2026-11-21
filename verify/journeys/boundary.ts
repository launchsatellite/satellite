import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import { z } from "zod";
import { sendToClaudeCodeEvent } from "../../src/renderer/sessions/send-to-claude-code.ts";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  bridgeAnswer,
  bridgeCode,
  claudePids,
  processGone,
  promptTimeoutMs,
  settingsFileOf,
  standInInput,
  startClaude,
  toastReads,
  waitUntil,
} from "./conditions.ts";

interface PolicyProbe {
  inlineScriptRan: boolean;
  dataFetch: string;
  remoteFetch: string;
  violations: string[];
}

const remote = "https://example.com";
const stillHere = "still here";
const settleMs = 1_000;
const violationTimeoutMs = 10_000;
const policyDirectives = ["script-src-elem", "connect-src", "img-src", "frame-src"];
const madeUpFingerprint = "0".repeat(64);
const listedName = "listed by changes.txt";
const notReady =
  "Satellite sends here only after Claude Code reports your first request. Type this one yourself.";
const hookSettings = z.object({
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
const escapingPaths = [
  "app://satellite/%2e%2e/%2e%2e/package.json",
  "app://satellite/..%2f..%2fpackage.json",
  "app://satellite/..%5c..%5cpackage.json",
];

function openPages(page: Page): number {
  return (
    page
      .context()
      .browser()
      ?.contexts()
      .reduce((count, context) => count + context.pages().length, 0) ?? 0
  );
}

async function checkNoNode(page: Page): Promise<void> {
  const globals = await page.evaluate(() => ({
    require: typeof require,
    process: typeof process,
    module: typeof module,
    Buffer: typeof Buffer,
  }));
  for (const [name, type] of Object.entries(globals)) {
    assert.equal(type, "undefined", `the window can reach ${name}, its type is ${type}`);
  }
  const keys = await page.evaluate(() => {
    const api: unknown = Reflect.get(window, "satellite");
    return typeof api === "object" && api !== null ? Object.keys(api) : null;
  });
  assert.deepEqual(
    keys,
    ["invoke", "onEvent", "pathForFile"],
    `window.satellite should expose only invoke, onEvent and pathForFile, it exposes ${JSON.stringify(keys)}`,
  );
}

async function checkPathForFile(page: Page): Promise<void> {
  const answers = await page.evaluate(() => {
    const api: unknown = Reflect.get(window, "satellite");
    const pathForFile: unknown =
      typeof api === "object" && api !== null ? Reflect.get(api, "pathForFile") : undefined;
    const ask = (value: unknown) => {
      if (typeof pathForFile !== "function") return "missing";
      try {
        return JSON.stringify(Reflect.apply(pathForFile, api, [value]));
      } catch (error) {
        return `threw ${String(error)}`;
      }
    };
    return { madeUp: ask(new File(["x"], "x.txt")), text: ask("/etc") };
  });
  assert.equal(answers.madeUp, '""', `pathForFile of a made-up file answered ${answers.madeUp}`);
  assert.equal(answers.text, '""', `pathForFile of the text /etc answered ${answers.text}`);
}

async function projectCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const api: unknown = Reflect.get(window, "satellite");
    const invoke: unknown =
      typeof api === "object" && api !== null ? Reflect.get(api, "invoke") : undefined;
    if (typeof invoke !== "function") return -1;
    const answer: unknown = await Reflect.apply(invoke, api, ["projects.list", {}]);
    const value: unknown =
      typeof answer === "object" && answer !== null ? Reflect.get(answer, "value") : undefined;
    const projects: unknown =
      typeof value === "object" && value !== null ? Reflect.get(value, "projects") : undefined;
    return Array.isArray(projects) ? projects.length : -1;
  });
}

async function checkRelativeDrop(page: Page): Promise<void> {
  const before = await projectCount(page);
  for (const path of ["relative/folder", "."]) {
    const code = await bridgeCode(page, "projects.drop", { path });
    assert.equal(code, "refused", `projects.drop of ${path} answered ${code}, not refused`);
  }
  const after = await projectCount(page);
  assert.equal(
    after,
    before,
    `a relative drop changed the projects from ${String(before)} to ${String(after)}`,
  );
}

async function okValue<T>(page: Page, channel: string, payload: unknown, schema: z.ZodType<T>) {
  const answer = await bridgeAnswer(page, channel, payload);
  const parsed = z.object({ ok: z.literal(true), value: schema }).safeParse(answer);
  assert.ok(parsed.success, `${channel} answered ${JSON.stringify(answer)}`);
  return parsed.data.value;
}

async function refusedWith(page: Page, channel: string, payload: unknown, expected: string) {
  const code = await bridgeCode(page, channel, payload);
  assert.equal(
    code,
    expected,
    `${channel} with ${JSON.stringify(payload)} gave ${code} instead of ${expected}`,
  );
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function checkWorkspaceRequests(session: AppSession): Promise<string> {
  const { page } = session;
  const { project } = await okValue(
    page,
    "projects.drop",
    { path: session.repo },
    z.object({ project: z.object({ id: z.string() }) }),
  );
  const projectId = project.id;
  const madeUp = randomUUID();
  const start = { kind: "default" };
  for (const name of ["../../outside", "-x"]) {
    const request = { operationId: randomUUID(), projectId, name, start };
    await refusedWith(page, "workspaces.create", request, "invalid-request");
  }
  const archiveMain = { projectId, workspaceId: "main", fingerprint: madeUpFingerprint };
  await refusedWith(page, "workspaces.archive", archiveMain, "invalid-request");
  const otherProject = { projectId: madeUp, workspaceId: madeUp };
  await refusedWith(
    page,
    "workspaces.cancel",
    { operationId: madeUp, projectId: madeUp },
    "not-found",
  );
  await refusedWith(page, "workspaces.inspect", otherProject, "not-found");
  await refusedWith(
    page,
    "workspaces.archive",
    { ...otherProject, fingerprint: madeUpFingerprint },
    "not-found",
  );
  await refusedWith(page, "workspaces.inspect", { projectId, workspaceId: madeUp }, "not-found");
  const canceled = await okValue(
    page,
    "workspaces.cancel",
    { operationId: madeUp, projectId },
    z.object({ canceled: z.boolean() }),
  );
  assert.equal(canceled.canceled, false, "workspaces.cancel stopped a made-up operation");
  const worktrees = join(session.home, "worktrees");
  assert.ok(!(await exists(worktrees)), "a refused workspace request made the worktrees folder");
  return projectId;
}

async function checkChangesRequests(page: Page, projectId: string, repo: string): Promise<void> {
  const workspace = { projectId, workspace: "main" };
  const view = "uncommitted";
  for (const payload of [
    { workspace, view, args: ["--output=/tmp/written"] },
    { workspace, view: "staged" },
    { workspace, view: ["branch"] },
    { workspace: { projectId, workspace: "../main" }, view },
  ]) {
    await refusedWith(page, "changes.list", payload, "invalid-request");
  }
  for (const elsewhere of [
    { projectId: randomUUID(), workspace: "main" },
    { projectId, workspace: randomUUID() },
  ]) {
    await refusedWith(page, "changes.list", { workspace: elsewhere, view }, "not-found");
  }
  const { changes } = await okValue(
    page,
    "changes.list",
    { workspace, view },
    z.object({ changes: z.object({ kind: z.literal("files"), files: z.array(z.unknown()) }) }),
  );
  assert.deepEqual(changes.files, [], "changes.list listed files in a clean main workspace");
  await writeFile(join(repo, listedName), "listed\n");
  const listed = await okValue(
    page,
    "changes.list",
    { workspace, view },
    z.object({
      changes: z.object({
        kind: z.literal("files"),
        files: z.array(z.object({ path: z.string() })),
      }),
    }),
  );
  assert.deepEqual(
    listed.changes.files.map((file) => file.path),
    [listedName],
    "changes.list missed a new untracked file",
  );
  for (const path of [
    "../../../etc/hosts",
    ".git/config",
    "README.md",
    "/etc/hosts",
    "C:\\Windows\\win.ini",
    "./README.md",
    ".GIT/HEAD",
  ]) {
    await refusedWith(page, "changes.file", { workspace, view, path }, "not-found");
  }
  const shown = await okValue(
    page,
    "changes.file",
    { workspace, view, path: listedName },
    z.object({ kind: z.literal("text"), modified: z.string() }),
  );
  assert.equal(shown.modified, "listed\n", "changes.file did not answer a listed file");
  const elsewhere = { projectId: randomUUID(), workspace: "main" };
  await refusedWith(
    page,
    "changes.file",
    { workspace: elsewhere, view, path: "README.md" },
    "not-found",
  );
  for (const path of ["", "a".repeat(4097), 1, ["README.md"], null]) {
    await refusedWith(page, "changes.file", { workspace, view, path }, "invalid-request");
  }
  await refusedWith(
    page,
    "changes.file",
    { workspace, view, path: "README.md", oid: "0".repeat(40) },
    "invalid-request",
  );
  await unlink(join(repo, listedName));
  await checkChangesFlood(page, workspace);
}

async function checkChangesFlood(page: Page, workspace: unknown): Promise<void> {
  const codes = await page.evaluate(
    async ({ target, requests }) => {
      const api: unknown = Reflect.get(window, "satellite");
      const invoke: unknown =
        typeof api === "object" && api !== null ? Reflect.get(api, "invoke") : undefined;
      if (typeof invoke !== "function") return ["window.satellite.invoke is missing"];
      const ask = async (channel: string, payload: unknown) => {
        const answer: unknown = await Reflect.apply(invoke, api, [channel, payload]);
        const error: unknown =
          typeof answer === "object" && answer !== null ? Reflect.get(answer, "error") : undefined;
        const code: unknown =
          typeof error === "object" && error !== null ? Reflect.get(error, "code") : "ok";
        return typeof code === "string" ? code : "unreadable";
      };
      return Promise.all(
        Array.from({ length: requests }, (_, index) =>
          index % 3 === 2
            ? ask("changes.file", { workspace: target, view: "branch", path: "README.md" })
            : ask("changes.list", {
                workspace: target,
                view: index % 3 === 0 ? "branch" : "uncommitted",
              }),
        ),
      );
    },
    { target: workspace, requests: 300 },
  );
  const unexpected = codes.filter((code) => !["ok", "refused", "not-found"].includes(code));
  assert.deepEqual(unexpected, [], `a flood of changes requests answered ${unexpected.join(", ")}`);
  const { changes } = await okValue(
    page,
    "changes.list",
    { workspace, view: "uncommitted" },
    z.object({ changes: z.object({ kind: z.literal("files") }) }),
  );
  assert.equal(changes.kind, "files", "changes.list no longer answered after a flood");
}

async function checkFingerprint(session: AppSession, projectId: string): Promise<void> {
  const { page } = session;
  const { workspace } = await okValue(
    page,
    "workspaces.create",
    { operationId: randomUUID(), projectId, name: "kept-look", start: { kind: "default" } },
    z.object({ workspace: z.object({ key: z.string() }) }),
  );
  const target = { projectId, workspaceId: workspace.key };
  const folder = join(session.home, "worktrees", "repo", "kept-look");
  await refusedWith(
    page,
    "workspaces.archive",
    { ...target, fingerprint: madeUpFingerprint },
    "refused",
  );
  const { fingerprint } = await okValue(
    page,
    "workspaces.inspect",
    target,
    z.object({ fingerprint: z.string() }),
  );
  await writeFile(join(folder, "written-after.txt"), "written after the inspection\n");
  await refusedWith(page, "workspaces.archive", { ...target, fingerprint }, "refused");
  assert.ok(
    await exists(join(folder, "written-after.txt")),
    "an archive with a stale fingerprint deleted the workspace's files",
  );
}

async function probePolicy(page: Page): Promise<PolicyProbe> {
  return page.evaluate(
    async ({ origin, directives, timeoutMs }) => {
      const violations = new Set<string>();
      addEventListener("securitypolicyviolation", (event) => {
        violations.add(event.effectiveDirective);
      });
      const script = document.createElement("script");
      script.textContent = "window.satelliteInlineScriptRan = true";
      document.head.append(script);
      script.remove();
      const settle = (request: Promise<unknown>) =>
        request.then(
          () => "resolved",
          () => "rejected",
        );
      const dataFetch = await settle(fetch("data:text/plain,satellite"));
      const remoteFetch = await settle(fetch(`${origin}/fetch`));
      const image = new Image();
      image.src = `${origin}/image.png`;
      const frame = document.createElement("iframe");
      frame.src = `${origin}/frame`;
      document.body.append(frame);
      const deadline = Date.now() + timeoutMs;
      while (!directives.every((directive) => violations.has(directive)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      frame.remove();
      return {
        inlineScriptRan: Reflect.get(window, "satelliteInlineScriptRan") === true,
        dataFetch,
        remoteFetch,
        violations: [...violations],
      };
    },
    { origin: remote, directives: policyDirectives, timeoutMs: violationTimeoutMs },
  );
}

async function checkPolicy(page: Page): Promise<void> {
  const probe = await probePolicy(page);
  assert.ok(!probe.inlineScriptRan, "an inline script ran, so the content security policy is off");
  assert.equal(probe.dataFetch, "rejected", "a fetch of a data: address was not refused");
  assert.equal(probe.remoteFetch, "rejected", "a fetch of a remote address was not refused");
  for (const directive of policyDirectives) {
    assert.ok(
      probe.violations.includes(directive),
      `the content security policy reported no ${directive} refusal, only ${JSON.stringify(probe.violations)}`,
    );
  }
}

async function checkPermissions(page: Page): Promise<void> {
  const states = await page.evaluate(async () => ({
    microphone: (await navigator.permissions.query({ name: "microphone" })).state,
    camera: (await navigator.permissions.query({ name: "camera" })).state,
    notifications: Notification.permission,
    notificationRequest: await Notification.requestPermission(),
  }));
  for (const [permission, state] of Object.entries(states)) {
    assert.equal(state, "denied", `the ${permission} permission reads ${state}, not denied`);
  }
}

async function checkPaths(page: Page): Promise<void> {
  for (const url of escapingPaths) {
    const status = await page.evaluate(
      (target) => fetch(target).then((response) => response.status),
      url,
    );
    assert.equal(status, 404, `${url} answered ${String(status)}, not 404`);
  }
}

async function checkBridge(page: Page): Promise<void> {
  const invalid = await bridgeCode(page, "terminal.resize", { id: "x" });
  assert.equal(
    invalid,
    "invalid-request",
    `terminal.resize with a bad payload answered ${invalid}, not invalid-request`,
  );
  const unknown = await bridgeCode(page, "__proto__", {});
  assert.equal(
    unknown,
    "unknown-channel",
    `the __proto__ channel answered ${unknown}, not unknown-channel`,
  );
}

async function checkLeaving(page: Page, appUrl: string, reached: string[]): Promise<void> {
  const pagesBefore = openPages(page);
  const denied = await page.evaluate((url) => window.open(url) === null, `${remote}/window`);
  assert.ok(denied, "window.open returned a window");
  for (const target of [`${remote}/navigate`, "file:///"]) {
    await page
      .evaluate((url) => {
        location.assign(url);
      }, target)
      .catch(() => undefined);
  }
  await delay(settleMs);
  assert.deepEqual(reached, [], `the window reached ${reached.join(" and ")}`);
  assert.equal(openPages(page), pagesBefore, "window.open made a new page");
  assert.equal(page.url(), appUrl, `the window left the app for ${page.url()}`);
}

async function checkTerminalSurvives(session: AppSession, pid: number): Promise<void> {
  assert.ok(!processGone(pid), "a refused navigation ended Claude Code");
  await session.page.keyboard.type(stillHere);
  await waitUntil(
    async () =>
      (await session.page.getByTestId("terminal").textContent())?.includes(stillHere) === true,
    promptTimeoutMs,
    "after a refused navigation the terminal no longer echoed what was typed",
  );
}

async function startsRefused(session: AppSession, projectId: string): Promise<void> {
  const { page } = session;
  const starts = (await claudePids(session)).length;
  const request = {
    id: randomUUID(),
    program: "claude",
    workspace: { projectId, workspace: "main" },
    resume: false,
    cols: 80,
    rows: 24,
  };
  await refusedWith(page, "terminal.start", { ...request, program: "sh" }, "invalid-request");
  await refusedWith(page, "terminal.start", { ...request, args: ["--help"] }, "invalid-request");
  await refusedWith(page, "terminal.start", { ...request, cwd: "/" }, "invalid-request");
  const elsewhere = { ...request, workspace: { projectId: randomUUID(), workspace: "main" } };
  await refusedWith(page, "terminal.start", elsewhere, "not-found");
  const madeUp = { ...request, workspace: { projectId, workspace: randomUUID() } };
  await refusedWith(page, "terminal.start", madeUp, "not-found");
  await refusedWith(page, "terminal.start", { ...request, resume: true }, "not-found");
  await refusedWith(page, "links.open", { url: "javascript:alert(1)" }, "refused");
  assert.equal(
    (await claudePids(session)).length,
    starts,
    "a refused terminal.start started Claude Code",
  );
  await okValue(page, "terminal.start", request, z.object({}));
  await waitUntil(
    async () => (await claudePids(session)).length > starts,
    promptTimeoutMs,
    "the request the refusals were built from did not start Claude Code",
  );
}

async function resumableRefused(page: Page, projectId: string): Promise<void> {
  const main = { projectId, workspace: "main" };
  await refusedWith(page, "sessions.resumable", { workspace: main, id: "x" }, "invalid-request");
  const climbing = { projectId, workspace: "../main" };
  await refusedWith(page, "sessions.resumable", { workspace: climbing }, "invalid-request");
  const answer = z.object({ resumable: z.boolean() });
  for (const workspace of [
    main,
    { projectId: randomUUID(), workspace: "main" },
    { projectId, workspace: randomUUID() },
  ]) {
    const { resumable } = await okValue(page, "sessions.resumable", { workspace }, answer);
    assert.equal(resumable, false, `sessions.resumable offered ${JSON.stringify(workspace)}`);
  }
}

async function forgedHooks(session: AppSession, pid: number): Promise<void> {
  const file = await settingsFileOf(session, pid);
  const settings = hookSettings.parse(JSON.parse(await readFile(file, "utf8")));
  const hook = settings.hooks["UserPromptSubmit"]?.[0]?.hooks[0];
  assert.ok(hook !== undefined, "the settings file holds no UserPromptSubmit hook");
  const pixel = session.page.getByTestId("workspace-repo-main-status");
  const before = await pixel.getAttribute("data-state");
  const body = JSON.stringify({ session_id: randomUUID(), hook_event_name: "UserPromptSubmit" });
  const json = { "Content-Type": "application/json" };
  const forgeries = [
    { what: "without a secret", headers: json, expected: 401 },
    {
      what: "with a wrong secret",
      headers: { ...json, Authorization: `Bearer ${madeUpFingerprint}` },
      expected: 401,
    },
    {
      what: "with an Origin",
      headers: { ...json, ...hook.headers, Origin: remote },
      expected: 403,
    },
  ];
  for (const { what, headers, expected } of forgeries) {
    const response: Response = await fetch(hook.url, { method: "POST", headers, body });
    await response.arrayBuffer();
    assert.equal(response.status, expected, `a hook ${what} got ${String(response.status)}`);
  }
  const after = await pixel.getAttribute("data-state");
  assert.equal(
    after,
    before,
    `forged hooks moved the pixel from ${String(before)} to ${String(after)}`,
  );
}

async function sendsBeforeStart(session: AppSession): Promise<void> {
  const before = (await session.standInEvents()).length;
  await session.page.evaluate(
    ({ name, detail }) => {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    },
    { name: sendToClaudeCodeEvent, detail: { text: "typed into a question" } },
  );
  await toastReads(session, notReady, "after a send before Claude Code started,");
  assert.equal(
    await standInInput(session, before),
    "",
    "a send typed into Claude Code before it reported its start",
  );
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  const appUrl = page.url();
  const reached: string[] = [];
  await page.context().route(`${remote}/**`, (route) => {
    reached.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "" });
  });
  await checkNoNode(page);
  await checkPolicy(page);
  await checkPermissions(page);
  await checkPaths(page);
  await checkBridge(page);
  await checkPathForFile(page);
  await checkRelativeDrop(page);
  const projectId = await checkWorkspaceRequests(session);
  await checkChangesRequests(page, projectId, session.repo);
  await checkFingerprint(session, projectId);
  await resumableRefused(page, projectId);
  await startsRefused(session, projectId);
  await session.screenshot("boundary");
  await page.reload();
  await page.getByTestId("workspace-repo-main").click();
  const pid = await startClaude(session, 2);
  await checkLeaving(page, appUrl, reached);
  await checkTerminalSurvives(session, pid);
  await forgedHooks(session, pid);
  await sendsBeforeStart(session);
}

export const boundaryJourney: Journey = { name: "boundary", scenario: "default", run };
