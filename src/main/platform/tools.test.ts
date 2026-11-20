import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeEnvironment, parseToolOverride, runTool, toolEnvironment } from "./tools.ts";

vi.mock("./user-environment.ts", () => ({
  userEnvironment: () =>
    Promise.resolve(
      Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    ),
}));

const leavesAChild = `
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
require("node:fs").writeFileSync(process.argv[1], String(child.pid));
setInterval(() => {}, 1000);
`;

const leavesAnOrphan = `
const { spawn } = require("node:child_process");
const keep = "process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);";
const orphan = \`const o = require("node:child_process").spawn(process.execPath, ["-e", \${JSON.stringify(keep)}], { detached: true, stdio: ["ignore", "inherit", "inherit"] }); require("node:fs").writeFileSync(process.argv[1], String(o.pid)); process.exit(0);\`;
spawn(process.execPath, ["-e", orphan, process.argv[1]], { stdio: "inherit" });
setInterval(() => {}, 1000);
`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseToolOverride", () => {
  it("reads a JSON array override as executable and leading arguments", () => {
    expect(
      parseToolOverride("SATELLITE_GH", '["/opt/tools/bin/node","/opt/stand-ins/gh.ts"]'),
    ).toEqual({ file: "/opt/tools/bin/node", args: ["/opt/stand-ins/gh.ts"] });
    expect(parseToolOverride("SATELLITE_CLAUDE", '["/opt/tools/bin/claude"]')).toEqual({
      file: "/opt/tools/bin/claude",
      args: [],
    });
  });

  it("refuses an override that is not a non-empty array of strings and names the variable", () => {
    for (const value of ["/opt/tools/bin/gh", "[]", '[""]', "[1]", '{"file":"gh"}', "["]) {
      expect(() => parseToolOverride("SATELLITE_GH", value)).toThrow(/SATELLITE_GH/);
    }
  });
});

describe("toolEnvironment", () => {
  it("gives git an environment that never prompts", () => {
    const env = toolEnvironment("git", {
      PATH: "/usr/bin",
      GIT_ASKPASS: "/usr/bin/askpass",
      SSH_ASKPASS: "/usr/bin/ssh-askpass",
      GIT_DIR: "/tmp/x",
    });
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "false",
      SSH_ASKPASS_REQUIRE: "never",
      LC_ALL: "C",
    });
    expect(Object.keys(env)).not.toContain("GIT_ASKPASS");
    expect(Object.keys(env)).not.toContain("SSH_ASKPASS");
    expect(Object.keys(env)).not.toContain("GIT_DIR");
  });

  it("leaves no differently cased copy of a quiet variable", () => {
    const git = toolEnvironment("git", {
      git_terminal_prompt: "1",
      Gcm_Interactive: "true",
      ssh_askpass_require: "force",
      lc_all: "de_DE",
    });
    expect(git).toEqual({
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "false",
      SSH_ASKPASS_REQUIRE: "never",
    });
    const gh = toolEnvironment("gh", { gh_prompt_disabled: "0", no_color: "0", Gh_Telemetry: "1" });
    expect(Object.keys(gh).sort()).toEqual([
      "GH_NO_EXTENSION_UPDATE_NOTIFIER",
      "GH_NO_UPDATE_NOTIFIER",
      "GH_PROMPT_DISABLED",
      "GH_TELEMETRY",
      "NO_COLOR",
    ]);
  });
});

describe("claudeEnvironment", () => {
  it("gives Claude Code the user's environment without the nesting marker", () => {
    expect(
      claudeEnvironment({
        PATH: "/usr/bin",
        CLAUDECODE: "1",
        ANTHROPIC_BASE_URL: "https://llm.example.com",
      }),
    ).toEqual({ PATH: "/usr/bin", ANTHROPIC_BASE_URL: "https://llm.example.com" });
  });

  it("keeps loopback away from a proxy", () => {
    expect(claudeEnvironment({ HTTPS_PROXY: "http://proxy.example.com:8080" })).toEqual({
      HTTPS_PROXY: "http://proxy.example.com:8080",
      NO_PROXY: "127.0.0.1",
      no_proxy: "127.0.0.1",
    });
    expect(
      claudeEnvironment({
        http_proxy: "http://proxy.example.com:8080",
        NO_PROXY: "example.com",
        no_proxy: "",
      }),
    ).toEqual({
      http_proxy: "http://proxy.example.com:8080",
      NO_PROXY: "example.com,127.0.0.1",
      no_proxy: "127.0.0.1",
    });
    expect(
      claudeEnvironment({
        ALL_PROXY: "socks5://proxy.example.com:1080",
        NO_PROXY: "localhost 127.0.0.1 example.com",
        no_proxy: "example.com,127.0.0.1",
      }),
    ).toEqual({
      ALL_PROXY: "socks5://proxy.example.com:1080",
      NO_PROXY: "localhost 127.0.0.1 example.com",
      no_proxy: "example.com,127.0.0.1",
    });
    expect(claudeEnvironment({ HTTPS_PROXY: "", NO_PROXY: "example.com" })).toEqual({
      HTTPS_PROXY: "",
      NO_PROXY: "example.com",
    });
    expect(claudeEnvironment({ PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });
});

describe("runTool", () => {
  it("reads a tool with a malformed override as missing and logs the variable", async () => {
    vi.stubEnv("SATELLITE_GH", "/opt/tools/bin/gh");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runTool("gh", ["--version"])).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/^SATELLITE_GH must be/));
    logged.mockRestore();
  });

  it("ends the whole process tree of a tool that runs past its time limit", async () => {
    const folder = await mkdtemp(join(tmpdir(), "satellite-tools-"));
    const pidFile = join(folder, "child.pid");
    vi.stubEnv("SATELLITE_GH", JSON.stringify([process.execPath, "-e", leavesAChild]));
    let child = 0;
    try {
      const running = runTool("gh", [pidFile], { timeoutMs: 1000 });
      await expect(running).rejects.toThrow("gh did not finish in time");
      child = Number(await readFile(pidFile, "utf8"));
      await vi.waitFor(() => {
        expect(isAlive(child)).toBe(false);
      }, 10_000);
    } finally {
      if (child > 0 && isAlive(child)) process.kill(child, "SIGKILL");
      await rm(folder, { recursive: true, force: true });
    }
  }, 15_000);
});

describe("runTool", () => {
  it.skipIf(process.platform === "win32")(
    "settles after its time limit even when an escaped process keeps its output open",
    async () => {
      const folder = await mkdtemp(join(tmpdir(), "satellite-tools-"));
      const pidFile = join(folder, "orphan.pid");
      vi.stubEnv("SATELLITE_GH", JSON.stringify([process.execPath, "-e", leavesAnOrphan]));
      let orphan = 0;
      try {
        const started = Date.now();
        await expect(runTool("gh", [pidFile], { timeoutMs: 500 })).rejects.toThrow(
          "gh did not finish in time",
        );
        expect(Date.now() - started).toBeLessThan(8000);
        orphan = Number(await readFile(pidFile, "utf8"));
      } finally {
        if (orphan > 0 && isAlive(orphan)) process.kill(orphan, "SIGKILL");
        await rm(folder, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
