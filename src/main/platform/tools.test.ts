import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  childEnvironment,
  claudeEnvironment,
  parseToolOverride,
  resolveTool,
  runTool,
  toolEnvironment,
} from "./tools.ts";

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
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "inherit" });
require("node:fs").writeFileSync(process.argv[1], String(child.pid));
setTimeout(() => {}, 60_000);
`;

const leavesAnOrphan = `
const { spawn } = require("node:child_process");
const keep = "process.on('SIGHUP', () => {}); setTimeout(() => {}, 60_000);";
const orphan = \`const o = require("node:child_process").spawn(process.execPath, ["-e", \${JSON.stringify(keep)}], { detached: true, stdio: ["ignore", "inherit", "inherit"] }); require("node:fs").writeFileSync(process.argv[1], String(o.pid)); process.exit(0);\`;
spawn(process.execPath, ["-e", orphan, process.argv[1]], { stdio: "inherit" });
setTimeout(() => {}, 60_000);
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

describe("resolveTool", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads an override naming a file that is not there as missing", async () => {
    const folder = await mkdtemp(join(tmpdir(), "satellite-override-"));
    vi.stubEnv("SATELLITE_CLAUDE", JSON.stringify([join(folder, "missing-claude")]));
    expect(await resolveTool("claude")).toBeUndefined();
    vi.stubEnv("SATELLITE_CLAUDE", JSON.stringify([process.execPath, "stand-in.ts"]));
    expect(await resolveTool("claude")).toEqual({ file: process.execPath, args: ["stand-in.ts"] });
  });

  it("stops a tool at 16 MiB of output counted in bytes, not characters", async () => {
    const wide = "process.stdout.write('\\u754c'.repeat(6_000_000))";
    vi.stubEnv("SATELLITE_CLAUDE", JSON.stringify([process.execPath, "-e", wide]));
    await expect(runTool("claude", [], { timeoutMs: 20_000 })).rejects.toMatchObject({
      reason: "output",
    });
  }, 30_000);
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
      GIT_NO_LAZY_FETCH: "1",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "false",
      SSH_ASKPASS_REQUIRE: "never",
    });
    const gh = toolEnvironment("gh", { gh_prompt_disabled: "0", no_color: "0", Gh_Telemetry: "1" });
    expect(Object.keys(gh).sort()).toEqual(Object.keys(toolEnvironment("gh", {})).sort());
    expect(gh["GH_PROMPT_DISABLED"]).toBe("1");
    expect(gh["NO_COLOR"]).toBe("1");
    expect(gh["GH_TELEMETRY"]).toBe("false");
  });

  it("gives gh its quiet keys, git's prompt keys and an empty fsmonitor", () => {
    expect(toolEnvironment("gh", { PATH: "/usr/bin" })).toEqual({
      PATH: "/usr/bin",
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
      GH_TELEMETRY: "false",
      NO_COLOR: "1",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "false",
      SSH_ASKPASS_REQUIRE: "never",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "",
    });
  });

  it("drops the keys that could steer gh or its git", () => {
    const env = toolEnvironment("gh", {
      GH_HOST: "evil.example.invalid",
      gh_repo: "evil/x",
      GH_PAGER: "x",
      PAGER: "x",
      GH_BROWSER: "x",
      BROWSER: "x",
      GH_EDITOR: "x",
      GIT_DIR: "/tmp/x",
      GIT_WORK_TREE: "/tmp/x",
      GIT_CONFIG_PARAMETERS: "'core.pager=x'",
      GIT_CONFIG_COUNT: "5",
      GIT_CONFIG_KEY_3: "core.pager",
      GH_TOKEN: "token-value",
      GH_CONFIG_DIR: "/tmp/gh",
    });
    for (const key of [
      "GH_HOST",
      "gh_repo",
      "GH_PAGER",
      "PAGER",
      "GH_BROWSER",
      "BROWSER",
      "GH_EDITOR",
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_CONFIG_PARAMETERS",
    ]) {
      expect(Object.keys(env)).not.toContain(key);
    }
    expect(env["GIT_CONFIG_COUNT"]).toBe("1");
    expect(env["GH_TOKEN"]).toBe("token-value");
    expect(env["GH_CONFIG_DIR"]).toBe("/tmp/gh");
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

  it("drops the child session marker that hides a session from resume", () => {
    expect(claudeEnvironment({ PATH: "/usr/bin", CLAUDE_CODE_CHILD_SESSION: "1" })).toEqual({
      PATH: "/usr/bin",
    });
  });

  it("never hands Claude Code the identity of what started Satellite", () => {
    const kept = {
      PATH: "/usr/bin",
      HOME: "/Users/<name>",
      CLAUDE_CONFIG_DIR: "/Users/<name>/.claude",
      CLAUDE_CODE_USE_BEDROCK: "1",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      HTTPS_PROXY: "",
      TERM_PROGRAM_SETTING: "kept",
    };
    expect(
      claudeEnvironment({
        ...kept,
        CLAUDE_CODE_SSE_PORT: "51234",
        CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
        CLAUDE_CODE_BRIDGE_SESSION_ID: "session_x",
        CLAUDE_CODE_SESSION_ID: "x",
        CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/x.sock",
        CLAUDE_CODE_MESSAGING_TOKEN: "x",
        CLAUDE_EFFORT: "high",
        CLAUDE_JOB_DIR: "/tmp/x",
        CLAUDE_PID: "4242",
        CLAUDE_CODE_EXECPATH: "/Users/<name>/.local/bin/claude",
        CLAUDE_CODE_CHILD_NOTES_DIR: "/tmp/x",
        CLAUDE_CODE_SESSION_ATTENDED: "1",
        TERM_PROGRAM: "vscode",
        TERM_PROGRAM_VERSION: "1.0",
        TERM_SESSION_ID: "w0t0p0",
        ITERM_SESSION_ID: "w0t0p0",
        LC_TERMINAL: "iTerm2",
        KITTY_WINDOW_ID: "1",
        KITTY_PID: "1",
        KITTY_LISTEN_ON: "unix:/tmp/kitty",
        KITTY_PUBLIC_KEY: "x",
        WT_SESSION: "x",
        TMUX: "/tmp/tmux-501/default,1,0",
        TMUX_PANE: "%1",
        STY: "1.pts-0",
        VSCODE_SHELL_INTEGRATION: "1",
        VSCODE_GIT_IPC_HANDLE: "/tmp/vscode-git.sock",
      }),
    ).toEqual(kept);
  });

  it("drops the editor's askpass with the editor and keeps the user's own", () => {
    const helper = "/Applications/Editor.app/Contents/Resources/app/extensions/git/dist";
    expect(
      claudeEnvironment({
        PATH: "/usr/bin",
        GIT_ASKPASS: `${helper}/askpass.sh`,
        VSCODE_GIT_ASKPASS_MAIN: `${helper}/askpass-main.js`,
        VSCODE_GIT_ASKPASS_NODE: "/Applications/Editor.app/Contents/MacOS/Editor",
      }),
    ).toEqual({ PATH: "/usr/bin" });
    const own = { GIT_ASKPASS: "/usr/local/bin/my-askpass" };
    expect(
      claudeEnvironment({ ...own, VSCODE_GIT_ASKPASS_MAIN: `${helper}/askpass-main.js` }),
    ).toEqual(own);
    expect(claudeEnvironment(own)).toEqual(own);
  });

  it("drops the markers in any case on Windows only", () => {
    const env = { Path: "C:\\Windows", ClaudeCode: "1", claude_code_child_session: "1" };
    expect(claudeEnvironment(env, "win32")).toEqual({ Path: "C:\\Windows" });
    expect(claudeEnvironment(env, "linux")).toEqual(env);
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
        HTTPS_PROXY: "http://proxy.example.com:8080",
        NO_PROXY: "localhost 127.0.0.1 example.com",
        no_proxy: "example.com,127.0.0.1",
      }),
    ).toEqual({
      HTTPS_PROXY: "http://proxy.example.com:8080",
      NO_PROXY: "localhost 127.0.0.1 example.com",
      no_proxy: "example.com,127.0.0.1",
    });
    expect(
      claudeEnvironment({ ALL_PROXY: "socks5://proxy.example.com:1080", all_proxy: "x" }),
    ).toEqual({ ALL_PROXY: "socks5://proxy.example.com:1080", all_proxy: "x" });
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
      await expect(running).rejects.toMatchObject({ reason: "time" });
      child = Number(await readFile(pidFile, "utf8"));
      await vi.waitFor(() => {
        expect(isAlive(child)).toBe(false);
      }, 10_000);
    } finally {
      if (child === 0) child = Number(await readFile(pidFile, "utf8").catch(() => "0"));
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

describe("runTool in a folder", () => {
  it("runs a tool in the folder it is given", async () => {
    const folder = await mkdtemp(join(tmpdir(), "satellite-cwd-"));
    vi.stubEnv(
      "SATELLITE_GH",
      JSON.stringify([process.execPath, "-e", "process.stdout.write(process.cwd())"]),
    );
    const run = await runTool("gh", [], { cwd: folder });
    expect(await realpath(run?.stdout ?? "")).toBe(await realpath(folder));
  });
});

describe("git in a repository that configures programs", () => {
  it.skipIf(process.platform === "win32")(
    "starts none of them under the gh environment, and does without it",
    async () => {
      const folder = await mkdtemp(join(tmpdir(), "satellite-hostile-"));
      const marker = join(folder, "marker");
      const program = join(folder, "program.sh");
      await writeFile(program, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
      const repo = join(folder, "repo");
      await mkdir(repo);
      const git = (...args: string[]) => {
        const done = spawnSync("git", ["-C", repo, ...args]);
        expect(done.status).toBe(0);
      };
      git("init", "--quiet");
      git("config", "core.fsmonitor", program);
      const hardened = spawnSync("git", ["-C", repo, "status"], {
        env: toolEnvironment("gh", await childEnvironment()),
      });
      expect(hardened.status).toBe(0);
      expect(existsSync(marker)).toBe(false);
      const control = spawnSync("git", ["-C", repo, "status"]);
      expect(control.status).toBe(0);
      expect(existsSync(marker)).toBe(true);
    },
  );
});

describe("runTool input", () => {
  const hashOf = (text: string) =>
    createHash("sha1")
      .update(`blob ${String(Buffer.byteLength(text))}\0${text}`)
      .digest("hex");

  it("hands a tool its input on standard input", async () => {
    const run = await runTool("git", ["hash-object", "--stdin"], { input: "hi\n" });
    expect(run?.stdout.trim()).toBe("45b983be36b73c0788dc9cbcb76cbb80fc7bb057");
  });

  it("writes an input larger than the pipe buffer whole", async () => {
    const text = "satellite\n".repeat(300_000);
    const run = await runTool("git", ["hash-object", "--stdin"], { input: text });
    expect(run?.stdout.trim()).toBe(hashOf(text));
  });

  it("ignores a tool that exits before it reads its input", async () => {
    const unhandled = vi.fn();
    process.on("uncaughtException", unhandled);
    try {
      const run = await runTool("git", ["--version"], { input: "x".repeat(5_000_000) });
      await new Promise((settle) => setTimeout(settle, 200));
      expect(run?.exitCode).toBe(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("uncaughtException", unhandled);
    }
  });
});
