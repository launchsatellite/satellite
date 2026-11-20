import { join } from "node:path";
import { z } from "zod";
import { isFullyQualified } from "../platform/paths.ts";
import { createJsonWriter, readJsonFile, type JsonReadOutcome } from "../state/json-file.ts";

export interface StoredProject {
  id: string;
  path: string;
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

const storedProject = z.strictObject({
  id: z.uuid(),
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine((path) => isFullyQualified(path)),
});
const fileSchema = z
  .strictObject({ version: z.literal(1), projects: z.array(storedProject).max(projectLimit) })
  .refine(
    ({ projects }) =>
      new Set(projects.map((project) => project.id)).size === projects.length &&
      new Set(projects.map((project) => project.path)).size === projects.length,
  );
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

async function readProjectsFile(file: string): Promise<LoadedProjects> {
  const { value, outcome } = await readJsonFile(file, fileSchema, { version: 1, projects: [] });
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
      await writer.write({ version: 1, projects });
    },
    flush: () => writer.flush(),
  };
}
