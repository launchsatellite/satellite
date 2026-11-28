import { describe, expect, it } from "vitest";
import { windowsCommandLine, windowsPty } from "./pty.ts";

describe("windowsPty", () => {
  it("names the backend node-pty picks from the Windows build, and nothing elsewhere", () => {
    expect(windowsPty("win32", "10.0.22631")).toEqual({ backend: "conpty", buildNumber: 22631 });
    expect(windowsPty("win32", "10.0.17763")).toEqual({ backend: "winpty", buildNumber: 17763 });
    expect(windowsPty("win32", "10.0")).toBeNull();
    expect(windowsPty("darwin", "25.5.0")).toBeNull();
  });
});

function parsedCommandLine(line: string): string[] {
  const args: string[] = [];
  let arg: string | undefined;
  let quoted = false;
  for (let at = 0; at < line.length; at += 1) {
    let slashes = 0;
    while (line[at] === "\\") {
      slashes += 1;
      at += 1;
    }
    const char = line[at];
    if (char === '"') {
      arg = (arg ?? "") + "\\".repeat(Math.floor(slashes / 2));
      if (slashes % 2 === 1) arg += '"';
      else quoted = !quoted;
      continue;
    }
    if (slashes > 0) arg = (arg ?? "") + "\\".repeat(slashes);
    if (char === undefined) break;
    if ((char === " " || char === "\t") && !quoted) {
      if (arg !== undefined) args.push(arg);
      arg = undefined;
    } else {
      arg = (arg ?? "") + char;
    }
  }
  if (arg !== undefined) args.push(arg);
  return args;
}

describe("windowsCommandLine", () => {
  it("lets a program read back exactly the arguments it was given, shell characters included", () => {
    const args = [
      "--session-id",
      "C:\\Program Files\\",
      '"fix this"',
      'a\\"b \\\\" c',
      "one\ntwo & three | %PATH% ^ < > !x!",
      "",
      "\\\\server\\share\\",
    ];
    expect(parsedCommandLine(windowsCommandLine(args))).toEqual(args);
  });
});
