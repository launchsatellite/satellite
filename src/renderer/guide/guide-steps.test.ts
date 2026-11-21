import { describe, expect, it } from "vitest";
import { settledStep, stepAfter, stepReadout, stepSpoken } from "./guide-steps.ts";

describe("settledStep", () => {
  it("starts on make a workspace with no workspace and no session", () => {
    expect(settledStep(1, { workspaces: 0, sessions: 0 })).toBe(1);
  });

  it("skips to start Claude Code once a workspace exists and to read what it did once a session is open", () => {
    expect(settledStep(1, { workspaces: 1, sessions: 0 })).toBe(2);
    expect(settledStep(1, { workspaces: 1, sessions: 1 })).toBe(3);
    expect(settledStep(2, { workspaces: 0, sessions: 1 })).toBe(3);
  });

  it("never goes back when the session closes or the workspace is archived", () => {
    expect(settledStep(3, { workspaces: 0, sessions: 0 })).toBe(3);
    expect(settledStep(4, { workspaces: 0, sessions: 0 })).toBe(4);
  });
});

describe("stepAfter", () => {
  it("skips start Claude Code from make a workspace while a session is open", () => {
    expect(stepAfter(1, { workspaces: 0, sessions: 1 })).toBe(3);
    expect(stepAfter(1, { workspaces: 0, sessions: 0 })).toBe(2);
    expect(stepAfter(3, { workspaces: 0, sessions: 0 })).toBe(4);
    expect(stepAfter(4, { workspaces: 0, sessions: 0 })).toBe(4);
  });
});

describe("readouts", () => {
  it("reads each step as a two digit readout and a spoken one", () => {
    expect(stepReadout(1)).toBe("01 / 04");
    expect(stepSpoken(4)).toBe("Step 4 of 4");
  });
});
