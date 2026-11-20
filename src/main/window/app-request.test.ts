import { describe, expect, it } from "vitest";
import { requestedPath } from "./app-request.ts";

describe("requestedPath", () => {
  it("serves the entry for the bare origin and decodes the path", () => {
    expect(requestedPath("GET", "app://satellite/")).toBe("/index.html");
    expect(requestedPath("GET", "app://satellite/assets/a%20b.js")).toBe("/assets/a b.js");
  });

  it("refuses every method but GET", () => {
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      expect(requestedPath(method, "app://satellite/index.html")).toBeUndefined();
    }
  });

  it("refuses any host but satellite", () => {
    expect(requestedPath("GET", "app://other/index.html")).toBeUndefined();
    expect(requestedPath("GET", "app://satellite.evil/index.html")).toBeUndefined();
    expect(requestedPath("GET", "app://satellite:8080/index.html")).toBeUndefined();
  });

  it("refuses a path that does not decode", () => {
    expect(requestedPath("GET", "app://satellite/%E0%A4%A")).toBeUndefined();
  });
});
