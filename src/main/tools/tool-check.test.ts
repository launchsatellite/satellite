import { describe, expect, it, vi } from "vitest";
import { runTool } from "../platform/tools.ts";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authStatusArguments,
  checkClaude,
  checkTools,
  claudeAnswerMs,
  launchableClaude,
  versionNumber,
} from "./tool-check.ts";

vi.mock("../platform/tools.ts", () => ({ runTool: vi.fn() }));

describe("versionNumber", () => {
  it("reads the version number from each tool", () => {
    expect(versionNumber("git version 2.50.1")).toBe("2.50.1");
    expect(versionNumber("gh version 2.80.0 (2025-09-23)")).toBe("2.80.0");
    expect(versionNumber("2.1.211 (Claude Code)")).toBe("2.1.211");
    expect(versionNumber("Welcome to the wrapper script")).toBe("");
  });
});

describe("authStatusArguments", () => {
  it("asks for the active account only from the gh release that has the flag", () => {
    expect(authStatusArguments("2.39.2")).toEqual(["auth", "status"]);
    expect(authStatusArguments("2.4.0")).toEqual(["auth", "status"]);
    expect(authStatusArguments("1.99.0")).toEqual(["auth", "status"]);
    expect(authStatusArguments("2.40.0")).toEqual(["auth", "status", "--active"]);
    expect(authStatusArguments("2.80.0")).toEqual(["auth", "status", "--active"]);
    expect(authStatusArguments("3.0")).toEqual(["auth", "status", "--active"]);
  });
});

describe("checkClaude", () => {
  it("asks for an update below the first Claude Code with every hook event Satellite listens to", async () => {
    const run = vi.mocked(runTool);
    const answer = async (version: string) => {
      run.mockReset();
      run.mockResolvedValue({ exitCode: 0, stdout: `${version} (Claude Code)\n`, stderr: "" });
      return checkClaude();
    };
    expect(await answer("2.1.77")).toEqual({
      state: "too-old",
      version: "2.1.77",
      minimum: "2.1.78",
    });
    expect(await answer("2.0.99")).toMatchObject({ state: "too-old" });
    expect(await answer("2.1.78")).toEqual({ state: "ready", version: "2.1.78" });
    expect(await answer("2.1.330")).toEqual({ state: "ready", version: "2.1.330" });
    expect(await answer("3.0")).toEqual({ state: "ready", version: "3.0" });
  });
});

describe("launchableClaude", () => {
  it("reuses its answer for the same claude for a minute, and checks again once the file changes", async () => {
    const run = vi.mocked(runTool);
    run.mockReset();
    run.mockResolvedValue({ exitCode: 0, stdout: "2.1.10 (Claude Code)\n", stderr: "" });
    const file = join(await mkdtemp(join(tmpdir(), "satellite-claude-")), "claude");
    await writeFile(file, "one");
    const command = { file, args: [] };
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const answers = await Promise.all([launchableClaude(command), launchableClaude(command)]);
    expect(answers[1]).toMatchObject({ state: "too-old" });
    expect(run).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(1000 + claudeAnswerMs - 1);
    await launchableClaude(command);
    expect(run).toHaveBeenCalledTimes(1);
    await utimes(file, new Date(), new Date(Date.now() + 5000));
    await launchableClaude(command);
    expect(run).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(1000 + claudeAnswerMs * 3);
    await launchableClaude(command);
    expect(run).toHaveBeenCalledTimes(3);
    clock.mockRestore();
  });

  it("answers broken, never too old, when the check runs out of time", async () => {
    const run = vi.mocked(runTool);
    run.mockReset();
    run.mockRejectedValue(new Error("claude did not finish in time"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = join(await mkdtemp(join(tmpdir(), "satellite-claude-")), "claude");
    await writeFile(file, "two");
    expect(await launchableClaude({ file, args: [] })).toEqual({ state: "broken" });
    logged.mockRestore();
  });
});

describe("checkTools", () => {
  it("shares one run between concurrent calls, so a page cannot fan out processes", async () => {
    const run = vi.mocked(runTool);
    run.mockReset();
    run.mockResolvedValue({ exitCode: 0, stdout: "tool 2.80.0\n", stderr: "" });
    const answers = await Promise.all(Array.from({ length: 50 }, () => checkTools()));
    expect(run).toHaveBeenCalledTimes(4);
    expect(run).toHaveBeenCalledWith("gh", ["auth", "status", "--active"], expect.anything());
    expect(answers[49]).toEqual({
      git: { state: "ready", version: "2.80.0" },
      gh: { state: "ready", version: "2.80.0", account: null, host: null },
      claude: { state: "ready", version: "2.80.0" },
    });
    await checkTools();
    expect(run).toHaveBeenCalledTimes(8);
  });

  it("reads a sign-in check that runs out of time as unconfirmed", async () => {
    const run = vi.mocked(runTool);
    run.mockReset();
    run.mockImplementation((_tool, args) =>
      args[0] === "auth"
        ? Promise.reject(new Error("gh did not finish in time"))
        : Promise.resolve({ exitCode: 0, stdout: "tool 2.80.0\n", stderr: "" }),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await checkTools()).gh).toEqual({ state: "signed-out", reason: "failed" });
    logged.mockRestore();
  });

  it("tells a tool that will not run from one that is missing", async () => {
    const run = vi.mocked(runTool);
    run.mockReset();
    run.mockImplementation((tool) =>
      Promise.resolve(
        tool === "claude" ? undefined : { exitCode: 69, stdout: "", stderr: "licence" },
      ),
    );
    const check = await checkTools();
    expect(check.git).toEqual({ state: "broken" });
    expect(check.claude.state).toBe("missing");
  });
});
