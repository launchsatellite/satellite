import { join } from "node:path";
import { z } from "zod";
import { bridgeLimits, workspaceName } from "../../shared/bridge-contract.ts";
import { comparablePath, isFullyQualified } from "../platform/paths.ts";
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
  read: boolean;
  newer: boolean;
}
export interface ProjectsFile {
  load(): Promise<LoadedProjects>;
  save(projects: readonly StoredProject[]): Promise<void>;
  flush(): Promise<void>;
}

export const projectLimit = 200;
export const workspaceLimit = bridgeLimits.workspacesPerProject;
export const outsideLimit = bridgeLimits.outsideWorktreesPerProject;

const newestVersion = 2;

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
        workspaces: z.array(storedWorkspace).max(workspaceLimit + outsideLimit),
      }),
    )
    .max(projectLimit),
});
const fileSchema = z
  .union([version1, version2])
  .transform((file) => ({ ...file, projects: withoutRepeatedFolders(file.projects) }))
  .refine(({ projects }) => {
    const workspaces = projects.flatMap((project) => project.workspaces);
    return (
      allDifferent(projects.map((project) => project.id)) &&
      allDifferent(workspaces.map((workspace) => workspace.id)) &&
      allDifferent(projects.map((project) => comparablePath(project.path)))
    );
  });
const notices: Record<JsonReadOutcome["kind"], string | null> = {
  read: null,
  missing: null,
  "set-aside":
    "Satellite couldn't read its saved repos, so it set that file aside and started with an empty list.",
  "not-moved":
    "Satellite couldn't read its saved repos or move them aside, so it started with an empty list and won't save repo changes for now.",
  "not-read":
    "Satellite couldn't open its saved repos, so it started with an empty list, left the file as it is and won't save repo changes for now.",
  newer:
    "Your repos were saved by a newer Satellite, so this one leaves them untouched and shows none until you open that newer version.",
};

function allDifferent(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function withoutRepeatedFolders(projects: readonly StoredProject[]): StoredProject[] {
  const seen = new Set(projects.map((project) => comparablePath(project.path)));
  return projects.map((project) => ({
    ...project,
    workspaces: project.workspaces.filter((workspace) => {
      const path = comparablePath(workspace.path);
      if (seen.has(path)) return false;
      seen.add(path);
      return true;
    }),
  }));
}

async function readProjectsFile(file: string): Promise<LoadedProjects> {
  const { value, outcome } = await readJsonFile(
    file,
    fileSchema,
    { version: 2, projects: [] },
    newestVersion,
  );
  return {
    projects: value.projects,
    notice: notices[outcome.kind],
    writable:
      outcome.kind !== "not-moved" && outcome.kind !== "not-read" && outcome.kind !== "newer",
    read: outcome.kind === "read",
    newer: outcome.kind === "newer",
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
      await writer.write({ version: newestVersion, projects });
    },
    flush: () => writer.flush(),
  };
}
