import { describe, expect, it } from "vitest";
import { satelliteHome } from "./satellite-home.ts";

describe("satelliteHome", () => {
  it("refuses a Windows path that depends on the current drive", () => {
    expect(() => satelliteHome({ SATELLITE_HOME: "\\data" }, "win32")).toThrow(/SATELLITE_HOME/);
    expect(() => satelliteHome({ SATELLITE_HOME: "C:data" }, "win32")).toThrow(/SATELLITE_HOME/);
  });

  it("accepts a Windows path with a drive letter or a UNC share", () => {
    expect(satelliteHome({ SATELLITE_HOME: "C:\\data" }, "win32")).toBe("C:\\data");
    expect(satelliteHome({ SATELLITE_HOME: "\\\\server\\share\\data" }, "win32")).toBe(
      "\\\\server\\share\\data",
    );
  });

  it("refuses a relative path", () => {
    expect(() => satelliteHome({ SATELLITE_HOME: "data" }, "linux")).toThrow(/SATELLITE_HOME/);
  });
});
