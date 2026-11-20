import { mkdir, mkdtemp, readdir, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isWorktreeFolder,
  prepareWorktreeFolder,
  projectSegment,
  worktreesRoot,
} from "./worktree-folders.ts";

const plainFolderRefusal =
  "Satellite's worktrees folder isn't a plain folder, so it won't make a workspace there.";

async function temporaryHome(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "satellite-folders-")));
}

describe("projectSegment", () => {
  it("makes a safe segment from any folder name", () => {
    expect(projectSegment("/Users/<name>/code/my repo")).toBe("my-repo");
    expect(projectSegment("/Users/<name>/code/..")).toBe("project");
    expect(projectSegment("/Users/<name>/code/.hidden")).toBe("hidden");
    expect(projectSegment("/Users/<name>/code/CON")).toBe("CON-project");
    expect(projectSegment("/Users/<name>/code/con.git")).toBe("con-project.git");
    expect(projectSegment("/Users/<name>/code/プロジェクト")).toBe("project");
    expect(projectSegment("/Users/<name>/code/a  --  b..")).toBe("a-b");
    expect(projectSegment(`/Users/<name>/code/${"a".repeat(47)}-${"b".repeat(12)}`)).toBe(
      "a".repeat(47),
    );
    expect(projectSegment(`/Users/<name>/code/${"x".repeat(60)}`)).toHaveLength(48);
  });
});

describe("prepareWorktreeFolder", () => {
  it("answers a folder inside the worktrees folder", async () => {
    const home = await temporaryHome();
    const answer = await prepareWorktreeFolder(home, "/Users/<name>/code/my repo", "quiet-orbit");
    expect(answer).toEqual({
      ok: true,
      path: join(home, "worktrees", "my-repo", "quiet-orbit"),
      segment: "my-repo",
    });
    expect(await readdir(join(home, "worktrees", "my-repo"))).toEqual([]);
  });

  it("refuses names that are not workspace names", async () => {
    const home = await temporaryHome();
    for (const name of ["..", "../x", "a/b", "Quiet", "nul", ""]) {
      const answer = await prepareWorktreeFolder(home, "/Users/<name>/code/repo", name);
      expect(answer.ok).toBe(false);
    }
  });

  it.skipIf(process.platform === "linux")(
    "refuses a name that already has a folder, whatever its case",
    async () => {
      const home = await temporaryHome();
      await mkdir(join(home, "worktrees", "repo", "Quiet-Orbit"), { recursive: true });
      expect(await prepareWorktreeFolder(home, "/Users/<name>/code/repo", "quiet-orbit")).toEqual({
        ok: false,
        refusal:
          "A folder named quiet-orbit is already in Satellite's worktrees for repo. Pick another name.",
      });
    },
  );

  it("refuses a name that already has a file or a link", async () => {
    const home = await temporaryHome();
    await mkdir(join(home, "worktrees", "repo"), { recursive: true });
    await symlink(join(home, "nowhere"), join(home, "worktrees", "repo", "quiet-orbit"));
    const answer = await prepareWorktreeFolder(home, "/Users/<name>/code/repo", "quiet-orbit");
    expect(answer.ok).toBe(false);
  });

  it.skipIf(process.platform === "win32")("refuses a worktrees folder that is a link", async () => {
    const home = await temporaryHome();
    const elsewhere = await temporaryHome();
    await symlink(elsewhere, join(home, "worktrees"));
    expect(await prepareWorktreeFolder(home, "/Users/<name>/code/repo", "quiet-orbit")).toEqual({
      ok: false,
      refusal: plainFolderRefusal,
    });
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("refuses a segment folder that is a link", async () => {
    const home = await temporaryHome();
    const elsewhere = await temporaryHome();
    await mkdir(worktreesRoot(home));
    await symlink(elsewhere, join(home, "worktrees", "repo"));
    expect(await prepareWorktreeFolder(home, "/Users/<name>/code/repo", "quiet-orbit")).toEqual({
      ok: false,
      refusal: plainFolderRefusal,
    });
  });
});

describe("isWorktreeFolder", () => {
  it("confirms only folders two levels inside", async () => {
    const home = await temporaryHome();
    const outside = await temporaryHome();
    const workspace = join(home, "worktrees", "p", "n");
    await mkdir(join(workspace, "deeper"), { recursive: true });
    await mkdir(join(outside, "p", "n"), { recursive: true });
    expect(await isWorktreeFolder(home, workspace)).toBe(true);
    expect(await isWorktreeFolder(home, join(home, "worktrees", "p"))).toBe(false);
    expect(await isWorktreeFolder(home, join(workspace, "deeper"))).toBe(false);
    expect(await isWorktreeFolder(home, join(outside, "p", "n"))).toBe(false);
    expect(await isWorktreeFolder(home, join(home, "worktrees", "p", "missing"))).toBe(false);
    expect(await isWorktreeFolder(home, "worktrees/p/n")).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "refuses links at the workspace or above it",
    async () => {
      const home = await temporaryHome();
      const outside = await temporaryHome();
      await mkdir(join(outside, "p", "n"), { recursive: true });
      await mkdir(join(home, "worktrees", "p"), { recursive: true });
      await symlink(join(outside, "p", "n"), join(home, "worktrees", "p", "n"));
      expect(await isWorktreeFolder(home, join(home, "worktrees", "p", "n"))).toBe(false);
      await symlink(join(outside, "p"), join(home, "worktrees", "q"));
      expect(await isWorktreeFolder(home, join(home, "worktrees", "q", "n"))).toBe(false);
      await mkdir(join(home, "worktrees", "r", "n"), { recursive: true });
      await symlink(join(home, "worktrees", "r"), join(home, "worktrees", "s"));
      expect(await isWorktreeFolder(home, join(home, "worktrees", "s", "n"))).toBe(false);
      const linkedHome = await temporaryHome();
      await symlink(outside, join(linkedHome, "worktrees"));
      expect(await isWorktreeFolder(linkedHome, join(linkedHome, "worktrees", "p", "n"))).toBe(
        false,
      );
    },
  );
});
