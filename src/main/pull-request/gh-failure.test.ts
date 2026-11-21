import { describe, expect, it } from "vitest";
import { ghFailure } from "./gh-failure.ts";

const run = (exitCode: number, stderr: string) => ({ exitCode, stdout: "", stderr });

describe("ghFailure", () => {
  it("reads every row of the table in order", () => {
    expect(ghFailure(undefined, undefined)).toBe("gh-missing");
    expect(ghFailure(undefined, "time")).toBe("hung");
    expect(ghFailure(undefined, "output")).toBe("hung");
    expect(ghFailure(run(1, ""), "time")).toBe("hung");
    expect(ghFailure(run(4, "anything"), undefined)).toBe("signed-out");
    expect(ghFailure(run(1, "To get started, please run:  gh auth login"), undefined)).toBe(
      "signed-out",
    );
    expect(ghFailure(run(1, 'no pull requests found for branch "x"\n'), undefined)).toBe("none");
    expect(ghFailure(run(1, "no git remotes found"), undefined)).toBe("not-pushed");
    expect(ghFailure(run(1, 'Unknown JSON field: "headRefOid"'), undefined)).toBe("gh-old");
    expect(ghFailure(run(1, "unknown flag: --jq"), undefined)).toBe("gh-old");
    expect(
      ghFailure(
        run(
          1,
          "none of the git remotes configured for this repository point to a known GitHub host",
        ),
        undefined,
      ),
    ).toBe("other-host");
    expect(ghFailure(run(1, "API rate limit exceeded for user"), undefined)).toBe("rate-limited");
    for (const line of [
      "dial tcp: lookup api.github.com: no such host",
      "connection refused",
      "network is unreachable",
      "i/o timeout",
      "TLS handshake timeout",
      "error connecting to api.github.com",
    ]) {
      expect(ghFailure(run(1, line), undefined), line).toBe("offline");
    }
    expect(ghFailure(run(1, "something odd"), undefined)).toBe("failed");
    expect(ghFailure(run(2, ""), undefined)).toBe("failed");
    expect(ghFailure(undefined, "stopped")).toBe("failed");
  });

  it("matches a no pull requests line only at the start", () => {
    expect(ghFailure(run(1, 'x no pull requests found for branch "x"'), undefined)).toBe("failed");
  });

  it("a rate limit line that also holds a network word is rate-limited", () => {
    expect(ghFailure(run(1, "API rate limit exceeded, dial tcp i/o timeout"), undefined)).toBe(
      "rate-limited",
    );
  });

  it("puts a signed-out answer before every later row", () => {
    expect(ghFailure(run(4, "no pull requests found"), undefined)).toBe("signed-out");
  });
});
