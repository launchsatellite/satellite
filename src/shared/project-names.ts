interface NamedProject {
  name: string;
  parent: string;
}

export function repeatedNames(projects: readonly NamedProject[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { name } of projects) {
    if (seen.has(name)) repeated.add(name);
    seen.add(name);
  }
  return repeated;
}

export function shownParent(
  project: NamedProject,
  repeated: ReadonlySet<string>,
): string | undefined {
  return repeated.has(project.name) && project.parent !== "" ? project.parent : undefined;
}
