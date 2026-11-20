import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StartChoice } from "../../shared/bridge-contract.ts";
import type { StoredWorkspace } from "../projects/projects-file.ts";
import { creationSteps, prepareWorkspace } from "./create-steps.ts";
import { runCreation, type StepReport } from "./workspace-creation.ts";

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
const onUnix = process.platform !== "win32";

let base = "";
let config = "";

function gitEnvironment(): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toUpperCase().startsWith("GIT_"),
  );
  return { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
}

async function git(folder: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", folder, ...args], { env: gitEnvironment() });
  return stdout.trim();
}

async function gitFails(folder: string, args: string[]): Promise<boolean> {
  return git(folder, args).then(
    () => false,
    () => true,
  );
}

async function commit(folder: string, file: string, text: string): Promise<string> {
  await writeFile(join(folder, file), text);
  await git(folder, ["add", "-A"]);
  await git(folder, ["commit", "-q", "-m", text.trim()]);
  return git(folder, ["rev-parse", "HEAD"]);
}

async function repository(name = "repo"): Promise<string> {
  const folder = join(base, name);
  await run("git", ["init", "-q", "-b", "main", folder], { env: gitEnvironment() });
  return folder;
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

async function hook(root: string, name: string, script: string): Promise<void> {
  const path = join(root, ".git", "hooks", name);
  await writeFile(path, `#!/bin/sh\n${script}\n`);
  await chmod(path, 0o755);
}

async function create(
  root: string,
  name: string,
  start: StartChoice = { kind: "default" },
  signal: AbortSignal = new AbortController().signal,
) {
  const home = join(base, "home");
  await mkdir(home, { recursive: true });
  const saved: StoredWorkspace[] = [];
  const reports: StepReport[] = [];
  const steps = creationSteps({
    home,
    root,
    project: "repo",
    name,
    start,
    signal,
    save: (workspace) => {
      saved.push(workspace);
      return Promise.resolve();
    },
  });
  const result = await runCreation(steps, (event) => reports.push(event));
  const path = join(home, "worktrees", "repo", name);
  const detail = (step: string) =>
    reports.find((event) => event.step === step && event.state === "done")?.detail;
  return { result, reports, saved, path, detail };
}

async function leftNothing(root: string, name: string, path: string): Promise<void> {
  expect(await gitFails(root, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])).toBe(
    true,
  );
  expect(await git(root, ["worktree", "list", "--porcelain"])).not.toContain(path);
  expect(await exists(path)).toBe(false);
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "satellite-create-")));
  config = join(base, "gitconfig");
  await writeFile(
    config,
    "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n[init]\n\tdefaultBranch = main\n",
  );
  vi.stubEnv("GIT_CONFIG_GLOBAL", config);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("creationSteps", () => {
  it("makes the workspace from the latest default branch on the remote", async () => {
    const upstream = await repository("upstream");
    await commit(upstream, "a", "first commit\n");
    const root = join(base, "repo");
    await run("git", ["clone", "-q", upstream, root], { env: gitEnvironment() });
    const second = await commit(upstream, "b", "second commit\n");
    const { result, saved, path, detail } = await create(root, "fix-login");
    expect(result).toEqual({ ok: true });
    expect(detail("start")).toBe("Fetched main from origin.");
    expect(await git(path, ["rev-parse", "HEAD"])).toBe(second);
    expect(await git(path, ["branch", "--show-current"])).toBe("fix-login");
    expect(await gitFails(root, ["rev-parse", "--abbrev-ref", "fix-login@{upstream}"])).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: "fix-login", path, branch: "fix-login" });
    if (onUnix) expect((await lstat(path)).mode & 0o777).toBe(0o700);
  });

  it("starts from a chosen branch", async () => {
    const root = await repository();
    const first = await commit(root, "a", "first commit\n");
    await git(root, ["branch", "release"]);
    await commit(root, "b", "second commit\n");
    const { result, path, detail } = await create(root, "hotfix", {
      kind: "ref",
      ref: "refs/heads/release",
    });
    expect(result).toEqual({ ok: true });
    expect(detail("start")).toBe("Starts from release.");
    expect(await git(path, ["rev-parse", "HEAD"])).toBe(first);
  });

  it("starts from the main folder with no remote and says so", async () => {
    const root = await repository();
    const first = await commit(root, "a", "first commit\n");
    const { result, path, detail } = await create(root, "solo");
    expect(result).toEqual({ ok: true });
    expect(detail("start")).toBe("repo has no remote, so it starts from main.");
    expect(await git(path, ["rev-parse", "HEAD"])).toBe(first);
  });

  it("copies only ignored files .worktreeinclude names", async () => {
    const root = await repository();
    await writeFile(
      join(root, ".gitignore"),
      ".env\nconfig/*.local.json\nnotes.log\nnode_modules/\n",
    );
    await writeFile(
      join(root, ".worktreeinclude"),
      ".env\nconfig/dev.local.json\nscratch.txt\nnotes.txt\n",
    );
    await commit(root, "a", "first commit\n");
    await mkdir(join(root, "config"));
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, ".env"), "TOKEN=1\n");
    await writeFile(join(root, "config", "dev.local.json"), "{}\n");
    await writeFile(join(root, "notes.log"), "noise\n");
    await writeFile(join(root, "node_modules", "pkg", ".env"), "DEP=1\n");
    await writeFile(join(root, "scratch.txt"), "draft\n");
    const { result, path, detail } = await create(root, "with-files");
    expect(result).toEqual({ ok: true });
    expect(detail("files")).toBe("Copied 2 files.");
    expect(await readFile(join(path, ".env"), "utf8")).toBe("TOKEN=1\n");
    expect(await readFile(join(path, "config", "dev.local.json"), "utf8")).toBe("{}\n");
    for (const absent of ["notes.log", "node_modules", "scratch.txt"]) {
      expect(await exists(join(path, absent))).toBe(false);
    }
  });

  it.skipIf(!onUnix)("refuses a .worktreeinclude that is a link and undoes", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    const outside = join(base, "outside-include");
    await writeFile(outside, ".env\n");
    await symlink(outside, join(root, ".worktreeinclude"));
    const { result, path } = await create(root, "linked");
    expect(result).toEqual({
      ok: false,
      step: "files",
      sentence:
        ".worktreeinclude isn't a plain file of at most 64 KiB, so Satellite won't read it.",
      undone: true,
    });
    await leftNothing(root, "linked", path);
  });

  it.skipIf(!onUnix)("undoes the branch and the worktree when a hook fails", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    await hook(root, "post-checkout", "exit 1");
    const { result, reports, saved, path } = await create(root, "broken");
    expect(result).toEqual({
      ok: false,
      step: "worktree",
      sentence: "git couldn't check out the worktree, or one of the repository's hooks failed.",
      undone: true,
    });
    expect(reports.filter((event) => event.state === "undone").map((event) => event.step)).toEqual([
      "worktree",
      "branch",
    ]);
    expect(saved).toEqual([]);
    await leftNothing(root, "broken", path);
  });

  it("never deletes a branch that already existed", async () => {
    const root = await repository();
    const first = await commit(root, "a", "first commit\n");
    await git(root, ["branch", "taken"]);
    await commit(root, "b", "second commit\n");
    const { result, path } = await create(root, "taken");
    expect(result).toEqual({
      ok: false,
      step: "branch",
      sentence: "A branch named taken already exists in repo. Pick another name.",
      undone: true,
    });
    expect(await git(root, ["rev-parse", "refs/heads/taken"])).toBe(first);
    expect(await exists(path)).toBe(false);
  });

  it("refuses a name that differs only by case from a packed branch", async () => {
    const root = await repository();
    const first = await commit(root, "a", "first commit\n");
    await git(root, ["branch", "Fix"]);
    await git(root, ["branch", "Login/form"]);
    await git(root, ["pack-refs", "--all"]);
    await commit(root, "b", "second commit\n");
    for (const [name, clash] of [
      ["fix", "Fix"],
      ["login", "Login/form"],
    ] as const) {
      const { result, path } = await create(root, name);
      expect(result).toEqual({
        ok: false,
        step: "branch",
        sentence: `repo already has a branch named ${clash}, which git can't keep next to ${name} on every system. Pick another name.`,
        undone: true,
      });
      expect(await exists(path)).toBe(false);
    }
    expect(await git(root, ["rev-parse", "refs/heads/Fix"])).toBe(first);
    expect(await git(root, ["for-each-ref", "--format=%(refname)", "refs/heads/"])).toBe(
      "refs/heads/Fix\nrefs/heads/Login/form\nrefs/heads/main",
    );
  });

  it.skipIf(!onUnix)("never deletes a branch that moved since it was made", async () => {
    const root = await repository();
    const first = await commit(root, "a", "first commit\n");
    await commit(root, "b", "second commit\n");
    await hook(
      root,
      "post-checkout",
      `git -C '${root}' update-ref refs/heads/moved ${first}; exit 1`,
    );
    const { result, path } = await create(root, "moved");
    expect(result).toMatchObject({ ok: false, step: "worktree", undone: false });
    expect(await git(root, ["rev-parse", "refs/heads/moved"])).toBe(first);
    expect(await exists(path)).toBe(false);
  });

  it.skipIf(!onUnix)(
    "keeps a folder that appears mid-way and still removes the branch",
    async () => {
      const root = await repository();
      await commit(root, "a", "first commit\n");
      const target = join(base, "home", "worktrees", "repo", "racing");
      await hook(
        root,
        "reference-transaction",
        `mkdir -p '${target}' && echo keep > '${target}/keep.txt'`,
      );
      const { result } = await create(root, "racing");
      expect(result).toEqual({
        ok: false,
        step: "worktree",
        sentence:
          "A folder named racing is already in Satellite's worktrees for repo. Pick another name.",
        undone: true,
      });
      expect(await readFile(join(target, "keep.txt"), "utf8")).toBe("keep\n");
      expect(await gitFails(root, ["show-ref", "--verify", "--quiet", "refs/heads/racing"])).toBe(
        true,
      );
    },
  );

  it("starts from the cached copy when the remote is unreachable", async () => {
    const upstream = await repository("upstream");
    const first = await commit(upstream, "a", "first commit\n");
    const root = join(base, "repo");
    await run("git", ["clone", "-q", upstream, root], { env: gitEnvironment() });
    await git(root, ["remote", "set-url", "origin", join(base, "missing")]);
    const { result, path, detail } = await create(root, "offline");
    expect(result).toEqual({ ok: true });
    expect(detail("start")).toBe(
      "Couldn't reach origin, so it starts from origin/main as last fetched.",
    );
    expect(await git(path, ["rev-parse", "HEAD"])).toBe(first);
  });

  it("stops with a sentence when the remote is unreachable and nothing was fetched", async () => {
    const upstream = await repository("upstream");
    await commit(upstream, "a", "first commit\n");
    const root = join(base, "repo");
    await run("git", ["clone", "-q", upstream, root], { env: gitEnvironment() });
    await git(root, ["remote", "set-url", "origin", join(base, "missing")]);
    await git(root, ["update-ref", "-d", "refs/remotes/origin/main"]);
    const { result } = await create(root, "nothing");
    expect(result).toEqual({
      ok: false,
      step: "start",
      sentence:
        "Satellite couldn't reach origin and has no copy of main yet. Connect, or start from a branch you have.",
      undone: true,
    });
  });

  it("points to a credential helper when the remote asks for a password", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="satellite"' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      const port = address.port;
      const upstream = await repository("upstream");
      await commit(upstream, "a", "first commit\n");
      const root = join(base, "repo");
      await run("git", ["clone", "-q", upstream, root], { env: gitEnvironment() });
      await git(root, ["remote", "set-url", "origin", `http://127.0.0.1:${String(port)}/repo.git`]);
      const started = Date.now();
      const { result, detail } = await create(root, "signed-out");
      expect(result).toEqual({ ok: true });
      expect(detail("start")).toBe(
        "Couldn't sign in to origin, so it starts from origin/main as last fetched. Set up a credential helper or an ssh agent to fetch.",
      );
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      server.close();
    }
  });

  it("refuses an empty repository", async () => {
    const root = await repository();
    const { result, path } = await create(root, "empty");
    expect(result).toEqual({
      ok: false,
      step: "start",
      sentence: "repo has no commits yet. Make a first commit, then make a workspace.",
      undone: true,
    });
    expect(await exists(path)).toBe(false);
  });

  it.skipIf(!onUnix)("undoes everything when the app quits mid-checkout", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    const mark = join(base, "hook-started");
    await hook(
      root,
      "post-checkout",
      `git worktree lock --reason satellite-test "$PWD" >/dev/null 2>&1; touch '${mark}'; sleep 30`,
    );
    const quitting = new AbortController();
    const started = Date.now();
    const creation = create(root, "quitting", { kind: "default" }, quitting.signal);
    while (!(await exists(mark))) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await git(root, ["worktree", "list", "--porcelain"])).toContain("locked");
    quitting.abort();
    const { result, path } = await creation;
    expect(result).toEqual({
      ok: false,
      step: "worktree",
      sentence: "Satellite stopped making the workspace because it is quitting.",
      undone: true,
    });
    expect(Date.now() - started).toBeLessThan(15_000);
    await leftNothing(root, "quitting", path);
  });
});

describe("prepareWorkspace", () => {
  it("suggests a free name, reads the cached default and lists start points without HEAD", async () => {
    const upstream = await repository("upstream");
    await commit(upstream, "a", "first commit\n");
    await git(upstream, ["branch", "release"]);
    const root = join(base, "repo");
    await run("git", ["clone", "-q", upstream, root], { env: gitEnvironment() });
    await git(root, ["branch", "bad..name"]).catch(() => undefined);
    const home = join(base, "home");
    const prepared = await prepareWorkspace(root, home);
    expect(prepared.name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(prepared.start).toEqual({ kind: "remote", remote: "origin", branch: "main" });
    expect(prepared.branches.map((branch) => branch.ref).sort()).toEqual([
      "refs/heads/main",
      "refs/remotes/origin/main",
      "refs/remotes/origin/release",
    ]);
    expect(
      prepared.branches.find((branch) => branch.ref === "refs/remotes/origin/release")?.label,
    ).toBe("origin/release");
    const empty = await repository("empty");
    expect((await prepareWorkspace(empty, home)).start).toEqual({ kind: "empty" });
    await commit(empty, "a", "first commit\n");
    expect((await prepareWorkspace(empty, home)).start).toEqual({ kind: "local", branch: "main" });
  });
});
