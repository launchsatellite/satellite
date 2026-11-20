export const workspaceNameLimit = 48;
export const workspaceNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const reservedWorkspaceNames = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 10 }, (_, digit) => `com${String(digit)}`),
  ...Array.from({ length: 10 }, (_, digit) => `lpt${String(digit)}`),
]);

const branchLimit = 255;
const startPrefixes = ["refs/heads/", "refs/remotes/"];
const forbiddenInBranch = /[~^:?*[\\]|\.\.|@\{|\/\//;

function hasControlOrSpace(name: string): boolean {
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function workspaceNameProblem(name: string): string | null {
  if (name === "") return "Give the workspace a name.";
  if (name.length > workspaceNameLimit) return "Keep the name to 48 characters or fewer.";
  if (!workspaceNamePattern.test(name)) {
    return "Use lowercase letters, digits and single hyphens, like fix-login.";
  }
  if (reservedWorkspaceNames.has(name)) {
    return `${name} is a name Windows keeps for itself. Pick another.`;
  }
  return null;
}

export function isBranchName(name: string): boolean {
  if (name === "" || name.length > branchLimit || name === "@") return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) {
    return false;
  }
  if (forbiddenInBranch.test(name) || hasControlOrSpace(name)) return false;
  return name
    .split("/")
    .every((component) => !component.startsWith(".") && !component.endsWith(".lock"));
}

export function isStartRef(ref: string): boolean {
  const prefix = startPrefixes.find((candidate) => ref.startsWith(candidate));
  return prefix !== undefined && isBranchName(ref.slice(prefix.length));
}
