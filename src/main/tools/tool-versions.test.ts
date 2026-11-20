import { describe, expect, it, vi } from "vitest";
import { runTool } from "../platform/tools.ts";
import { toolVersions } from "./tool-versions.ts";

vi.mock("../platform/tools.ts", () => ({ runTool: vi.fn() }));

describe("toolVersions", () => {
  it("shares one run between concurrent calls, so a page cannot fan out processes", async () => {
    const run = vi.mocked(runTool);
    run.mockResolvedValue({ exitCode: 0, stdout: "tool 1.0\n", stderr: "" });
    const answers = await Promise.all(Array.from({ length: 50 }, () => toolVersions()));
    expect(run).toHaveBeenCalledTimes(3);
    expect(answers[49]).toEqual({ git: "tool 1.0", gh: "tool 1.0", claude: "tool 1.0" });
    await toolVersions();
    expect(run).toHaveBeenCalledTimes(6);
  });
});
