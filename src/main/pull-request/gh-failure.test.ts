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
    expect(
      ghFailure(run(1, "To get started with GitHub CLI, please run:  gh auth login"), undefined),
    ).toBe("signed-out");
    expect(ghFailure(run(1, 'no pull requests found for branch "x"\n'), undefined)).toBe("none");
    expect(ghFailure(run(1, "no git remotes found"), undefined)).toBe("not-pushed");
    expect(ghFailure(run(1, 'Unknown JSON field: "headRefOid"'), undefined)).toBe("gh-old");
    expect(ghFailure(run(1, "unknown flag: --jq"), undefined)).toBe("gh-old");
    expect(
      ghFailure(
        run(
          1,
          "none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`",
        ),
        undefined,
      ),
    ).toBe("other-host");
    expect(
      ghFailure(
        run(1, "set the GH_HOST environment variable to specify which GitHub host to use"),
        undefined,
      ),
    ).toBe("other-host");
    expect(ghFailure(run(1, "could not find any host configurations"), undefined)).toBe(
      "other-host",
    );
    expect(ghFailure(run(1, "API rate limit exceeded for user"), undefined)).toBe("rate-limited");
    for (const line of [
      "dial tcp: lookup api.github.com: no such host",
      'Post "https://api.github.com/graphql": proxyconnect tcp: dial tcp 127.0.0.1:1: connect: connection refused',
      'Get "https://api.github.com/repos/o/r": dial tcp 10.0.0.1:443: connect: network is unreachable',
      'Post "https://api.github.com/graphql": net/http: TLS handshake timeout',
      'Get "https://api.github.com/x": dial tcp 1.2.3.4:443: i/o timeout',
      "error connecting to api.github.com",
    ]) {
      expect(ghFailure(run(1, line), undefined), line).toBe("offline");
    }
    expect(ghFailure(run(1, "something odd"), undefined)).toBe("failed");
    expect(ghFailure(run(2, ""), undefined)).toBe("failed");
    expect(ghFailure(undefined, "stopped")).toBe("failed");
  });

  it("lets text a repository controls never choose the result", () => {
    const echoed = [
      "failed to run git: fatal: detected dubious ownership in repository at '/work/rate limit/gh auth login'",
      "failed to run git: fatal: not a git repository (or any of the parent directories): .git",
      "error: /work/no git remotes found/dial tcp",
    ];
    for (const line of echoed) expect(ghFailure(run(1, line), undefined), line).toBe("failed");
  });

  it("reads the real signed out and rate limit sentences", () => {
    const signedOut =
      "HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login";
    expect(ghFailure(run(1, signedOut), undefined)).toBe("signed-out");
    expect(
      ghFailure(run(1, "GraphQL: API rate limit already exceeded for user ID 1."), undefined),
    ).toBe("rate-limited");
    expect(
      ghFailure(run(1, "HTTP 403: You have exceeded a secondary rate limit."), undefined),
    ).toBe("rate-limited");
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
