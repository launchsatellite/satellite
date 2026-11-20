import { describe, expect, it } from "vitest";
import { claudeArgs, hookEvents, hookSettings } from "./claude-launch.ts";

const sessionId = "0b8f3c2e-5d4a-4f6b-9c1d-2e3f4a5b6c7d";
const settingsFile =
  process.platform === "win32"
    ? "C:\\Users\\<name>\\.satellite\\sessions\\9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d.json"
    : "/Users/<name>/.satellite/sessions/9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d.json";

describe("claudeArgs", () => {
  it("starts a new session with Satellite's id and settings", () => {
    expect(claudeArgs({ kind: "new", sessionId }, settingsFile)).toEqual([
      "--session-id",
      sessionId,
      "--settings",
      settingsFile,
    ]);
  });

  it("resumes a recorded session with the settings passed again", () => {
    expect(claudeArgs({ kind: "resume", sessionId }, settingsFile)).toEqual([
      "--resume",
      sessionId,
      "--settings",
      settingsFile,
    ]);
  });

  it("leaves the settings out when there is no listener", () => {
    expect(claudeArgs({ kind: "new", sessionId }, undefined)).toEqual(["--session-id", sessionId]);
    expect(claudeArgs({ kind: "resume", sessionId }, undefined)).toEqual(["--resume", sessionId]);
  });

  it("refuses an id that is not a UUID", () => {
    for (const id of ["--help", "-x", ""]) {
      expect(() => claudeArgs({ kind: "new", sessionId: id }, settingsFile)).toThrow(Error);
      expect(() => claudeArgs({ kind: "resume", sessionId: id }, undefined)).toThrow(Error);
    }
  });

  it("refuses a settings path that is not absolute", () => {
    for (const file of ["--help", "-x", "", "sessions/settings.json"]) {
      expect(() => claudeArgs({ kind: "new", sessionId }, file)).toThrow(Error);
      expect(() => claudeArgs({ kind: "resume", sessionId }, file)).toThrow(Error);
    }
  });
});

describe("hookSettings", () => {
  it("posts every hook to its own path with the secret as a literal", () => {
    const baseUrl = "http://127.0.0.1:43210/hook/9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
    const secret = "ab".repeat(32);
    const settings = hookSettings(baseUrl, secret);
    expect(Object.keys(settings.hooks)).toEqual([...hookEvents]);
    for (const event of hookEvents) {
      expect(settings.hooks[event]).toEqual([
        {
          hooks: [
            {
              type: "http",
              url: `${baseUrl}/${event}`,
              headers: { Authorization: `Bearer ${secret}` },
              timeout: 5,
            },
          ],
        },
      ]);
    }
    const text = JSON.stringify(settings);
    expect(text).not.toContain("$");
    expect(text).not.toContain("allowedEnvVars");
    expect(text).not.toContain("matcher");
  });
});
