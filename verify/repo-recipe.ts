import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { RepoStep } from "./scenario.ts";

const run = promisify(execFile);

export async function writeInside(target: string, path: string, content: string): Promise<void> {
  const file = resolve(target, path);
  const fromTarget = relative(target, file);
  const climbsOut = fromTarget === ".." || fromTarget.startsWith(`..${sep}`);
  if (fromTarget === "" || climbsOut || isAbsolute(fromTarget)) {
    throw new Error(`a scenario step writes ${path}, which is outside its folder`);
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

export function withoutGitVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  );
}

export async function buildRepo(
  target: string,
  steps: RepoStep[],
  gitEnv: Record<string, string>,
): Promise<void> {
  const env = { ...withoutGitVariables(process.env), ...gitEnv };
  for (const step of steps) {
    if ("write" in step) {
      await writeInside(target, step.write.path, step.write.content);
      continue;
    }
    try {
      await run("git", step.git, { cwd: target, env, windowsHide: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`repo step git ${step.git.join(" ")} failed. ${reason}`, { cause: error });
    }
  }
}
