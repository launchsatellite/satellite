const unsafeCharacter = /[\p{Cc}\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩]/u;
const plainPath = /^[A-Za-z0-9._/\\:@%+=,~-]+$/;
const quoteOrEnd = /(\\*)("|$)/g;

function quoted(path: string): string {
  if (plainPath.test(path)) return path;
  const escaped = path.replace(
    quoteOrEnd,
    (_match, slashes: string, end: string) => `${slashes}${slashes}${end === '"' ? '\\"' : ""}`,
  );
  return `"${escaped}"`;
}

export function droppedPaths(paths: readonly string[]): string | null {
  if (paths.some((path) => path === "" || unsafeCharacter.test(path))) return null;
  return `${paths.map(quoted).join(" ")} `;
}
