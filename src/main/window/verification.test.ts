import { afterEach, describe, expect, it, vi } from "vitest";
import { drivenByVerify } from "./verification.ts";

vi.mock("electron", () => ({ app: {} }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("drivenByVerify", () => {
  it.skipIf(process.getuid?.() === 0)(
    "trusts only a driver pid this user can signal, never one it may not touch",
    () => {
      vi.stubEnv("SATELLITE_VERIFY_FOLDER_DIALOG", "/answer");
      vi.stubEnv("SATELLITE_VERIFY_DRIVER_PID", String(process.pid));
      expect(drivenByVerify()).toBe(true);
      vi.stubEnv("SATELLITE_VERIFY_DRIVER_PID", "1");
      expect(drivenByVerify()).toBe(false);
    },
  );
});
