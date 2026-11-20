export interface IncludePattern {
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
  segments: string[];
}

export interface IncludeMatcher {
  matches(path: string, isDirectory: boolean): boolean;
  reaches(directory: string): boolean;
}

type Token =
  | { kind: "star" }
  | { kind: "one" }
  | { kind: "literal"; character: string }
  | { kind: "class"; negated: boolean; ranges: [string, string][] };

type CompiledSegment = Token[] | "globstar";

interface CompiledPattern {
  negated: boolean;
  directoryOnly: boolean;
  segments: CompiledSegment[];
}

const patternLimit = 1000;

function trimTrailingSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === " " && line[end - 2] !== "\\") end -= 1;
  return line.slice(0, end);
}

function parseLine(line: string): IncludePattern | undefined {
  if (line.startsWith("#")) return undefined;
  let pattern = trimTrailingSpaces(line);
  let negated = false;
  if (pattern.startsWith("\\#") || pattern.startsWith("\\!")) pattern = pattern.slice(1);
  else if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }
  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);
  const anchored = pattern.includes("/");
  if (pattern.startsWith("/")) pattern = pattern.slice(1);
  if (pattern === "") return undefined;
  const segments = pattern.split("/");
  return { negated, directoryOnly, anchored, segments: anchored ? segments : ["**", ...segments] };
}

function parseClass(
  characters: readonly string[],
  open: number,
): { token: Token; next: number } | undefined {
  let index = open + 1;
  const negated = characters[index] === "!" || characters[index] === "^";
  if (negated) index += 1;
  const ranges: [string, string][] = [];
  let first = true;
  while (index < characters.length) {
    let low = characters[index] ?? "";
    if (low === "]" && !first)
      return { token: { kind: "class", negated, ranges }, next: index + 1 };
    first = false;
    if (low === "\\" && index + 1 < characters.length) {
      index += 1;
      low = characters[index] ?? "";
    }
    const high = characters[index + 2];
    if (characters[index + 1] === "-" && high !== undefined && high !== "]") {
      ranges.push([low, high]);
      index += 3;
    } else {
      ranges.push([low, low]);
      index += 1;
    }
  }
  return undefined;
}

function compileSegment(segment: string): CompiledSegment {
  if (segment === "**") return "globstar";
  const characters = Array.from(segment);
  const tokens: Token[] = [];
  let index = 0;
  while (index < characters.length) {
    const character = characters[index] ?? "";
    if (character === "\\" && index + 1 < characters.length) {
      tokens.push({ kind: "literal", character: characters[index + 1] ?? "" });
      index += 2;
    } else if (character === "*") {
      if (tokens.at(-1)?.kind !== "star") tokens.push({ kind: "star" });
      index += 1;
    } else if (character === "?") {
      tokens.push({ kind: "one" });
      index += 1;
    } else {
      const parsed = character === "[" ? parseClass(characters, index) : undefined;
      tokens.push(parsed?.token ?? { kind: "literal", character });
      index = parsed?.next ?? index + 1;
    }
  }
  return tokens;
}

function matchesOne(token: Token, character: string): boolean {
  if (token.kind === "one") return true;
  if (token.kind === "literal") return token.character === character;
  if (token.kind === "star") return false;
  const inside = token.ranges.some(([low, high]) => low <= character && character <= high);
  return inside !== token.negated;
}

function matchesSegment(segment: CompiledSegment, name: string): boolean {
  if (segment === "globstar") return true;
  const characters = Array.from(name);
  let tokenIndex = 0;
  let nameIndex = 0;
  let starToken = -1;
  let starName = 0;
  while (nameIndex < characters.length) {
    const token = segment[tokenIndex];
    if (token?.kind === "star") {
      starToken = tokenIndex;
      starName = nameIndex;
      tokenIndex += 1;
    } else if (token !== undefined && matchesOne(token, characters[nameIndex] ?? "")) {
      tokenIndex += 1;
      nameIndex += 1;
    } else if (starToken >= 0) {
      tokenIndex = starToken + 1;
      starName += 1;
      nameIndex = starName;
    } else {
      return false;
    }
  }
  while (segment[tokenIndex]?.kind === "star") tokenIndex += 1;
  return tokenIndex === segment.length;
}

function matchesSegments(pattern: readonly CompiledSegment[], path: readonly string[]): boolean {
  let reached = path.map((_, index) => index === 0).concat(path.length === 0);
  pattern.forEach((segment, patternIndex) => {
    const first = reached.indexOf(true);
    if (segment === "globstar") {
      const atLeastOne = patternIndex === pattern.length - 1;
      reached = reached.map(
        (_, index) => first >= 0 && (atLeastOne ? index > first : index >= first),
      );
    } else {
      reached = reached.map(
        (_, index) =>
          index > 0 &&
          reached[index - 1] === true &&
          matchesSegment(segment, path[index - 1] ?? ""),
      );
    }
  });
  return reached[path.length] === true;
}

function decides(
  patterns: readonly CompiledPattern[],
  path: readonly string[],
  isDirectory: boolean,
): boolean {
  for (let index = patterns.length - 1; index >= 0; index -= 1) {
    const pattern = patterns[index];
    if (pattern === undefined || (pattern.directoryOnly && !isDirectory)) continue;
    if (matchesSegments(pattern.segments, path)) return !pattern.negated;
  }
  return false;
}

function reachesInside(pattern: CompiledPattern, folder: readonly string[]): boolean {
  const [head, next] = pattern.segments;
  if (head === "globstar") {
    return next !== undefined && folder.some((name) => matchesSegment(next, name));
  }
  for (const [index, name] of folder.entries()) {
    const segment = pattern.segments[index];
    if (segment === "globstar") return true;
    if (segment === undefined || !matchesSegment(segment, name)) return false;
  }
  return pattern.segments.length > folder.length;
}

export function parseWorktreeInclude(text: string): IncludePattern[] {
  const patterns: IncludePattern[] = [];
  for (const line of text.split(/\r?\n/)) {
    const pattern = parseLine(line);
    if (pattern !== undefined) patterns.push(pattern);
    if (patterns.length === patternLimit) break;
  }
  return patterns;
}

export function createIncludeMatcher(patterns: readonly IncludePattern[]): IncludeMatcher {
  const compiled: CompiledPattern[] = patterns.map((pattern) => ({
    negated: pattern.negated,
    directoryOnly: pattern.directoryOnly,
    segments: pattern.segments.map(compileSegment),
  }));
  return {
    matches(path, isDirectory) {
      const segments = path.split("/");
      for (let length = 1; length < segments.length; length += 1) {
        if (decides(compiled, segments.slice(0, length), true)) return true;
      }
      return decides(compiled, segments, isDirectory);
    },
    reaches(directory) {
      const folder = directory.split("/");
      return compiled.some((pattern) => !pattern.negated && reachesInside(pattern, folder));
    },
  };
}
