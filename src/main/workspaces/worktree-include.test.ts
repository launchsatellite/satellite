import { describe, expect, it } from "vitest";
import { createIncludeMatcher, parseWorktreeInclude } from "./worktree-include.ts";

function matcher(text: string): ReturnType<typeof createIncludeMatcher> {
  return createIncludeMatcher(parseWorktreeInclude(text));
}

describe("parseWorktreeInclude", () => {
  it("reads comments, escapes and trailing spaces", () => {
    expect(parseWorktreeInclude("# note\n\\#hash\r\n\\!bang\ntrail   \nkeep\\ \n   \n!\n")).toEqual(
      [
        { negated: false, directoryOnly: false, anchored: false, segments: ["**", "#hash"] },
        { negated: false, directoryOnly: false, anchored: false, segments: ["**", "!bang"] },
        { negated: false, directoryOnly: false, anchored: false, segments: ["**", "trail"] },
        { negated: false, directoryOnly: false, anchored: false, segments: ["**", "keep\\ "] },
      ],
    );
    const escaped = matcher("\\#hash\n\\!bang\nkeep\\ \n");
    expect(escaped.matches("#hash", false)).toBe(true);
    expect(escaped.matches("!bang", false)).toBe(true);
    expect(escaped.matches("keep ", false)).toBe(true);
    expect(escaped.matches("keep", false)).toBe(false);
  });

  it("reads lines the way git does", () => {
    expect(matcher("\u{feff}local.json\n").matches("local.json", false)).toBe(true);
    expect(matcher("local.json\r").matches("local.json", false)).toBe(true);
    expect(matcher("foo\\\\  \n").matches("foo\\", false)).toBe(true);
    expect(parseWorktreeInclude("dangling\\\n")).toEqual([]);
  });

  it("drops patterns too long or too deep to match quickly", () => {
    const segments = (count: number): string => Array.from({ length: count }, () => "a").join("/");
    expect(parseWorktreeInclude(`${"a".repeat(4097)}\n`)).toEqual([]);
    expect(parseWorktreeInclude(`${segments(65)}\n`)).toEqual([]);
    expect(parseWorktreeInclude(`${segments(64)}\n`)).toHaveLength(1);
  });

  it("keeps at most 1000 patterns", () => {
    const text = Array.from({ length: 1500 }, (_, index) => `file-${String(index)}`).join("\n");
    expect(parseWorktreeInclude(text)).toHaveLength(1000);
  });
});

describe("createIncludeMatcher", () => {
  it("matches an unanchored name at any depth", () => {
    const env = matcher(".env\n");
    expect(env.matches(".env", false)).toBe(true);
    expect(env.matches("sub/.env", false)).toBe(true);
    expect(env.matches("sub/.env.local", false)).toBe(false);
    expect(env.matches("sub/.env/file", false)).toBe(true);
  });

  it("anchors patterns with a slash", () => {
    const config = matcher("config/*.local.json\n/root.txt\n");
    expect(config.matches("config/dev.local.json", false)).toBe(true);
    expect(config.matches("config/a/dev.local.json", false)).toBe(false);
    expect(config.matches("other/config/dev.local.json", false)).toBe(false);
    expect(config.matches("root.txt", false)).toBe(true);
    expect(config.matches("sub/root.txt", false)).toBe(false);
  });

  it("matches folders only with a trailing slash", () => {
    const build = matcher("build/\n");
    expect(build.matches("build", true)).toBe(true);
    expect(build.matches("build", false)).toBe(false);
    expect(build.matches("build/out.js", false)).toBe(true);
    expect(build.matches("sub/build", true)).toBe(true);
  });

  it("lets a later negation win", () => {
    const env = matcher(".env*\n!.env.example\n");
    expect(env.matches(".env.local", false)).toBe(true);
    expect(env.matches(".env.example", false)).toBe(false);
    expect(matcher("!.env\n.env\n").matches(".env", false)).toBe(true);
    expect(matcher("secrets/\n!secrets/\n").matches("secrets/key", false)).toBe(false);
  });

  it("matches double stars", () => {
    expect(matcher("**/x.json\n").matches("a/b/x.json", false)).toBe(true);
    expect(matcher("**/x.json\n").matches("x.json", false)).toBe(true);
    const between = matcher("a/**/b.json\n");
    expect(between.matches("a/b.json", false)).toBe(true);
    expect(between.matches("a/x/y/b.json", false)).toBe(true);
    expect(between.matches("z/a/b.json", false)).toBe(false);
    const logs = matcher("logs/**\n");
    expect(logs.matches("logs/a/b.txt", false)).toBe(true);
    expect(logs.matches("logs", false)).toBe(false);
  });

  it("matches classes and single characters", () => {
    expect(matcher("[ab].txt\n").matches("a.txt", false)).toBe(true);
    expect(matcher("[ab].txt\n").matches("c.txt", false)).toBe(false);
    expect(matcher("[!ab].txt\n").matches("c.txt", false)).toBe(true);
    expect(matcher("[!ab].txt\n").matches("a.txt", false)).toBe(false);
    expect(matcher("[^a-c].txt\n").matches("b.txt", false)).toBe(false);
    expect(matcher("[a-c].txt\n").matches("b.txt", false)).toBe(true);
    expect(matcher("[]x].txt\n").matches("].txt", false)).toBe(true);
    expect(matcher("[ab.txt\n").matches("[ab.txt", false)).toBe(false);
    expect(matcher("file?.txt\n").matches("file1.txt", false)).toBe(true);
    expect(matcher("file?.txt\n").matches("file.txt", false)).toBe(false);
    expect(matcher("\\*.txt\n").matches("a.txt", false)).toBe(false);
    expect(matcher("\\*.txt\n").matches("*.txt", false)).toBe(true);
    expect(matcher("*\n").matches("a/b", false)).toBe(true);
  });

  it("stays fast on patterns built to backtrack", () => {
    const stars = matcher(`${"*a".repeat(40)}b\n${"**/".repeat(200)}z\n`);
    const started = performance.now();
    expect(stars.matches("a".repeat(200), false)).toBe(false);
    expect(stars.matches(Array.from({ length: 60 }, () => "q").join("/"), false)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("matches a deep path against a full hostile file in one pass", () => {
    const run = Array.from({ length: 12 }, () => "a").join("/");
    const hostile = Array.from(
      { length: 1000 },
      (_, index) => `n/**/${run}/z${String(index)}`,
    ).join("\n");
    expect(hostile.length).toBeLessThan(65536);
    const include = matcher(hostile);
    const deep = `n/${Array.from({ length: 60 }, () => "a").join("/")}`;
    const started = performance.now();
    for (let entry = 0; entry < 10; entry += 1) {
      expect(include.matches(`${deep}/f${String(entry)}`, false)).toBe(false);
    }
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("reaches into an ignored folder only as the docs say", () => {
    expect(matcher(".env\n").reaches("node_modules/x")).toBe(false);
    expect(matcher("vendor/**/config.json\n").reaches("vendor")).toBe(true);
    expect(matcher("vendor/**/config.json\n").reaches("vendor/a/b")).toBe(true);
    expect(matcher("vendor/**/config.json\n").reaches("other")).toBe(false);
    expect(matcher("**/.claude/skills/*.md\n").reaches(".claude")).toBe(true);
    expect(matcher("**/.claude/skills/*.md\n").reaches("sub/.claude")).toBe(true);
    expect(matcher("**/config.json\n").reaches("vendor")).toBe(false);
    expect(matcher("config/*.local.json\n").reaches("config")).toBe(true);
    expect(matcher("config/*.local.json\n").reaches("config/a")).toBe(false);
    expect(matcher("!vendor/**/config.json\n").reaches("vendor")).toBe(false);
    expect(matcher("node_modules/\n").matches("node_modules", true)).toBe(true);
  });
});
