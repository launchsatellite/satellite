import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeOwner } from "../bridge/registry.ts";
import type { Needing } from "../inbox/notices.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { logArguments, threadsArguments, viewArguments } from "./gh-arguments.ts";
import { createPullRequests } from "./pull-request-reads.ts";

vi.mock("../platform/user-environment.ts", () => ({
  userEnvironment: () =>
    Promise.resolve(
      Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    ),
}));

const run = promisify(execFile);
const recorded = z.strictObject({ args: z.array(z.string()), cwd: z.string() });
const emitted = vi.fn<BridgeOwner["emit"]>();
const owner: BridgeOwner = { id: 1, emit: emitted, onGone: () => undefined };
const headOid = "a".repeat(40);
const jobAddress = "https://github.com/example-org/verify-repo/actions/runs/1001/job/2001";
const place = { host: "github.com", owner: "example-org", repo: "verify-repo", number: 12 };
const script = `
const { appendFileSync, existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const dir = process.argv[2];
const args = process.argv.slice(3);
appendFileSync(join(dir, "calls.jsonl"), JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
const numbered = args[0] === "pr" && /^[0-9]+$/.test(args[2]);
const name = numbered ? "view-" + args[2] : { pr: "view", api: args[1] === "graphql" ? "threads" : "log" }[args[0]];
const file = join(dir, name + ".json");
const answer = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { exitCode: 1, stderr: "boom" };
process.stdout.write(answer.stdout ?? "");
process.stderr.write(answer.stderr ?? "");
process.exitCode = answer.exitCode ?? 0;
`;

interface Check {
  conclusion: string;
}

function viewJson(
  checks: Check[] = [],
  head = "main",
  crossRepository = false,
  base = "trunk",
  number = 12,
) {
  return JSON.stringify({
    number,
    url: `https://github.com/example-org/verify-repo/pull/${String(number)}`,
    title: "Add a thing",
    state: "OPEN",
    isDraft: false,
    baseRefName: base,
    headRefName: head,
    headRefOid: headOid,
    isCrossRepository: crossRepository,
    body: "Body",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "",
    changedFiles: 1,
    reviews: [],
    checks: checks.map(({ conclusion }) => ({
      name: "build",
      workflow: "ci",
      status: "COMPLETED",
      conclusion,
      url: jobAddress,
      startedAt: "2026-01-01T00:00:00Z",
    })),
    commits: [],
  });
}

const owned = [{ number: 12, state: "OPEN", authorAssociation: "OWNER" }];

function threadsJson(nodes: object[] = owned, viewer = "verify-owner") {
  return JSON.stringify({
    data: {
      viewer: { login: viewer },
      repository: {
        pullRequests: { nodes },
        pullRequest: {
          reviews: { totalCount: 0, nodes: [] },
          comments: { totalCount: 0, nodes: [] },
          reviewThreads: { totalCount: 0, nodes: [] },
        },
      },
    },
  });
}

function inRepo(repo: string, ...args: string[]) {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  return run("git", ["-C", repo, ...args], { env: Object.fromEntries(kept) });
}

async function repository(base: string, name: string, push: boolean) {
  const repo = join(base, name);
  const remote = join(base, `${name}.git`);
  const config = join(base, "gitconfig");
  await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  const env = { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
  await run("git", ["init", "-q", "--bare", "-b", "main", remote], { env });
  await run("git", ["init", "-q", "-b", "main", repo], { env });
  const git = (...args: string[]) => run("git", ["-C", repo, ...args], { env });
  await git("commit", "-q", "--allow-empty", "-m", "one");
  await git("remote", "add", "origin", remote);
  if (push) await git("push", "-q", "-u", "origin", "main");
  return repo;
}

function storeOf(projects: { id: string; path: string }[]): ProjectStore {
  const find = (id: string) => {
    const found = projects.find((project) => project.id === id);
    if (found === undefined) {
      throw new BridgeFailure("not-found", "That project is not in Satellite.");
    }
    return Promise.resolve({ ...found, workspaces: [] });
  };
  return {
    list: () => Promise.all(projects.map(({ id }) => find(id))),
    project: find,
    available: () => Promise.resolve(true),
    addWorkspace: () => Promise.resolve(),
    writable: () => Promise.resolve(true),
    removeWorkspace: () => Promise.resolve(),
    busy: new Set(),
    creating: new Set(),
  };
}

const firstId = "0b9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e";
const secondId = "1c9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e";
const first: WorkspaceRef = { projectId: firstId, workspace: "main" };
const second: WorkspaceRef = { projectId: secondId, workspace: "main" };

async function setup(options: { push?: boolean } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-pr-")));
  const dir = join(base, "gh");
  await mkdir(dir);
  const file = join(dir, "gh.cjs");
  await writeFile(file, script);
  await writeFile(join(dir, "threads.json"), JSON.stringify({ stdout: threadsJson() }));
  process.env["SATELLITE_GH"] = JSON.stringify([process.execPath, file, dir]);
  const repo = await repository(base, "one", options.push ?? true);
  const other = await repository(base, "two", true);
  let time = 1_000_000;
  const needing = vi.fn<(list: readonly Needing[]) => void>();
  const reads = createPullRequests({
    home: base,
    store: storeOf([
      { id: firstId, path: repo },
      { id: secondId, path: other },
    ]),
    onNeeding: needing,
    now: () => time,
    after: () => Promise.resolve(),
  });
  const answer = (name: "view" | `view-${number}` | "threads" | "log", body: object) =>
    writeFile(join(dir, `${name}.json`), JSON.stringify(body));
  const calls = async () => {
    const text = await readFile(join(dir, "calls.jsonl"), "utf8").catch(() => "");
    return text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => recorded.parse(JSON.parse(line)));
  };
  const read = (workspace: WorkspaceRef, detail = false, fresh = false) =>
    reads.handlers["pullRequest.read"]({ workspace, detail, fresh }, owner);
  return {
    reads,
    repo,
    other,
    needing,
    answer,
    calls,
    read,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("pull request reads", { timeout: 30_000 }, () => {
  beforeEach(() => {
    delete process.env["SATELLITE_GH"];
  });
  afterEach(() => {
    delete process.env["SATELLITE_GH"];
  });

  it("runs gh from the workspace folder with exactly the view arguments", async () => {
    const { answer, read, calls, repo } = await setup();
    await answer("view", { stdout: viewJson() });
    const result = await read(first);
    expect(result).toMatchObject({ kind: "found", number: 12, detail: null });
    expect(await calls()).toEqual([
      { args: viewArguments(), cwd: repo },
      { args: threadsArguments(place, "main", false), cwd: repo },
    ]);
  });

  it("asks for threads only with detail and names the host of the pull request", async () => {
    const { answer, read, calls, advance } = await setup();
    await answer("view", { stdout: viewJson() });
    await answer("threads", { stdout: threadsJson() });
    await read(first);
    expect((await calls()).map(({ args }) => args[0])).toEqual(["pr", "api"]);
    advance(10_000);
    const result = await read(first, true);
    expect(result).toMatchObject({ kind: "found", detail: { kind: "read" } });
    const made = await calls();
    expect(made).toHaveLength(4);
    expect(made[3]?.args).toEqual(threadsArguments(place, "main", true));
  });

  it("shows no pull request whose head branch is not the workspace branch", async () => {
    const { answer, read } = await setup();
    await answer("view", { stdout: viewJson([], "topic") });
    expect(await read(first)).toEqual({ kind: "absent", reason: "none" });
  });

  it("shows a pull request whose head is the branch its upstream names", async () => {
    const { answer, read, repo } = await setup();
    await inRepo(repo, "checkout", "-q", "-b", "fix");
    await inRepo(repo, "config", "branch.fix.remote", "origin");
    await inRepo(repo, "config", "branch.fix.merge", "refs/heads/topic");
    await answer("view", { stdout: viewJson([], "topic") });
    expect(await read(first)).toMatchObject({ kind: "found", number: 12 });
  });

  it("shows no pull request from another repository's same-named branch", async () => {
    const { answer, read, repo } = await setup();
    await inRepo(repo, "checkout", "-q", "-b", "fix");
    await inRepo(repo, "config", "branch.fix.remote", "origin");
    await inRepo(repo, "config", "branch.fix.merge", "refs/heads/topic");
    await answer("view", { stdout: viewJson([], "fix", true) });
    expect(await read(first)).toEqual({ kind: "absent", reason: "none" });
  });

  it("shows the viewer's own pull request from their fork, whatever their standing upstream", async () => {
    const { answer, read, repo } = await setup();
    await inRepo(repo, "checkout", "-q", "-b", "fix");
    await inRepo(repo, "config", "remote.fork.url", "git@github.com:fork-owner/verify-repo.git");
    await inRepo(repo, "config", "branch.fix.remote", "fork");
    await inRepo(repo, "config", "branch.fix.merge", "refs/heads/topic");
    await answer("view", { stdout: viewJson([], "topic", true) });
    const fromFork = (login: string) => [
      { number: 12, state: "OPEN", authorAssociation: "CONTRIBUTOR", author: { login } },
    ];
    await answer("threads", { stdout: threadsJson(fromFork("fork-owner"), "fork-owner") });
    expect(await read(first)).toMatchObject({ kind: "found", number: 12 });
    await answer("threads", { stdout: threadsJson(fromFork("stranger"), "fork-owner") });
    expect(await read(first, true, true)).toEqual({ kind: "absent", reason: "none" });
  });

  it("shows no pull request from another repository when the upstream is the pull request's own repository", async () => {
    const { answer, read, repo } = await setup();
    await inRepo(repo, "checkout", "-q", "-b", "fix");
    await inRepo(
      repo,
      "config",
      "remote.origin.url",
      "https://github.com/example-org/verify-repo.git",
    );
    await inRepo(repo, "config", "branch.fix.remote", "origin");
    await inRepo(repo, "config", "branch.fix.merge", "refs/heads/topic");
    await answer("view", { stdout: viewJson([], "topic", true) });
    expect(await read(first)).toEqual({ kind: "absent", reason: "none" });
  });

  it("shows no pull request from another repository when the upstream's repository is unknown", async () => {
    const { answer, read, repo } = await setup();
    await inRepo(repo, "checkout", "-q", "-b", "fix");
    await inRepo(repo, "config", "branch.fix.remote", "origin");
    await inRepo(repo, "config", "branch.fix.merge", "refs/heads/topic");
    await answer("view", { stdout: viewJson([], "topic", true) });
    expect(await read(first)).toEqual({ kind: "absent", reason: "none" });
  });

  it("shows no fork pull request on a branch that tracks the base repository's same-named branch", async () => {
    const { answer, read, repo } = await setup();
    await inRepo(
      repo,
      "config",
      "remote.origin.url",
      "https://github.com/example-org/verify-repo.git",
    );
    await answer("view", { stdout: viewJson([], "main", true, "main") });
    expect(await read(first)).toEqual({ kind: "absent", reason: "target" });
  });

  it("shows no pull request on its own base branch when the default branch cannot be read", async () => {
    const { answer, read } = await setup();
    await answer("view", { stdout: viewJson([], "main", false, "main") });
    expect(await read(first)).toEqual({ kind: "absent", reason: "target" });
  });

  it("never shows a pull request for the repository's default branch", async () => {
    const { answer, read, repo } = await setup();
    await inRepo(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await answer("view", { stdout: viewJson() });
    expect(await read(first)).toEqual({ kind: "absent", reason: "target" });
  });

  it("never runs gh on the default branch", async () => {
    const { answer, read, calls, repo } = await setup();
    await inRepo(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await answer("view", { stdout: viewJson() });
    expect(await read(first)).toEqual({ kind: "absent", reason: "target" });
    expect(await calls()).toEqual([]);
  });

  it("never runs gh for a branch that is not pushed", async () => {
    const { answer, read, calls } = await setup({ push: false });
    await answer("view", { stdout: viewJson() });
    expect(await read(first)).toEqual({ kind: "absent", reason: "not-pushed" });
    expect(await calls()).toEqual([]);
  });

  it("reuses an answer for ten seconds and asks who opened a pull request only once", async () => {
    const { answer, read, calls, advance } = await setup();
    await answer("view", { stdout: viewJson() });
    await read(first);
    advance(9_999);
    await read(first);
    expect(await calls()).toHaveLength(2);
    advance(1);
    await read(first);
    expect(await calls()).toHaveLength(3);
  });

  it("reuses a failed answer for a detail read within ten seconds", async () => {
    const { answer, read, calls, advance } = await setup();
    await answer("view", {
      exitCode: 4,
      stderr: "To get started with GitHub CLI, please run:  gh auth login",
    });
    expect(await read(first)).toMatchObject({ kind: "unavailable" });
    advance(5_000);
    expect(await read(first, true)).toMatchObject({ kind: "unavailable" });
    expect(await calls()).toHaveLength(1);
  });

  it("never answers a fresh read from a held absent answer", async () => {
    const { answer, read, calls, advance } = await setup();
    await answer("view", { exitCode: 1, stderr: 'no pull requests found for branch "main"' });
    expect(await read(first)).toEqual({ kind: "absent", reason: "none" });
    advance(2_000);
    await answer("view", { stdout: viewJson() });
    expect(await read(first, false, false)).toEqual({ kind: "absent", reason: "none" });
    expect(await read(first, false, true)).toMatchObject({ kind: "found", number: 12 });
    expect(await calls()).toHaveLength(3);
  });

  it("never answers a fresh read from a held pull request", async () => {
    const { answer, read, calls, advance } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    expect(await read(first)).toMatchObject({ counts: { failed: 1 } });
    advance(2_000);
    await answer("view", { stdout: viewJson([{ conclusion: "SUCCESS" }]) });
    expect(await read(first)).toMatchObject({ counts: { failed: 1 } });
    expect(await read(first, false, true)).toMatchObject({ counts: { failed: 0 } });
    expect(await calls()).toHaveLength(3);
  });

  it("answers a fresh read from a held signed out answer again", async () => {
    const { answer, read, calls, advance } = await setup();
    await answer("view", {
      exitCode: 4,
      stderr: "To get started with GitHub CLI, please run:  gh auth login",
    });
    await read(first);
    advance(2_000);
    await answer("view", { stdout: viewJson() });
    expect(await read(first, false, true)).toMatchObject({ kind: "found" });
    expect(await calls()).toHaveLength(3);
  });

  it("joins two reads of one workspace", async () => {
    const { answer, read, calls } = await setup();
    await answer("view", { stdout: viewJson() });
    const [one, two] = await Promise.all([read(first), read(first)]);
    expect(one).toEqual(two);
    expect(await calls()).toHaveLength(2);
  });

  it("holds a failed workspace for a minute and doubles it, and detail skips the hold", async () => {
    const { answer, read, calls, advance } = await setup();
    await answer("view", { exitCode: 1, stderr: "boom" });
    expect(await read(first)).toEqual({ kind: "unavailable", reason: "failed" });
    advance(59_999);
    expect(await read(first)).toEqual({ kind: "unavailable", reason: "failed" });
    expect(await calls()).toHaveLength(1);
    advance(1);
    await read(first);
    expect(await calls()).toHaveLength(2);
    advance(119_999);
    await read(first);
    expect(await calls()).toHaveLength(2);
    await read(first, true);
    expect(await calls()).toHaveLength(3);
    advance(240_000);
    await read(first);
    expect(await calls()).toHaveLength(4);
  });

  it("a rate limit pauses every workspace", async () => {
    const { answer, read, calls, advance } = await setup();
    await answer("view", { exitCode: 1, stderr: "API rate limit exceeded for user" });
    expect(await read(first)).toEqual({ kind: "unavailable", reason: "rate-limited" });
    expect(await read(second)).toEqual({ kind: "unavailable", reason: "rate-limited" });
    expect(await calls()).toHaveLength(1);
    advance(899_999);
    await read(second);
    expect(await calls()).toHaveLength(1);
    advance(1);
    await read(second);
    expect(await calls()).toHaveLength(2);
  });

  it("shows no pull request it could not check the author of", async () => {
    const { answer, read } = await setup();
    await answer("view", { stdout: viewJson() });
    await answer("threads", { exitCode: 1, stderr: "boom" });
    expect(await read(first, true)).toEqual({ kind: "unavailable", reason: "failed" });
    await answer("threads", { stdout: threadsJson([{ number: 12, state: "OPEN" }]) });
    expect(await read(first, true, true)).toEqual({ kind: "absent", reason: "none" });
  });

  it("shows the newest pull request opened by someone with write access, never a stranger's", async () => {
    const { answer, read, calls } = await setup();
    await answer("view", { stdout: viewJson([], "main", false, "trunk", 41) });
    await answer("view-12", { stdout: viewJson() });
    await answer("threads", {
      stdout: threadsJson([
        { number: 41, state: "OPEN", authorAssociation: "NONE" },
        { number: 40, state: "OPEN", authorAssociation: "CONTRIBUTOR" },
        { number: 12, state: "OPEN", authorAssociation: "COLLABORATOR" },
      ]),
    });
    expect(await read(first)).toMatchObject({ kind: "found", number: 12 });
    expect((await calls()).map(({ args }) => args.slice(0, 3))).toEqual([
      ["pr", "view", "--json"],
      ["api", "graphql", "--hostname"],
      ["pr", "view", "12"],
    ]);
  });

  it("prefers a pull request whose head is in this repository to a same-named fork's", async () => {
    const { answer, read } = await setup();
    await answer("view", { stdout: viewJson([], "main", false, "trunk", 41) });
    await answer("view-12", { stdout: viewJson() });
    await answer("threads", {
      stdout: threadsJson([
        { number: 41, state: "OPEN", authorAssociation: "NONE", isCrossRepository: false },
        { number: 42, state: "OPEN", authorAssociation: "OWNER", isCrossRepository: true },
        { number: 12, state: "OPEN", authorAssociation: "OWNER", isCrossRepository: false },
      ]),
    });
    expect(await read(first)).toMatchObject({ kind: "found", number: 12 });
  });

  it("prefers an open pull request of a writer to a merged one, and shows a merged one when none is open", async () => {
    const { answer, read } = await setup();
    await answer("view", { stdout: viewJson([], "main", false, "trunk", 41) });
    await answer("view-12", { stdout: viewJson() });
    await answer("view-11", { stdout: viewJson([], "main", false, "trunk", 11) });
    await answer("threads", {
      stdout: threadsJson([
        { number: 41, state: "OPEN", authorAssociation: "NONE" },
        { number: 40, state: "MERGED", authorAssociation: "OWNER" },
        { number: 12, state: "OPEN", authorAssociation: "MEMBER" },
      ]),
    });
    expect(await read(first)).toMatchObject({ number: 12 });
    await answer("threads", {
      stdout: threadsJson([
        { number: 41, state: "OPEN", authorAssociation: "NONE" },
        { number: 11, state: "CLOSED", authorAssociation: "OWNER" },
      ]),
    });
    expect(await read(first, false, true)).toMatchObject({ number: 11 });
  });

  it("shows no pull request when only strangers opened one for the branch", async () => {
    const { answer, read, needing } = await setup();
    await answer("view", {
      stdout: viewJson([{ conclusion: "FAILURE" }], "main", false, "trunk", 41),
    });
    await answer("threads", {
      stdout: threadsJson([{ number: 41, state: "OPEN", authorAssociation: "NONE" }]),
    });
    expect(await read(first)).toEqual({ kind: "absent", reason: "none" });
    expect(needing).not.toHaveBeenCalled();
  });

  it("reads the conversation of the pull request it shows when a stranger's is newer", async () => {
    const { answer, read, calls } = await setup();
    await answer("view", { stdout: viewJson([], "main", false, "trunk", 41) });
    await answer("view-12", { stdout: viewJson() });
    await answer("threads", {
      stdout: threadsJson([
        { number: 41, state: "OPEN", authorAssociation: "NONE" },
        { number: 12, state: "OPEN", authorAssociation: "OWNER" },
      ]),
    });
    expect(await read(first, true)).toMatchObject({
      number: 12,
      detail: { kind: "read" },
    });
    const made = await calls();
    expect(made.at(-1)?.args).toEqual(threadsArguments(place, "main", true));
  });

  it("reads a stale open pull request by itself so a failure reaches a hidden window", async () => {
    const { answer, read, reads, needing, calls, advance } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "SUCCESS" }]) });
    await read(first);
    const before = (await calls()).length;
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    advance(359_999);
    await reads.sweepStale();
    expect(await calls()).toHaveLength(before);
    expect(needing).not.toHaveBeenCalledWith([expect.anything()]);
    advance(1);
    await reads.sweepStale();
    expect(await calls()).toHaveLength(before + 1);
    expect(needing).toHaveBeenLastCalledWith([{ workspace: first, owner, reason: "pull-request" }]);
  });

  it("does not sweep a merged pull request", async () => {
    const { answer, read, reads, calls, advance } = await setup();
    await answer("view", { stdout: viewJson().replace('"state":"OPEN"', '"state":"MERGED"') });
    await read(first);
    const before = (await calls()).length;
    advance(400_000);
    await reads.sweepStale();
    expect(await calls()).toHaveLength(before);
  });

  it("tells needing when checks fail and again when they pass", async () => {
    const { answer, read, needing, advance } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    expect(needing).toHaveBeenLastCalledWith([{ workspace: first, owner, reason: "pull-request" }]);
    expect(emitted).toHaveBeenLastCalledWith("pullRequests.needing", {
      needing: [{ workspace: first, needs: ["checks"] }],
    });
    await answer("view", { stdout: viewJson([{ conclusion: "SUCCESS" }]) });
    advance(10_000);
    await read(first);
    expect(needing).toHaveBeenLastCalledWith([]);
    expect(needing).toHaveBeenCalledTimes(2);
    expect(emitted).toHaveBeenLastCalledWith("pullRequests.needing", { needing: [] });
  });

  it("keeps needing through an offline answer and drops it when signed out", async () => {
    const { answer, read, needing, advance } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    await answer("view", { exitCode: 1, stderr: "dial tcp: no such host" });
    advance(10_000);
    expect(await read(first)).toEqual({ kind: "unavailable", reason: "offline" });
    expect(needing).toHaveBeenCalledTimes(1);
    await answer("view", { exitCode: 4, stderr: "gh auth login" });
    expect(await read(first, true)).toEqual({ kind: "unavailable", reason: "signed-out" });
    expect(needing).toHaveBeenLastCalledWith([]);
  });

  it("keeps every workspace's needs through a rate limit a queued read meets", async () => {
    const { answer, read, needing, advance } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    await read(second);
    expect(needing).toHaveBeenCalledTimes(2);
    await answer("view", { exitCode: 1, stderr: "API rate limit exceeded for user" });
    advance(10_000);
    expect(await Promise.all([read(first), read(second)])).toEqual([
      { kind: "unavailable", reason: "rate-limited" },
      { kind: "unavailable", reason: "rate-limited" },
    ]);
    expect(needing).toHaveBeenCalledTimes(2);
  });

  it("keeps needing when the branch itself cannot be read", async () => {
    const { answer, read, needing, advance, repo } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    await writeFile(join(repo, ".git", "HEAD"), "not a ref\n");
    advance(10_000);
    expect(await read(first)).toEqual({ kind: "unavailable", reason: "failed" });
    expect(needing).toHaveBeenCalledTimes(1);
    await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    advance(60_000);
    await read(first);
    expect(needing).toHaveBeenCalledTimes(1);
  });

  it("lets the old branch's pull request go when a read fails after a branch switch", async () => {
    const { answer, read, needing, advance, repo } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    expect(needing).toHaveBeenLastCalledWith([{ workspace: first, owner, reason: "pull-request" }]);
    await inRepo(repo, "checkout", "-q", "-b", "other");
    await inRepo(repo, "config", "branch.other.remote", "origin");
    await inRepo(repo, "config", "branch.other.merge", "refs/heads/other");
    await answer("view", { exitCode: 1, stderr: "dial tcp: no such host" });
    advance(10_000);
    expect(await read(first)).toEqual({ kind: "unavailable", reason: "offline" });
    expect(needing).toHaveBeenLastCalledWith([]);
  });

  it("forgets a workspace when it is archived", async () => {
    const { answer, read, needing, reads, repo } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    await reads.stopInside(repo);
    expect(needing).toHaveBeenLastCalledWith([]);
  });

  it("refuses a log for a job that is not on the pull request", async () => {
    const { answer, read, reads } = await setup();
    const log = reads.handlers["pullRequest.log"];
    await expect(log({ workspace: first, job: "2001" }, owner)).rejects.toMatchObject({
      code: "not-found",
    });
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    await answer("log", {
      stdout: "2026-01-01T00:00:00.0000000Z ##[error]It broke\n",
    });
    expect(await log({ workspace: first, job: "2001" }, owner)).toEqual({
      kind: "lines",
      lines: ["It broke"],
      more: false,
    });
    await expect(log({ workspace: first, job: "2002" }, owner)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(log({ workspace: second, job: "2001" }, owner)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("says a log past the output bound is too large, not slow", async () => {
    const { answer, read, reads } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    await answer("log", { stdout: "x".repeat(17 * 1024 * 1024) });
    expect(
      await reads.handlers["pullRequest.log"]({ workspace: first, job: "2001" }, owner),
    ).toEqual({ kind: "too-large" });
  });

  it("reads one job's log with a plain api request that writes nothing", async () => {
    const { answer, read, reads, calls } = await setup();
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    await answer("log", { stdout: "2026-01-01T00:00:00.0000000Z ##[error]Oops\n" });
    await reads.handlers["pullRequest.log"]({ workspace: first, job: "2001" }, owner);
    const made = await calls();
    expect(made.at(-1)?.args).toEqual(logArguments(place, "2001"));
    expect(made.some(({ args }) => args[0] === "run")).toBe(false);
  });

  it("joins identical log requests and reuses the answer for ten seconds", async () => {
    const { answer, read, reads, calls, advance } = await setup();
    const log = () => reads.handlers["pullRequest.log"]({ workspace: first, job: "2001" }, owner);
    await answer("view", { stdout: viewJson([{ conclusion: "FAILURE" }]) });
    await read(first);
    await answer("log", { stdout: "2026-01-01T00:00:00.0000000Z ##[error]Oops\n" });
    const flood = await Promise.all(Array.from({ length: 50 }, log));
    expect(new Set(flood.map((got) => JSON.stringify(got))).size).toBe(1);
    await log();
    const logRuns = async () =>
      (await calls()).filter(({ args }) => args[0] === "api" && args[1] !== "graphql").length;
    expect(await logRuns()).toBe(1);
    advance(11_000);
    await log();
    expect(await logRuns()).toBe(2);
  });

  it("answers not-found for a workspace that is not on record", async () => {
    const { reads } = await setup();
    const strangers = [
      { projectId: firstId, workspace: "5f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6" },
      { projectId: "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6", workspace: "main" },
    ];
    for (const workspace of strangers) {
      await expect(
        reads.handlers["pullRequest.read"]({ workspace, detail: false }, owner),
      ).rejects.toMatchObject({ code: "not-found" });
      await expect(
        reads.handlers["pullRequest.log"]({ workspace, job: "1" }, owner),
      ).rejects.toMatchObject({ code: "not-found" });
    }
  });
});
