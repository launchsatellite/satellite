import { describe, expect, it } from "vitest";
import { parseEnvironmentBlock } from "./user-environment.ts";

const marker = "__SATELLITE_ENV__";

describe("parseEnvironmentBlock", () => {
  it("reads the block between markers when the shell prints noise around it", () => {
    const output = `Welcome back!\nnvm loaded\n${marker}PATH=/opt/tools/bin:/usr/bin\0LANG=en_US.UTF-8\0${marker}bye\n`;
    expect(parseEnvironmentBlock(output)).toEqual({
      PATH: "/opt/tools/bin:/usr/bin",
      LANG: "en_US.UTF-8",
    });
  });

  it("keeps values that contain newlines and equals signs", () => {
    const output = `${marker}PROMPT_NOTE=line one\nline two\0OPTIONS=a=1,b=2\0${marker}`;
    expect(parseEnvironmentBlock(output)).toEqual({
      PROMPT_NOTE: "line one\nline two",
      OPTIONS: "a=1,b=2",
    });
  });

  it("returns undefined when a marker is missing", () => {
    expect(parseEnvironmentBlock("PATH=/usr/bin\0")).toBeUndefined();
    expect(parseEnvironmentBlock(`${marker}PATH=/usr/bin\0`)).toBeUndefined();
  });

  it("drops PWD, OLDPWD, SHLVL and _", () => {
    const output = `${marker}PWD=/opt/work\0OLDPWD=/opt\0SHLVL=2\0_=/usr/bin/env\0HOME=/home/<name>\0${marker}`;
    expect(parseEnvironmentBlock(output)).toEqual({ HOME: "/home/<name>" });
  });
});
