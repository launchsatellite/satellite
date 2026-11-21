import { describe, expect, it } from "vitest";
import { scenarioSchema } from "./scenario.ts";

const base = {
  description: "d",
  repo: [],
  claude: { missing: true },
};

describe("scenarioSchema", () => {
  it("accepts a call entry with json and after and refuses an after that is not kebab case", () => {
    const entry = { call: "pull-request", json: { number: 12 }, after: "opened" };
    expect(scenarioSchema.safeParse({ ...base, gh: [entry] }).success).toBe(true);
    expect(scenarioSchema.safeParse({ ...base, gh: [{ call: "threads" }] }).success).toBe(true);
    for (const after of ["Opened", "9up", "a_b", "../x", "a".repeat(42), ""]) {
      expect(scenarioSchema.safeParse({ ...base, gh: [{ ...entry, after }] }).success, after).toBe(
        false,
      );
    }
  });

  it("accepts a number on a call entry and refuses a number that is not a positive integer", () => {
    const entry = { call: "pull-request", number: 12 };
    expect(scenarioSchema.safeParse({ ...base, gh: [entry] }).success).toBe(true);
    for (const number of [0, -1, 1.5, "12"]) {
      expect(scenarioSchema.safeParse({ ...base, gh: [{ ...entry, number }] }).success).toBe(false);
    }
  });

  it("keeps the exact arguments entry and refuses a call that is not one of the three", () => {
    expect(scenarioSchema.safeParse({ ...base, gh: [{ args: ["--version"] }] }).success).toBe(true);
    expect(scenarioSchema.safeParse({ ...base, gh: [{ call: "merge" }] }).success).toBe(false);
  });
});
