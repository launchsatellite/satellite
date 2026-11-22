import { describe, expect, it } from "vitest";
import type { WorkspaceView } from "../../shared/bridge-contract.ts";
import { runningHere } from "./running-here.ts";

const projectId = "6f1c1a52-8a4e-4a3b-9a59-3c8f0f8f6b1d";
const alpha = "0b6a2f3e-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
const workspace = (key: string): WorkspaceView => ({
  key,
  name: key === "main" ? null : "alpha",
  branch: null,
  ahead: null,
  behind: null,
  changed: null,
});
const project = { id: projectId, workspaces: [workspace("main"), workspace(alpha)] };

describe("runningHere", () => {
  it("counts a session and processes running in a workspace besides main", () => {
    const running = runningHere(
      project,
      [
        { workspace: { projectId, workspace: alpha }, status: "working" },
        { workspace: { projectId, workspace: "main" }, status: "stopped" },
        { workspace: { projectId: "other", workspace: "main" }, status: "working" },
      ],
      (ref) => (ref.workspace === alpha ? 2 : 0),
    );
    expect(running).toEqual({ sessions: 1, processes: 2 });
  });

  it("counts nothing when nothing runs", () => {
    expect(runningHere(project, [], () => 0)).toEqual({ sessions: 0, processes: 0 });
  });
});
