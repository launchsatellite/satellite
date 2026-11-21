import { holdsHiddenText } from "../../shared/prompt-text.ts";

const plainPath = /^[A-Za-z0-9._/:@%+=,~-]+$/;
const quoteOrEnd = /(\\*)("|$)/g;

export function quotedPath(path: string): string {
  if (plainPath.test(path)) return path;
  const escaped = path.replace(
    quoteOrEnd,
    (_match, slashes: string, end: string) => `${slashes}${slashes}${end === '"' ? '\\"' : ""}`,
  );
  return `"${escaped}"`;
}

export function droppedPaths(paths: readonly string[]): string | null {
  if (paths.some((path) => path === "" || holdsHiddenText(path))) return null;
  return `${paths.map(quotedPath).join(" ")} `;
}
