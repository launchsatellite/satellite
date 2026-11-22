import { gitReadMs, storedObjects, readGit } from "../workspaces/git-command.ts";

type IgnoreCheck =
  | { kind: "checked"; ignored: ReadonlySet<string> }
  | { kind: "hung" }
  | { kind: "failed" }
  | { kind: "refused" };

const maxPaths = 5000;
const failed: IgnoreCheck = { kind: "failed" };
const hung: IgnoreCheck = { kind: "hung" };
const refusedPath = /^fatal: pathspec '.*' is (?:beyond a symbolic link|in submodule ')/im;

export async function checkIgnored(
  folder: string,
  paths: readonly string[],
  signal?: AbortSignal,
  timeoutMs = gitReadMs,
): Promise<IgnoreCheck> {
  if (paths.length === 0) return { kind: "checked", ignored: new Set() };
  if (paths.length > maxPaths || paths.some((path) => path === "" || path.includes("\0"))) {
    return failed;
  }
  const run = await readGit(folder, ["check-ignore", "-z", "--stdin"], timeoutMs, signal, {
    gitVariables: storedObjects,
    input: `${paths.join("\0")}\0`,
  });
  if (run === "time" || run === "stuck") return hung;
  if (typeof run === "string") return failed;
  if (run.exitCode === 128 && refusedPath.test(run.stderr)) return { kind: "refused" };
  if (run.exitCode !== 0 && run.exitCode !== 1) return failed;
  const asked = new Set(paths);
  const ignored = new Set(run.stdout.split("\0").filter((path) => path !== ""));
  for (const path of ignored) if (!asked.has(path)) return failed;
  return { kind: "checked", ignored };
}
