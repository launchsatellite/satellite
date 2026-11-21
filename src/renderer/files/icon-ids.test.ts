import { fileExtensions, folderNames } from "material-icon-theme/dist/material-icons.json";
import { describe, expect, it } from "vitest";
import { fileIconIds, folderIconIds } from "./icon-ids.ts";

describe("icon ids", () => {
  it("gives the default icon to names that are keys of every object", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", ".__proto__"]) {
      expect(fileIconIds(name)).toEqual({ dark: "file", light: "file" });
      expect(folderIconIds(name, false)).toEqual({ dark: "folder", light: "folder" });
    }
  });

  it("prefers the longest extension", () => {
    expect(fileIconIds("button.test.ts").dark).toBe(fileExtensions["test.ts"]);
  });

  it("gives an open folder its open variant", () => {
    expect(folderIconIds("src", true).dark).toBe(`${folderNames.src}-open`);
    expect(folderIconIds("src", false).dark).toBe(folderNames.src);
  });
});
