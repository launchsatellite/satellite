import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "lint/**/*.test.ts", "verify/**/*.test.ts"],
    environment: "node",
    globalSetup: ["scripts/test-temp.ts"],
    testTimeout: 20_000,
  },
});
