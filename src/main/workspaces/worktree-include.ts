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

type CompiledSegment = Token[] | "globstar" | "never";

interface CompiledPattern {
  negated: boolean;
  directoryOnly: boolean;
  segments: CompiledSegment[];
}

const patternLimit = 1000;
const patternLength = 4096;
const segmentLimit = 64;

function backslashesBefore(text: string, end: number): number {
  let count = 0;
  while (text[end - 1 - count] === "\\") count += 1;
  return count;
}

function trimTrailingSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === " " && backslashesBefore(line, end - 1) % 2 === 0) end -= 1;
  return line.slice(0, end);
}

function parseLine(line: string): IncludePattern | undefined {
  if (line.startsWith("#") || line.length > patternLength) return undefined;
  let pattern = trimTrailingSpaces(line);
  if (backslashesBefore(pattern, pattern.length) % 2 === 1) return undefined;
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
  if (segments.length > segmentLimit) return undefined;
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
    } else if (character === "[") {
      const parsed = parseClass(characters, index);
      if (parsed === undefined) return "never";
      tokens.push(parsed.token);
      index = parsed.next;
    } else {
      tokens.push({ kind: "literal", character });
      index += 1;
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

function matchesSegment(segment: CompiledSegment, characters: readonly string[]): boolean {
  if (segment === "globstar") return true;
  if (segment === "never") return false;
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

function matchedPrefixes(
  pattern: readonly CompiledSegment[],
  path: readonly (readonly string[])[],
): Uint8Array {
  let reached = new Uint8Array(path.length + 1);
  let next = new Uint8Array(path.length + 1);
  reached[0] = 1;
  for (const [patternIndex, segment] of pattern.entries()) {
    next.fill(0);
    if (segment === "globstar") {
      const first = reached.indexOf(1);
      if (first >= 0) next.fill(1, patternIndex === pattern.length - 1 ? first + 1 : first);
    } else {
      for (let index = 1; index <= path.length; index += 1) {
        if (reached[index - 1] === 1 && matchesSegment(segment, path[index - 1] ?? [])) {
          next[index] = 1;
        }
      }
    }
    [reached, next] = [next, reached];
    if (!reached.includes(1)) break;
  }
  return reached;
}

function decidesAnyLevel(
  patterns: readonly CompiledPattern[],
  path: readonly (readonly string[])[],
  isDirectory: boolean,
): boolean {
  const decided = new Array<boolean | undefined>(path.length + 1);
  let open = path.length;
  for (let index = patterns.length - 1; index >= 0 && open > 0; index -= 1) {
    const pattern = patterns[index];
    if (pattern === undefined) continue;
    const reached = matchedPrefixes(pattern.segments, path);
    const deepest = pattern.directoryOnly && !isDirectory ? path.length - 1 : path.length;
    for (let length = 1; length <= deepest; length += 1) {
      if (decided[length] === undefined && reached[length] === 1) {
        decided[length] = !pattern.negated;
        open -= 1;
      }
    }
  }
  return decided.includes(true);
}

function reachesInside(pattern: CompiledPattern, folder: readonly (readonly string[])[]): boolean {
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

function characterSegments(path: string): string[][] {
  return path.split("/").map((name) => Array.from(name));
}

export function parseWorktreeInclude(text: string): IncludePattern[] {
  const patterns: IncludePattern[] = [];
  const withoutMark = text.startsWith("\uFEFF") ? text.slice(1) : text;
  for (const line of withoutMark.split("\n").map((raw) => raw.replace(/\r$/, ""))) {
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
      return decidesAnyLevel(compiled, characterSegments(path), isDirectory);
    },
    reaches(directory) {
      const folder = characterSegments(directory);
      return compiled.some((pattern) => !pattern.negated && reachesInside(pattern, folder));
    },
  };
}
