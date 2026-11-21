import { describe, expect, it } from "vitest";
import { checksOf, countsOf } from "./check-result.ts";
import type { PullRequestPlace } from "./gh-arguments.ts";

const place: PullRequestPlace = {
  host: "github.com",
  owner: "example-org",
  repo: "verify-repo",
  number: 12,
};
const job = "https://github.com/example-org/verify-repo/actions/runs/1001/job/2001";
const run = (conclusion: string | null, status = "COMPLETED") => ({
  name: "build",
  workflow: "ci",
  status,
  conclusion,
});
const status = (state: string) => ({ context: "ci/status", state });
const resultOf = (raw: unknown) => checksOf([raw], place)[0]?.result;

describe("the check table", () => {
  it("reads a check run by its status and conclusion", () => {
    expect(resultOf(run(null, "IN_PROGRESS"))).toBe("pending");
    expect(resultOf(run(null, "QUEUED"))).toBe("pending");
    expect(resultOf(run("SUCCESS"))).toBe("passed");
    expect(resultOf(run("NEUTRAL"))).toBe("skipped");
    expect(resultOf(run("SKIPPED"))).toBe("skipped");
    for (const conclusion of ["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]) {
      expect(resultOf(run(conclusion)), conclusion).toBe("failed");
    }
    expect(resultOf(run("CANCELLED"))).toBe("cancelled");
    expect(resultOf(run("STALE"))).toBe("cancelled");
    expect(resultOf(run("SOMETHING_NEW"))).toBe("unknown");
    expect(resultOf(run(null))).toBe("unknown");
    expect(resultOf({ name: "build" })).toBe("unknown");
  });

  it("reads a status by its state", () => {
    expect(resultOf(status("SUCCESS"))).toBe("passed");
    expect(resultOf(status("FAILURE"))).toBe("failed");
    expect(resultOf(status("ERROR"))).toBe("failed");
    expect(resultOf(status("PENDING"))).toBe("pending");
    expect(resultOf(status("EXPECTED"))).toBe("pending");
    expect(resultOf(status("WEIRD"))).toBe("unknown");
    expect(checksOf([status("SUCCESS")], place)[0]).toMatchObject({
      name: "ci/status",
      workflow: null,
    });
  });

  it("keeps the newest of two runs with the same workflow and name", () => {
    const checks = checksOf(
      [
        { ...run("FAILURE"), startedAt: "2026-01-01T00:00:00Z" },
        { ...run("SUCCESS"), startedAt: "2026-01-02T00:00:00Z" },
        { ...run("FAILURE"), startedAt: "2026-01-01T12:00:00Z" },
        { ...run("FAILURE"), workflow: "other", startedAt: "2026-01-01T00:00:00Z" },
      ],
      place,
    );
    expect(checks.map(({ workflow, result }) => [workflow, result])).toEqual([
      ["other", "failed"],
      ["ci", "passed"],
    ]);
  });

  it("keeps the newest status per context", () => {
    const checks = checksOf(
      [
        { ...status("SUCCESS"), startedAt: "2026-01-02T00:00:00Z" },
        { ...status("FAILURE"), startedAt: "2026-01-01T00:00:00Z" },
        { context: "other", state: "PENDING" },
      ],
      place,
    );
    expect(checks.map(({ name, result }) => [name, result])).toEqual([
      ["other", "pending"],
      ["ci/status", "passed"],
    ]);
  });

  it("sorts failed first then pending, each by workflow then name", () => {
    const checks = checksOf(
      [
        { name: "z", workflow: "a", status: "COMPLETED", conclusion: "SUCCESS" },
        { name: "b", workflow: "b", status: "COMPLETED", conclusion: "FAILURE" },
        { name: "a", workflow: "b", status: "COMPLETED", conclusion: "FAILURE" },
        { name: "p", workflow: "a", status: "IN_PROGRESS" },
        { name: "c", workflow: "a", status: "COMPLETED", conclusion: "FAILURE" },
        { name: "a", workflow: "a", status: "COMPLETED", conclusion: "SKIPPED" },
      ],
      place,
    );
    expect(checks.map(({ workflow, name }) => `${workflow ?? ""}/${name}`)).toEqual([
      "a/c",
      "b/a",
      "b/b",
      "a/p",
      "a/a",
      "a/z",
    ]);
  });

  it("sets run and job only for an Actions address on the pull request's own host and repository", () => {
    expect(checksOf([{ ...run("FAILURE"), url: job }], place)[0]).toMatchObject({
      url: job,
      run: "1001",
      job: "2001",
    });
    for (const url of [
      "https://evil.example.com/example-org/verify-repo/actions/runs/1001/job/2001",
      "https://github.com/other-org/verify-repo/actions/runs/1001/job/2001",
      "https://github.com/example-org/verify-repo-x/actions/runs/1001/job/2001",
      "https://github.com/example-org/verify-repo/actions/runs/1001",
      "https://github.com/example-org/verify-repo/actions/runs/1001/job/20a1",
      "https://github.com/example-org/verify-repo/actions/runs/1001/job/2001/extra",
      "https://github.com/example-org/verify-repo/runs/2001",
    ]) {
      const [check] = checksOf([{ ...run("FAILURE"), url }], place);
      expect(check, url).toMatchObject({ url, run: null, job: null });
    }
  });

  it("drops an address that is not https or is too long", () => {
    for (const url of [
      "http://github.com/x",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "not an address",
      `https://github.com/${"a".repeat(2048)}`,
    ]) {
      expect(checksOf([{ ...run("FAILURE"), url }], place)[0]?.url, url).toBeNull();
    }
    expect(checksOf([run("FAILURE")], place)[0]?.url).toBeNull();
  });

  it("counts before the cut to 100", () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      name: `check-${String(index)}`,
      workflow: "ci",
      status: "COMPLETED",
      conclusion: index < 5 ? "FAILURE" : index < 10 ? "SKIPPED" : "SUCCESS",
    }));
    const checks = checksOf(many, place);
    expect(checks).toHaveLength(150);
    expect(countsOf(checks)).toEqual({ failed: 5, pending: 0, passed: 145, total: 150 });
  });

  it("answers nothing for input that is not a list of objects", () => {
    expect(checksOf(null, place)).toEqual([]);
    expect(checksOf("x", place)).toEqual([]);
    expect(checksOf([1, null, "x"], place)).toEqual([]);
  });

  it("bounds a name and writes a missing one as empty", () => {
    const names = checksOf(
      [
        { ...run("SUCCESS"), name: "n".repeat(400) },
        { status: "COMPLETED", conclusion: "SUCCESS" },
      ],
      place,
    ).map(({ name }) => name.length);
    expect(names.sort()).toEqual([0, 255]);
  });
});
