import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { z } from "zod";
import { resolveInside } from "../src/main/platform/paths.ts";
import { hookEvents } from "../src/main/sessions/claude-launch.ts";

export type Scenario = z.infer<typeof scenarioSchema>;
export type RepoStep = z.infer<typeof repoStepSchema>;

const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const scenariosRoot = join(import.meta.dirname, "scenarios");
const repoStepSchema = z.union([
  z.strictObject({
    write: z.strictObject({
      path: z.string().min(1),
      content: z.string(),
      executable: z.boolean().optional(),
    }),
  }),
  z.strictObject({ git: z.array(z.string()).min(1) }),
]);
const ghAnswerSchema = z.strictObject({
  args: z.array(z.string()),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.int().min(0).max(255).optional(),
});
const seededFileSchema = z.strictObject({ path: z.string().min(1), content: z.string() });
const claudeStepSchema = z.union([
  z.strictObject({ print: z.string() }),
  z.strictObject({ wait: z.int().min(0).max(60_000) }),
  z.strictObject({ flood: z.int().min(1).max(50_000_000) }),
  z.strictObject({ child: z.literal("ignores-hangup") }),
  z.strictObject({
    hook: z.enum(hookEvents),
    fields: z.record(z.string(), z.string()).optional(),
  }),
  z.strictObject({ await: z.string().min(1) }),
  z.strictObject({ trust: z.literal(true) }),
  z.strictObject({ exit: z.int().min(0).max(255) }),
]);

export const scenarioSchema = z.strictObject({
  description: z.string(),
  repo: z.array(repoStepSchema),
  home: z.array(seededFileSchema).optional(),
  claudeConfig: z.array(seededFileSchema).optional(),
  folders: z
    .array(z.strictObject({ name: z.string().regex(kebabCase), steps: z.array(repoStepSchema) }))
    .optional(),
  workspaces: z
    .array(z.strictObject({ name: z.string().regex(kebabCase), steps: z.array(repoStepSchema) }))
    .optional(),
  gh: z.array(ghAnswerSchema),
  claude: z.union([
    z.strictObject({
      version: z.string(),
      resumeFails: z.literal(true).optional(),
      script: z.array(claudeStepSchema),
    }),
    z.strictObject({ missing: z.literal(true) }),
  ]),
});

export async function loadScenario(
  name: string,
): Promise<{ dir: string; file: string; scenario: Scenario }> {
  const dir = kebabCase.test(name) ? await resolveInside(scenariosRoot, name) : undefined;
  if (dir === undefined) throw new Error(`no scenario named ${name} in verify/scenarios`);
  const file = join(dir, "scenario.json");
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`scenario ${name} is not valid JSON. ${String(error)}`, { cause: error });
  }
  const parsed = scenarioSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`scenario ${name} is invalid\n${z.prettifyError(parsed.error)}`);
  }
  const seedsProjects = parsed.data.home?.some(
    (seeded) => normalize(seeded.path) === "projects.json",
  );
  if (parsed.data.workspaces !== undefined && seedsProjects === true) {
    throw new Error(`scenario ${name} seeds projects.json twice`);
  }
  return { dir, file, scenario: parsed.data };
}
