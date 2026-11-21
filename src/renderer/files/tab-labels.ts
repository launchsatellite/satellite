interface TabLabel {
  name: string;
  parent: string | undefined;
}

function split(path: string): { name: string; folders: string[] } {
  const parts = path.split("/");
  return { name: parts.at(-1) ?? path, folders: parts.slice(0, -1) };
}

function trailing(folders: readonly string[], depth: number): string {
  return folders.slice(Math.max(0, folders.length - depth)).join("/");
}

export function tabLabels(paths: readonly string[]): TabLabel[] {
  const parts = paths.map(split);
  return parts.map(({ name, folders }, at) => {
    const twins = parts.filter((other, index) => index !== at && other.name === name);
    if (twins.length === 0) return { name, parent: undefined };
    let depth = 1;
    while (
      depth < folders.length &&
      twins.some((twin) => trailing(twin.folders, depth) === trailing(folders, depth))
    ) {
      depth += 1;
    }
    const parent = trailing(folders, depth);
    return { name, parent: parent === "" ? undefined : parent };
  });
}
