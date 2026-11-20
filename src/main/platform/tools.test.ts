import { describe, expect, it } from "vitest";
import { parseToolOverride } from "./tools.ts";

describe("parseToolOverride", () => {
  it("reads a JSON array override as executable and leading arguments", () => {
    expect(
      parseToolOverride("SATELLITE_GH", '["/opt/tools/bin/node","/opt/stand-ins/gh.ts"]'),
    ).toEqual({ file: "/opt/tools/bin/node", args: ["/opt/stand-ins/gh.ts"] });
    expect(parseToolOverride("SATELLITE_CLAUDE", '["/opt/tools/bin/claude"]')).toEqual({
      file: "/opt/tools/bin/claude",
      args: [],
    });
  });

  it("refuses an override that is not a non-empty array of strings and names the variable", () => {
    for (const value of ["/opt/tools/bin/gh", "[]", '[""]', "[1]", '{"file":"gh"}', "["]) {
      expect(() => parseToolOverride("SATELLITE_GH", value)).toThrow(/SATELLITE_GH/);
    }
  });

  it("ignores an unset override", () => {
    expect(parseToolOverride("SATELLITE_GH", undefined)).toBeUndefined();
    expect(parseToolOverride("SATELLITE_GH", "")).toBeUndefined();
  });
});
