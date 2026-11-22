import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { countUnpushed, hasRemote, readTracking } from "./branch-tracking.ts";
import { readStatus } from "./changed-files.ts";
import { prepareWorkspace } from "./create-steps.ts";
import { listWorktrees } from "./worktree-list.ts";

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
const version = /(\d+)\.(\d+)/.exec((await run("git", ["--version"])).stdout);
const hasSwitch = Number(version?.[1]) * 1000 + Number(version?.[2]) >= 2045;
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function partialClone() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-lazy-")));
  const config = join(base, "gitconfig");
  await writeFile(config, "[user]\n\tname = Satellite Test\n\temail = test@example.invalid\n");
  process.env["GIT_CONFIG_GLOBAL"] = config;
  process.env["GIT_CONFIG_NOSYSTEM"] = "1";
  const repo = join(base, "repo");
  const marker = join(base, "ssh-ran");
  const git = async (...args: string[]) => (await run("git", ["-C", repo, ...args])).stdout.trim();
  await run("git", ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "a.txt"), "a\n");
  await git("add", ".");
  await git("commit", "-q", "-m", "one");
  await git("remote", "add", "origin", "ssh://probe.invalid/x.git");
  await git("config", "extensions.partialClone", "origin");
  await git("config", "remote.origin.promisor", "true");
  await git("config", "core.sshCommand", `touch ${marker.split("\\").join("/")}`);
  await mkdir(join(repo, ".git", "refs", "remotes", "origin"), { recursive: true });
  await writeFile(join(repo, ".git", "refs", "remotes", "origin", "main"), `${"ab".repeat(20)}\n`);
  return { repo, marker };
}

describe.skipIf(process.platform === "win32" || !hasSwitch)(
  "reads that must never fetch",
  { timeout: 60_000 },
  () => {
    it("lets the sidebar's tracking reads run without reaching a promisor remote", async () => {
      const { repo, marker } = await partialClone();
      await countUnpushed(repo, "main");
      await readTracking(repo, ["main"]);
      await hasRemote(repo);
      expect(await exists(marker)).toBe(false);
      expect(await readdir(join(repo, ".git")).then((names) => names.includes("FETCH_HEAD"))).toBe(
        false,
      );
    });

    it("reads status, worktrees and the dialog's branches without reaching a promisor remote", async () => {
      const { repo, marker } = await partialClone();
      const tree = (await run("git", ["-C", repo, "rev-parse", "HEAD^{tree}"])).stdout.trim();
      await unlink(join(repo, ".git", "objects", tree.slice(0, 2), tree.slice(2)));
      await readStatus(repo);
      await listWorktrees(repo);
      await prepareWorkspace(repo, await mkdtemp(join(tmpdir(), "satellite-lazy-home-")));
      expect(await exists(marker)).toBe(false);
    });
  },
);
