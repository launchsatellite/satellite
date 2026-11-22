import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { mkdir, readFile, rmdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer, Server } from "node:net";
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

const refusedFilePaths = [
  "..",
  "a/../../x",
  "/etc/hosts",
  "C:\\Windows",
  ".git",
  ".GIT/config",
  "link-out/inside.txt",
];
const treeFolder = "tree";
const treeFile = "tree/inner.txt";
const nestedFolder = "tree/nested";
const ignoredFile = "secret.log";
const findName = "find-me-by-name.txt";

async function checkFilesRefusals(page: Page, projectId: string): Promise<void> {
  const workspace = { projectId, workspace: "main" };
  const folders = Array.from({ length: 17 }, (_, at) => `d${String(at)}`);
  for (const payload of [
    { workspace, folders },
    { workspace, folders: [] },
    { workspace, folders: [1] },
    { workspace, folders: "" },
    { workspace, folders: ["a".repeat(4097)] },
    { workspace, folders: [""], follow: true },
    { workspace: { projectId, workspace: "../main" }, folders: [""] },
  ]) {
    await refusedWith(page, "files.list", payload, "invalid-request");
  }
  for (const payload of [
    { workspace, path: "a".repeat(4097), known: null },
    { workspace, path: 1, known: null },
    { workspace, path: "", known: null },
    { workspace, path: treeFile, known: {} },
    { workspace, path: treeFile },
    { workspace, path: treeFile, known: null, encoding: "latin1" },
  ]) {
    await refusedWith(page, "files.read", payload, "invalid-request");
  }
  for (const payload of [
    { workspace, query: "" },
    { workspace, query: "a".repeat(201) },
    { workspace, query: 1 },
    { workspace, query: "a", limit: 5000 },
  ]) {
    await refusedWith(page, "files.find", payload, "invalid-request");
  }
  for (const elsewhere of [
    { projectId: randomUUID(), workspace: "main" },
    { projectId, workspace: randomUUID() },
  ]) {
    await refusedWith(page, "files.list", { workspace: elsewhere, folders: [""] }, "not-found");
    await refusedWith(
      page,
      "files.read",
      { workspace: elsewhere, path: "README.md", known: null },
      "not-found",
    );
    await refusedWith(page, "files.find", { workspace: elsewhere, query: "readme" }, "not-found");
  }
}

async function checkFilesAnswers(page: Page, projectId: string): Promise<void> {
  const workspace = { projectId, workspace: "main" };
  const listings = await okValue(
    page,
    "files.list",
    { workspace, folders: [...refusedFilePaths.slice(0, 6), "link-out", ""] },
    z.object({
      folders: z.array(z.object({ path: z.string(), listing: z.object({ state: z.string() }) })),
    }),
  );
  for (const { path, listing } of listings.folders.slice(0, -1)) {
    assert.equal(listing.state, "unreadable", `files.list of ${path} answered ${listing.state}`);
  }
  for (const path of refusedFilePaths) {
    const refused = await okValue(
      page,
      "files.read",
      { workspace, path, known: null },
      z.object({ kind: z.string() }),
    );
    assert.equal(refused.kind, "unreadable", `files.read of ${path} answered ${refused.kind}`);
  }
  const root = await okValue(
    page,
    "files.list",
    { workspace, folders: ["", treeFolder, ""] },
    z.object({
      folders: z.array(
        z.object({
          path: z.string(),
          listing: z.object({
            state: z.literal("listed"),
            entries: z.array(z.object({ name: z.string(), ignored: z.boolean() })),
          }),
        }),
      ),
    }),
  );
  assert.deepEqual(
    root.folders.map(({ path }) => path),
    ["", treeFolder],
    "files.list did not answer each folder once in the order asked",
  );
  const entries = root.folders[0]?.listing.entries ?? [];
  const names = entries.map(({ name }) => name);
  assert.ok(!names.includes(".git"), "files.list listed .git");
  assert.ok(names.includes("README.md") && names.includes(treeFolder), "files.list missed entries");
  assert.equal(
    entries.find(({ name }) => name === ignoredFile)?.ignored,
    true,
    "files.list did not flag the ignored file",
  );
  const text = z.object({ kind: z.literal("text"), text: z.string(), stamp: z.string() });
  const ignored = await okValue(
    page,
    "files.read",
    { workspace, path: ignoredFile, known: null },
    text,
  );
  assert.equal(ignored.text, "ignored\n", "files.read did not read the ignored file");
  const read = await okValue(page, "files.read", { workspace, path: treeFile, known: null }, text);
  assert.equal(read.text, "inner\n", "files.read did not answer a listed text file");
  const same = await okValue(
    page,
    "files.read",
    { workspace, path: treeFile, known: read.stamp },
    z.object({ kind: z.literal("same") }),
  );
  assert.equal(same.kind, "same", "files.read of the same stamp did not answer same");
  const found = await okValue(
    page,
    "files.find",
    { workspace, query: "find-me" },
    z.object({ kind: z.literal("found"), paths: z.array(z.string()) }),
  );
  assert.deepEqual(found.paths, [findName], "files.find missed a name written into the folder");
  const hidden = await okValue(
    page,
    "files.find",
    { workspace, query: "secret" },
    z.object({ kind: z.literal("found"), paths: z.array(z.string()) }),
  );
  assert.deepEqual(
    hidden.paths,
    [],
    `files.find named ${JSON.stringify(hidden.paths)} for a name git ignores`,
  );
}

async function checkNestedRepository(page: Page, projectId: string): Promise<void> {
  const workspace = { projectId, workspace: "main" };
  const inside = await okValue(
    page,
    "files.list",
    { workspace, folders: [nestedFolder, `${nestedFolder}/.git`] },
    z.object({
      folders: z.array(z.object({ listing: z.object({ state: z.string() }).loose() })),
    }),
  );
  const [opened, hidden] = inside.folders;
  assert.equal(opened?.listing.state, "listed", "a nested repository did not open like a folder");
  assert.equal(
    JSON.stringify(opened).includes(".git"),
    false,
    "files.list listed a nested repository's .git",
  );
  assert.equal(hidden?.listing.state, "unreadable", "files.list opened a nested .git");
  const config = await okValue(
    page,
    "files.read",
    { workspace, path: `${nestedFolder}/.git/config`, known: null },
    z.object({ kind: z.string() }),
  );
  assert.equal(config.kind, "unreadable", `files.read of a nested .git answered ${config.kind}`);
}

async function checkFilesFlood(page: Page, workspace: unknown): Promise<void> {
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
        Array.from({ length: requests }, (_, index) => {
          if (index % 3 === 0)
            return ask("files.list", { workspace: target, folders: ["", "tree"] });
          if (index % 3 === 1) {
            return ask("files.read", { workspace: target, path: "README.md", known: null });
          }
          return ask("files.find", { workspace: target, query: "readme" });
        }),
      );
    },
    { target: workspace, requests: 300 },
  );
  const unexpected = codes.filter((code) => !["ok", "refused"].includes(code));
  assert.deepEqual(unexpected, [], `a flood of files requests answered ${unexpected.join(", ")}`);
  const after = await okValue(
    page,
    "files.read",
    { workspace, path: "README.md", known: null },
    z.object({ kind: z.literal("text") }),
  );
  assert.equal(after.kind, "text", "files.read no longer answered after a flood");
}

async function checkPullRequestRequests(session: AppSession, projectId: string): Promise<void> {
  const { page } = session;
  const workspace = { projectId, workspace: "main" };
  for (const payload of [
    { workspace, detail: "true" },
    { workspace },
    { workspace, detail: false, host: "github.com" },
    { workspace, detail: false, url: "https://github.com/o/r/pull/1" },
    { workspace: { projectId, workspace: "../main" }, detail: false },
  ]) {
    await refusedWith(page, "pullRequest.read", payload, "invalid-request");
  }
  for (const job of ["12a", "1".repeat(21), "-R", "", 12]) {
    await refusedWith(page, "pullRequest.log", { workspace, job }, "invalid-request");
  }
  await refusedWith(
    page,
    "pullRequest.log",
    { workspace, job: "1", repo: "o/r" },
    "invalid-request",
  );
  const elsewhere = { projectId: randomUUID(), workspace: "main" };
  await refusedWith(page, "pullRequest.read", { workspace: elsewhere, detail: false }, "not-found");
  await refusedWith(page, "pullRequest.log", { workspace: elsewhere, job: "1" }, "not-found");
  await refusedWith(page, "pullRequest.log", { workspace, job: "1" }, "not-found");
  const read = await okValue(
    page,
    "pullRequest.read",
    { workspace, detail: true },
    z.object({ kind: z.string() }),
  );
  assert.equal(
    read.kind,
    "absent",
    `pullRequest.read of an unpushed workspace answered ${read.kind}`,
  );
  const codes = await page.evaluate(
    async ({ target, requests }) => {
      const api: unknown = Reflect.get(window, "satellite");
      const invoke: unknown =
        typeof api === "object" && api !== null ? Reflect.get(api, "invoke") : undefined;
      if (typeof invoke !== "function") return ["window.satellite.invoke is missing"];
      return Promise.all(
        Array.from({ length: requests }, async () => {
          const answer: unknown = await Reflect.apply(invoke, api, [
            "pullRequest.read",
            { workspace: target, detail: true },
          ]);
          const error: unknown =
            typeof answer === "object" && answer !== null
              ? Reflect.get(answer, "error")
              : undefined;
          const code: unknown =
            typeof error === "object" && error !== null ? Reflect.get(error, "code") : "ok";
          return typeof code === "string" ? code : "unreadable";
        }),
      );
    },
    { target: workspace, requests: 300 },
  );
  const unexpected = codes.filter((code) => !["ok", "limit"].includes(code));
  assert.deepEqual(
    unexpected,
    [],
    `a flood of pull request reads answered ${unexpected.join(", ")}`,
  );
  const runs = (await session.standInEvents()).flatMap((event) =>
    event.type === "start" &&
    event.tool === "gh" &&
    ["pr", "api", "run"].includes(event.args[0] ?? "")
      ? [event]
      : [],
  );
  assert.deepEqual(
    runs.filter((event) => event.call === null || event.call === undefined),
    [],
    "gh was started with arguments no pull request call builds",
  );
  assert.ok(
    runs.length <= 2,
    `a flood of pull request reads started gh ${String(runs.length)} times`,
  );
}

async function checkFilesRequests(session: AppSession, projectId: string): Promise<void> {
  const { page, repo } = session;
  const link = join(repo, "link-out");
  const written = [
    join(repo, ".gitignore"),
    join(repo, ignoredFile),
    join(repo, treeFile),
    join(repo, findName),
    join(repo, nestedFolder, ".git", "config"),
    join(repo, nestedFolder, "n.txt"),
  ];
  await mkdir(join(repo, nestedFolder, ".git"), { recursive: true });
  await symlink(session.home, link, "junction");
  try {
    await writeFile(written[0] ?? "", `${ignoredFile}\n`);
    await writeFile(written[1] ?? "", "ignored\n");
    await writeFile(written[2] ?? "", "inner\n");
    await writeFile(written[3] ?? "", "found\n");
    await writeFile(written[4] ?? "", "[core]\n");
    await writeFile(written[5] ?? "", "nested\n");
    await checkFilesRefusals(page, projectId);
    await checkFilesAnswers(page, projectId);
    await checkNestedRepository(page, projectId);
    await checkFilesFlood(page, { projectId, workspace: "main" });
  } finally {
    for (const file of [...written, link]) await unlink(file).catch(() => undefined);
    for (const folder of [join(nestedFolder, ".git"), nestedFolder, treeFolder]) {
      await rmdir(join(repo, folder)).catch(() => undefined);
    }
  }
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

async function listening(server: Server | Socket): Promise<number> {
  await new Promise<void>((done) => {
    if (server instanceof Server) server.listen(0, "127.0.0.1", done);
    else server.bind(0, "127.0.0.1", done);
  });
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

async function checkWebRtc(page: Page): Promise<void> {
  let datagrams = 0;
  let connections = 0;
  const udp = createSocket("udp4").on("message", () => (datagrams += 1));
  const tcp = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  try {
    const ports = [await listening(udp), await listening(tcp)];
    await page.evaluate(async ([udpPort = 0, tcpPort = 0]) => {
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const isPeer = (value: unknown): value is typeof RTCPeerConnection =>
        typeof value === "function";
      const framed: unknown = Reflect.get(frame.contentWindow ?? window, "RTCPeerConnection");
      const kinds = [RTCPeerConnection, isPeer(framed) ? framed : RTCPeerConnection];
      for (const Peer of kinds) {
        const peer = new Peer({
          iceServers: [
            { urls: `stun:127.0.0.1:${String(udpPort)}` },
            {
              urls: `turn:127.0.0.1:${String(tcpPort)}?transport=tcp`,
              username: "satellite",
              credential: "satellite",
            },
          ],
        });
        peer.createDataChannel("probe");
        await peer.setLocalDescription(await peer.createOffer());
      }
      await new Promise((done) => setTimeout(done, 3000));
      frame.remove();
    }, ports);
    assert.equal(datagrams, 0, `WebRTC sent ${String(datagrams)} datagrams from the page`);
    assert.equal(connections, 0, `WebRTC opened ${String(connections)} connections from the page`);
  } finally {
    udp.close();
    tcp.close();
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
  await checkWebRtc(page);
  await checkPaths(page);
  await checkBridge(page);
  await checkPathForFile(page);
  await checkRelativeDrop(page);
  const projectId = await checkWorkspaceRequests(session);
  await checkChangesRequests(page, projectId, session.repo);
  await checkFilesRequests(session, projectId);
  await checkPullRequestRequests(session, projectId);
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
