import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { vi } from "vitest";

const run = promisify(execFile);

export async function scratch(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "satellite-files-")));
}

export async function git(folder: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", folder, ...args]);
  return stdout;
}

export async function isolateGit(): Promise<void> {
  const config = join(await scratch(), "gitconfig");
  await writeFile(config, "");
  vi.stubEnv("GIT_CONFIG_GLOBAL", config);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
}

export async function makeRepository(): Promise<string> {
  const root = join(await scratch(), "repo");
  await mkdir(root);
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "commit.gpgsign", "false");
  return root;
}

export async function put(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

export const mockedEnvironment = () =>
  Promise.resolve(
    Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  );

export async function snapshot(folder: string): Promise<string[]> {
  const lines: string[] = [];
  for (const entry of await readdir(folder, { recursive: true })) {
    const found = await stat(join(folder, entry));
    lines.push(`${entry} ${String(found.size)} ${String(found.mtimeMs)}`);
  }
  return lines.sort();
}
