import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BridgeOwner } from "../bridge/registry.ts";
import { createProjects } from "./project-list.ts";

const owner: BridgeOwner = { id: 1, emit: () => undefined, onGone: () => undefined };
const hung = vi.hoisted(() => ({ path: "", calls: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => {
      if (args[0] !== hung.path) return actual.stat(...args);
      hung.calls += 1;
      return new Promise<never>(() => undefined);
    },
  };
});

vi.mock("node:timers/promises", () => ({ setTimeout: () => Promise.resolve() }));

describe("createProjects", () => {
  it("reads a folder that never answers once, however often the list is asked for", async () => {
    const home = await mkdtemp(join(tmpdir(), "satellite-project-list-"));
    hung.path = join(home, "hung");
    hung.calls = 0;
    await writeFile(
      join(home, "projects.json"),
      JSON.stringify({
        version: 1,
        projects: [{ id: "8a6e0804-2bd0-4e1f-9b5a-6b1b6c3c2f10", path: hung.path }],
      }),
    );
    const { handlers } = createProjects({
      home,
      chooseFolder: () => Promise.resolve(undefined),
      window: () => undefined,
    });
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const answer = handlers["projects.list"]({}, owner);
      const { projects } = await answer;
      expect(projects[0]?.missing).toBe("folder");
    }
    expect(hung.calls).toBe(1);
  });

  it("adds one folder at a time and refuses a new add while a folder read never answers", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "satellite-project-add-")));
    hung.path = join(base, "hung");
    await mkdir(hung.path);
    await mkdir(join(base, "home"));
    const { handlers } = createProjects({
      home: join(base, "home"),
      chooseFolder: () => Promise.resolve(base),
      window: () => undefined,
    });
    const first = handlers["projects.drop"]({ path: hung.path }, owner);
    const second = handlers["projects.choose"]({}, owner);
    await expect(second).rejects.toThrow("Satellite is still adding the last folder.");
    await expect(first).rejects.toThrow(
      "That folder didn't answer within 6 seconds. Check the drive it's on, then try again.",
    );
    await expect(handlers["projects.drop"]({ path: base }, owner)).rejects.toThrow(
      "Satellite is still waiting on a folder that didn't answer. Try again in a moment.",
    );
  });
});
