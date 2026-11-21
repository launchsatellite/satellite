import { noticeName } from "./notice-name.ts";

interface NamedProject {
  name: string;
  parent: string;
}

function readAs(name: string): string {
  return noticeName(name.normalize("NFC"), "");
}

export function repeatedNames(projects: readonly NamedProject[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { name } of projects) {
    const shown = readAs(name);
    if (seen.has(shown)) repeated.add(shown);
    seen.add(shown);
  }
  return repeated;
}

export function shownParent(
  project: NamedProject,
  repeated: ReadonlySet<string>,
): string | undefined {
  return repeated.has(readAs(project.name)) && project.parent !== "" ? project.parent : undefined;
}
