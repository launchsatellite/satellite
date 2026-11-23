import { describe, expect, it } from "vitest";
import { codeTypeFor } from "./code-type.ts";

const agents = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142.0 Electron/45.4.1",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Electron/45.4.1",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0 Electron/45.4.1",
};

describe("codeTypeFor", () => {
  it("gives each system its own font, size and terminal line height", () => {
    expect(codeTypeFor(agents.mac)).toEqual({
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      terminalLineHeight: 1,
    });
    expect(codeTypeFor(agents.windows)).toEqual({
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      terminalLineHeight: 1,
    });
    expect(codeTypeFor(agents.linux)).toEqual({
      fontFamily: '"Droid Sans Mono", monospace',
      fontSize: 14,
      terminalLineHeight: 1.1,
    });
  });
});
