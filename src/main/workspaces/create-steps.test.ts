import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StartChoice } from "../../shared/bridge-contract.ts";
import type { StoredWorkspace } from "../projects/projects-file.ts";
import { BridgeFailure } from "../bridge/registry.ts";
import * as ignoreCheck from "../files/ignore-check.ts";
import { creationSteps, prepareWorkspace } from "./create-steps.ts";
import { runGit } from "./git-command.ts";
import { runCreation, type StepReport } from "./workspace-creation.ts";

vi.mock("../files/ignore-check.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof ignoreCheck>();
  return { checkIgnored: vi.fn(actual.checkIgnored) };
});

vi.mock("./git-command.ts", async (original) => {
  const actual = await original<typeof import("./git-command.ts")>();
  return { ...actual, runGit: vi.fn(actual.runGit) };
});

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

function asGitPrints(path: string): string {
  return path.split(sep).join("/");
}

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
  failSave = false,
  beforeFailing?: (path: string) => Promise<void>,
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
    save: async (workspace) => {
      if (failSave) {
        await beforeFailing?.(workspace.path);
        throw new BridgeFailure("failed", "The disk said no.");
      }
      saved.push(workspace);
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
  expect(await git(root, ["worktree", "list", "--porcelain"])).not.toContain(asGitPrints(path));
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

describe("creationSteps", { timeout: 30_000 }, () => {
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

  it("follows the remote's default branch after it was renamed", async () => {
    const upstream = join(base, "upstream");
    await run("git", ["init", "-q", "-b", "master", upstream], { env: gitEnvironment() });
    await commit(upstream, "a", "first commit\n");
    const root = join(base, "repo");
    await run("git", ["clone", "-q", upstream, root], { env: gitEnvironment() });
    await git(upstream, ["branch", "-m", "master", "main"]);
    const latest = await commit(upstream, "b", "second commit\n");
    const { result, path, detail } = await create(root, "renamed");
    expect(result).toEqual({ ok: true });
    expect(detail("start")).toBe("origin's default branch is main now, so it fetched main.");
    expect(await git(path, ["rev-parse", "HEAD"])).toBe(latest);
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

  it("says so when several remotes have none named origin", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    await git(root, ["remote", "add", "upstream", join(base, "nowhere")]);
    await git(root, ["remote", "add", "fork", join(base, "elsewhere")]);
    const { result, detail } = await create(root, "several");
    expect(result).toEqual({ ok: true });
    expect(detail("start")).toBe(
      "repo has several remotes and none is origin, so it starts from main.",
    );
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

  it("leaves out a file the new worktree does not ignore, so git never sees it as new", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    await git(root, ["branch", "old"]);
    await writeFile(join(root, ".gitignore"), "secret.local\n.env\n");
    await writeFile(join(root, ".worktreeinclude"), "secret.local\n.env\n");
    await commit(root, "b", "second commit\n");
    await writeFile(join(root, "secret.local"), "TOKEN=1\n");
    await writeFile(join(root, ".env"), "KEY=1\n");
    const { result, path, detail } = await create(root, "from-old", {
      kind: "ref",
      ref: "refs/heads/old",
    });
    expect(result).toEqual({ ok: true });
    expect(await exists(join(path, "secret.local"))).toBe(false);
    expect(await exists(join(path, ".env"))).toBe(false);
    expect(await git(path, ["status", "--porcelain"])).toBe("");
    expect(detail("files")).toBe(
      "Copied 0 files. Left out 2 that this workspace's branch doesn't ignore, so git could commit them, .env and secret.local.",
    );
  });

  it.skipIf(!onUnix)(
    "leaves out a path git cannot check behind a link of the new branch and copies the rest",
    async () => {
      const root = await repository();
      await writeFile(join(root, ".gitignore"), ".env\nconfig/*.local.json\n");
      await writeFile(join(root, ".worktreeinclude"), ".env\nconfig/dev.local.json\n");
      await commit(root, "a", "first commit\n");
      await git(root, ["checkout", "-q", "-b", "linked"]);
      await symlink("elsewhere", join(root, "config"));
      await git(root, ["add", "config"]);
      await git(root, ["commit", "-q", "-m", "config is a link"]);
      await git(root, ["checkout", "-q", "main"]);
      await mkdir(join(root, "config"));
      await writeFile(join(root, "config", "dev.local.json"), "{}\n");
      await writeFile(join(root, ".env"), "TOKEN=1\n");
      const { result, path, detail } = await create(root, "behind-link", {
        kind: "ref",
        ref: "refs/heads/linked",
      });
      expect(result).toEqual({ ok: true });
      expect(await readFile(join(path, ".env"), "utf8")).toBe("TOKEN=1\n");
      expect(detail("files")).toBe(
        "Copied 1 file. Left out 1 that git wouldn't check in this workspace, because each sits behind a link or inside a submodule or was asked together with one, config/dev.local.json.",
      );
    },
  );

  it.skipIf(!onUnix)(
    "asks git a bounded number of times when many paths sit behind a link",
    async () => {
      const root = await repository();
      await writeFile(join(root, ".gitignore"), "config/\n");
      await writeFile(join(root, ".worktreeinclude"), "config/\n");
      await commit(root, "a", "first commit\n");
      await git(root, ["checkout", "-q", "-b", "linked"]);
      await symlink("elsewhere", join(root, "config"));
      await git(root, ["add", "config"]);
      await git(root, ["commit", "-q", "-m", "config is a link"]);
      await git(root, ["checkout", "-q", "main"]);
      await mkdir(join(root, "config"));
      for (let at = 0; at < 400; at += 1) {
        await writeFile(join(root, "config", `f${String(at)}.json`), "{}\n");
      }
      const asked = vi.mocked(ignoreCheck.checkIgnored);
      asked.mockClear();
      const { result, detail } = await create(root, "many-behind", {
        kind: "ref",
        ref: "refs/heads/linked",
      });
      const checks = asked.mock.calls.length;
      expect(result).toEqual({ ok: true });
      expect(checks).toBeLessThanOrEqual(20);
      expect(detail("files")).toMatch(
        /^Copied 0 files\. Left out 400 that git wouldn't check in this workspace, because each sits behind a link or inside a submodule or was asked together with one, /,
      );
    },
  );

  it("counts a file the new branch tracks as already in the checkout", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    await git(root, ["checkout", "-q", "-b", "tracks"]);
    await writeFile(join(root, "notes.local"), "tracked\n");
    await git(root, ["add", "notes.local"]);
    await git(root, ["commit", "-q", "-m", "track notes"]);
    await git(root, ["checkout", "-q", "main"]);
    await writeFile(join(root, ".gitignore"), "notes.local\n");
    await writeFile(join(root, ".worktreeinclude"), "notes.local\n");
    await commit(root, "b", "second commit\n");
    await writeFile(join(root, "notes.local"), "mine\n");
    const { result, path, detail } = await create(root, "tracking", {
      kind: "ref",
      ref: "refs/heads/tracks",
    });
    expect(result).toEqual({ ok: true });
    expect(await readFile(join(path, "notes.local"), "utf8")).toBe("tracked\n");
    expect(detail("files")).toBe(
      "Copied 0 files. Skipped 1 that were links or already in the checkout.",
    );
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
      left: null,
    });
    await leftNothing(root, "linked", path);
  });

  it.skipIf(!onUnix)("undoes the branch and the worktree when a hook fails", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    await hook(root, "post-checkout", "echo 'npm ERR! the network is down' >&2; exit 1");
    const { result, reports, saved, path } = await create(root, "broken");
    expect(
      reports.find((event) => event.step === "worktree" && event.state === "failed")?.detail,
    ).toContain("npm ERR! the network is down");
    expect(result).toEqual({
      ok: false,
      step: "worktree",
      sentence: "git couldn't check out the worktree, or one of the repository's hooks failed.",
      undone: true,
      left: null,
    });
    expect(reports.filter((event) => event.state === "undone").map((event) => event.step)).toEqual([
      "worktree",
      "branch",
    ]);
    expect(saved).toEqual([]);
    await leftNothing(root, "broken", path);
  });

  it("undoes a branch git made before its run ran out of time", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    const actual = await vi.importActual<typeof import("./git-command.ts")>("./git-command.ts");
    vi.mocked(runGit).mockImplementation(async (folder, args, ms, signal) => {
      const answer = await actual.runGit(folder, args, ms, signal);
      return args[0] === "branch" && args[1] === "--no-track" ? undefined : answer;
    });
    try {
      const { result, path } = await create(root, "slow");
      expect(result).toMatchObject({ ok: false, step: "branch", undone: true });
      await leftNothing(root, "slow", path);
    } finally {
      vi.mocked(runGit).mockImplementation(actual.runGit);
    }
  });

  it("removes a link made during creation before undoing it, never what it points to", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    const outside = join(base, "outside");
    await mkdir(join(outside, "src"), { recursive: true });
    await writeFile(join(outside, "src", "keep.md"), "Mine.\n");
    const { result, path } = await create(
      root,
      "linked",
      { kind: "default" },
      undefined,
      true,
      (folder) => symlink(outside, join(folder, "node_modules-link"), "junction"),
    );
    expect(result).toEqual({
      ok: false,
      step: "save",
      sentence: "Satellite couldn't save the workspace list.",
      undone: true,
      left: null,
    });
    await leftNothing(root, "linked", path);
    expect(await readFile(join(outside, "src", "keep.md"), "utf8")).toBe("Mine.\n");
  });

  it.skipIf(!onUnix)(
    "leaves the worktree and says where when a link inside it can't be removed",
    async () => {
      const root = await repository();
      await commit(root, "a", "first commit\n");
      const outside = join(base, "outside");
      await mkdir(outside);
      let held = "";
      const { result, path } = await create(
        root,
        "held",
        { kind: "default" },
        undefined,
        true,
        async (folder) => {
          held = join(folder, "held");
          await mkdir(held);
          await symlink(outside, join(held, "link"));
          await chmod(held, 0o500);
        },
      );
      try {
        expect(result).toEqual({
          ok: false,
          step: "save",
          sentence: "Satellite couldn't save the workspace list.",
          undone: false,
          left: "Satellite left the worktree in worktrees/repo/held in the Satellite home, because it couldn't remove the link held/link inside it. The branch held stays.",
        });
        expect(await git(root, ["worktree", "list", "--porcelain"])).toContain(asGitPrints(path));
        expect(await git(root, ["show-ref", "--verify", "refs/heads/held"])).toContain(
          "refs/heads/held",
        );
        expect(await exists(join(held, "link"))).toBe(true);
      } finally {
        await chmod(held, 0o700);
      }
    },
  );

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
      left: null,
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
        left: null,
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
        left: null,
      });
      expect(await readFile(join(target, "keep.txt"), "utf8")).toBe("keep\n");
      expect(await gitFails(root, ["show-ref", "--verify", "--quiet", "refs/heads/racing"])).toBe(
        true,
      );
    },
  );

  it("removes the copied files with the worktree when the save fails", async () => {
    const root = await repository();
    await writeFile(join(root, ".gitignore"), ".env\n");
    await writeFile(join(root, ".worktreeinclude"), ".env\n");
    await commit(root, "a", "first commit\n");
    await writeFile(join(root, ".env"), "TOKEN=1\n");
    const { result, path, detail } = await create(
      root,
      "unsaved",
      { kind: "default" },
      undefined,
      true,
    );
    expect(detail("files")).toBe("Copied 1 file.");
    expect(result).toEqual({
      ok: false,
      step: "save",
      sentence: "Satellite couldn't save the workspace list.",
      undone: true,
      left: null,
    });
    await leftNothing(root, "unsaved", path);
  });

  it.skipIf(!onUnix)("keeps the branch when the worktree could not be removed", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    const target = join(base, "home", "worktrees", "repo", "kept");
    await hook(
      root,
      "post-checkout",
      `cd /; mv '${target}' '${target}-moved'; mkdir '${target}'; exit 1`,
    );
    const { result } = await create(root, "kept");
    expect(result).toMatchObject({ ok: false, step: "worktree", undone: false });
    expect(await git(root, ["show-ref", "--verify", "refs/heads/kept"])).toContain(
      "refs/heads/kept",
    );
    expect(await git(root, ["worktree", "list", "--porcelain"])).toContain(asGitPrints(target));
    expect(await exists(target)).toBe(true);
  });

  it("refuses a folder git still lists from a worktree deleted by hand", async () => {
    const root = await repository();
    await commit(root, "a", "first commit\n");
    const target = join(base, "home", "worktrees", "repo", "stale");
    await mkdir(join(base, "home", "worktrees", "repo"), { recursive: true });
    await git(root, ["worktree", "add", "-q", "-b", "elsewhere", target]);
    await rm(target, { recursive: true, force: true });
    const { result } = await create(root, "stale");
    expect(result).toEqual({
      ok: false,
      step: "worktree",
      sentence:
        "git still lists a worktree at the folder for stale. Run git worktree prune, then try again.",
      undone: true,
      left: null,
    });
    expect(await gitFails(root, ["show-ref", "--verify", "--quiet", "refs/heads/stale"])).toBe(
      true,
    );
    expect(await exists(target)).toBe(false);
  });

  it("fetches the default branch even when the remote has no fetch refspec", async () => {
    const upstream = await repository("upstream");
    await commit(upstream, "a", "first commit\n");
    const root = join(base, "repo");
    await run("git", ["clone", "-q", upstream, root], { env: gitEnvironment() });
    await git(root, ["config", "--unset-all", "remote.origin.fetch"]);
    const second = await commit(upstream, "b", "second commit\n");
    const { result, path, detail } = await create(root, "narrow");
    expect(result).toEqual({ ok: true });
    expect(detail("start")).toBe("Fetched main from origin.");
    expect(await git(path, ["rev-parse", "HEAD"])).toBe(second);
  });

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
      left: null,
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
      left: null,
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
      left: null,
    });
    expect(Date.now() - started).toBeLessThan(15_000);
    await leftNothing(root, "quitting", path);
  });
});

describe("prepareWorkspace", { timeout: 30_000 }, () => {
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
    await git(root, ["remote", "set-head", "origin", "-d"]);
    expect((await prepareWorkspace(root, home)).start).toEqual({
      kind: "remote",
      remote: "origin",
      branch: null,
    });
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
