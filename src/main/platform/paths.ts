import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

async function realpathOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

export async function resolveInside(root: string, requested: string): Promise<string | undefined> {
  const realRoot = await realpathOrUndefined(root);
  const realCandidate = await realpathOrUndefined(join(root, requested));
  if (realRoot === undefined || realCandidate === undefined) return undefined;
  const fromRoot = relative(realRoot, realCandidate);
  const climbsOut = fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
  return climbsOut ? undefined : realCandidate;
}
