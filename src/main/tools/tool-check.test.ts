import { describe, expect, it, vi } from "vitest";
import { runTool } from "../platform/tools.ts";
import { checkTools, versionNumber } from "./tool-check.ts";

vi.mock("../platform/tools.ts", () => ({ runTool: vi.fn() }));

describe("versionNumber", () => {
  it("reads the version number from each tool", () => {
    expect(versionNumber("git version 2.50.1")).toBe("2.50.1");
    expect(versionNumber("gh version 2.80.0 (2025-09-23)")).toBe("2.80.0");
    expect(versionNumber("2.1.211 (Claude Code)")).toBe("2.1.211");
  });
});

describe("checkTools", () => {
  it("shares one run between concurrent calls, so a page cannot fan out processes", async () => {
    const run = vi.mocked(runTool);
    run.mockReset();
    run.mockResolvedValue({ exitCode: 0, stdout: "tool 1.0\n", stderr: "" });
    const answers = await Promise.all(Array.from({ length: 50 }, () => checkTools()));
    expect(run).toHaveBeenCalledTimes(4);
    expect(answers[49]).toEqual({
      git: { state: "ready", version: "1.0" },
      gh: { state: "ready", version: "1.0", account: null },
      claude: { state: "ready", version: "1.0" },
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
        : Promise.resolve({ exitCode: 0, stdout: "tool 1.0\n", stderr: "" }),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await checkTools()).gh).toEqual({
      state: "signed-out",
      reason: "failed",
      fix: "gh auth login",
    });
    logged.mockRestore();
  });
});
