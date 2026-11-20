import { describe, expect, it } from "vitest";
import { droppedPaths } from "./dropped-paths.ts";

describe("droppedPaths", () => {
  it("types dropped paths the way Claude Code reads them", () => {
    expect(droppedPaths(["/tmp/shot.png"])).toBe("/tmp/shot.png ");
    expect(droppedPaths(["/Users/<name>/shot one.png"])).toBe('"/Users/<name>/shot one.png" ');
    expect(droppedPaths(['/tmp/say "hi".png'])).toBe('"/tmp/say \\"hi\\".png" ');
    expect(droppedPaths(["C:\\Users\\<name>\\shot one.png"])).toBe(
      '"C:\\Users\\<name>\\shot one.png" ',
    );
    expect(droppedPaths(["/tmp/caf\u00e9 \u5199\u771f.png"])).toBe(
      '"/tmp/caf\u00e9 \u5199\u771f.png" ',
    );
    expect(droppedPaths(["/tmp/a.png", "/tmp/b c.png"])).toBe('/tmp/a.png "/tmp/b c.png" ');
  });

  it("keeps every name inside its quotes, even one with backslashes before a quote or at the end", () => {
    expect(droppedPaths(['/tmp/odd\\".png'])).toBe('"/tmp/odd\\\\\\".png" ');
    expect(droppedPaths(["/tmp/a b\\", "/tmp/c.png"])).toBe('"/tmp/a b\\\\" /tmp/c.png ');
    expect(droppedPaths(["/tmp/$(touch x)`id`.png"])).toBe('"/tmp/$(touch x)`id`.png" ');
  });

  it("refuses a name that could submit, run a terminal sequence or hide its text", () => {
    for (const name of [
      "/tmp/a\nb.png",
      "/tmp/a\rb.png",
      "/tmp/a\u001b[201~b.png",
      "/tmp/a\u0085b.png",
      "/tmp/a\u2028b.png",
      "/tmp/\u202egnp.exe",
      "",
    ]) {
      expect(droppedPaths(["/tmp/fine.png", name]), JSON.stringify(name)).toBeNull();
    }
  });
});
