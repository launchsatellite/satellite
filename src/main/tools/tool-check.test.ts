import { describe, expect, it, vi } from "vitest";
import { runTool } from "../platform/tools.ts";
import { authStatusArguments, checkTools, versionNumber } from "./tool-check.ts";

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
