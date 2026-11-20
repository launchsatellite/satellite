import { join } from "node:path";
import { z } from "zod";
import { bridgeLimits, workspaceName } from "../../shared/bridge-contract.ts";
import { isFullyQualified } from "../platform/paths.ts";
import { createJsonWriter, readJsonFile, type JsonReadOutcome } from "../state/json-file.ts";

export interface StoredWorkspace {
  id: string;
  name: string;
  path: string;
  branch: string;
}
export interface StoredProject {
  id: string;
  path: string;
  workspaces: StoredWorkspace[];
}
export interface LoadedProjects {
  projects: StoredProject[];
  notice: string | null;
  writable: boolean;
}
export interface ProjectsFile {
  load(): Promise<LoadedProjects>;
  save(projects: readonly StoredProject[]): Promise<void>;
  flush(): Promise<void>;
}

export const projectLimit = 200;
export const workspaceLimit = bridgeLimits.workspacesPerProject;

const storedPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => isFullyQualified(path));
const storedWorkspace = z.strictObject({
  id: z.uuid(),
  name: workspaceName,
  path: storedPath,
  branch: z.string().min(1).max(255),
});
const version1 = z
  .strictObject({
    version: z.literal(1),
    projects: z.array(z.strictObject({ id: z.uuid(), path: storedPath })).max(projectLimit),
  })
  .transform(({ projects }) => ({
    version: 2,
    projects: projects.map((project) => ({ ...project, workspaces: [] })),
  }));
const version2 = z.strictObject({
  version: z.literal(2),
  projects: z
    .array(
      z.strictObject({
        id: z.uuid(),
        path: storedPath,
        workspaces: z.array(storedWorkspace).max(workspaceLimit),
      }),
    )
    .max(projectLimit),
});
const fileSchema = z.union([version1, version2]).refine(({ projects }) => {
  const workspaces = projects.flatMap((project) => project.workspaces);
  return (
    allDifferent(projects.map((project) => project.id)) &&
    allDifferent(projects.map((project) => project.path)) &&
    allDifferent(workspaces.map((workspace) => workspace.id)) &&
    allDifferent(workspaces.map((workspace) => workspace.path))
  );
});
const notices: Record<JsonReadOutcome["kind"], string | null> = {
  read: null,
  missing: null,
  "set-aside":
    "Satellite couldn't read its saved projects, so it set that file aside and started with an empty list.",
  "not-moved":
    "Satellite couldn't read its saved projects or move them aside, so it started with an empty list and won't save project changes for now.",
  "not-read":
    "Satellite couldn't open its saved projects, so it started with an empty list, left the file as it is and won't save project changes for now.",
};

function allDifferent(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

async function readProjectsFile(file: string): Promise<LoadedProjects> {
  const { value, outcome } = await readJsonFile(file, fileSchema, { version: 2, projects: [] });
  return {
    projects: value.projects,
    notice: notices[outcome.kind],
    writable: outcome.kind !== "not-moved" && outcome.kind !== "not-read",
  };
}

export function createProjectsFile(home: string): ProjectsFile {
  const file = join(home, "projects.json");
  const writer = createJsonWriter(file);
  let cached: Promise<LoadedProjects> | undefined;
  const load = () => {
    cached ??= readProjectsFile(file);
    return cached;
  };
  return {
    load,
    async save(projects) {
      const loaded = await load();
      if (!loaded.writable) throw new Error("projects.json is not writable for this run");
      await writer.write({ version: 2, projects });
    },
    flush: () => writer.flush(),
  };
}
