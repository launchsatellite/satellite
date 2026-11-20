import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { resolveInside } from "../src/main/platform/paths.ts";

const repoStepSchema = z.union([
  z.strictObject({ write: z.strictObject({ path: z.string().min(1), content: z.string() }) }),
  z.strictObject({ git: z.array(z.string()).min(1) }),
]);
const ghAnswerSchema = z.strictObject({
  args: z.array(z.string()),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.int().min(0).max(255).optional(),
});
const claudeStepSchema = z.union([
  z.strictObject({ print: z.string() }),
  z.strictObject({ wait: z.int().min(0).max(60_000) }),
]);

export const scenarioSchema = z.strictObject({
  description: z.string(),
  repo: z.array(repoStepSchema),
  gh: z.array(ghAnswerSchema),
  claude: z.strictObject({ version: z.string(), script: z.array(claudeStepSchema) }),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type RepoStep = z.infer<typeof repoStepSchema>;

const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const scenariosRoot = join(import.meta.dirname, "scenarios");

export async function loadScenario(
  name: string,
): Promise<{ dir: string; file: string; scenario: Scenario }> {
  const dir = kebabCase.test(name) ? await resolveInside(scenariosRoot, name) : undefined;
  if (dir === undefined) throw new Error(`no scenario named ${name} in verify/scenarios`);
  const file = join(dir, "scenario.json");
  const parsed = scenarioSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`scenario ${name} is invalid\n${z.prettifyError(parsed.error)}`);
  }
  return { dir, file, scenario: parsed.data };
}
