import { describe, expect, it } from "vitest";
import {
  callOf,
  logArguments,
  placeOf,
  threadsArguments,
  threadsQuery,
  viewArguments,
  viewFields,
  viewProjection,
  type PullRequestPlace,
} from "./gh-arguments.ts";

const place: PullRequestPlace = {
  host: "github.com",
  owner: "example-org",
  repo: "verify-repo",
  number: 12,
};
const address = "https://github.com/example-org/verify-repo/pull/12";

describe("the arguments", () => {
  it("the view arguments are one constant array", () => {
    expect(viewArguments()).toEqual(["pr", "view", "--json", viewFields, "--jq", viewProjection]);
    expect(viewArguments()).toEqual(viewArguments());
  });

  it("the threads arguments carry only a checked host, owner, repository and number", () => {
    expect(threadsArguments(place)).toEqual([
      "api",
      "graphql",
      "--hostname",
      "github.com",
      "-f",
      "owner=example-org",
      "-f",
      "repo=verify-repo",
      "-F",
      "number=12",
      "-f",
      `query=${threadsQuery}`,
    ]);
  });

  it("the log arguments name the job and the repository with its host", () => {
    expect(logArguments(place, "2001")).toEqual([
      "run",
      "view",
      "--job",
      "2001",
      "--log-failed",
      "-R",
      "github.com/example-org/verify-repo",
    ]);
  });
});

describe("placeOf", () => {
  it("reads the place of a pull request address", () => {
    expect(placeOf(address)).toEqual(place);
    expect(placeOf("https://ghe.example.com/a-b/c_d.e/pull/9999999999")).toEqual({
      host: "ghe.example.com",
      owner: "a-b",
      repo: "c_d.e",
      number: 9999999999,
    });
  });

  it("reads an owner with an underscore", () => {
    expect(placeOf("https://github.com/octo_corp/repo/pull/4")?.owner).toBe("octo_corp");
    expect(placeOf("https://github.com/_octo/repo/pull/4")).toBeNull();
  });

  it("refuses http, user info, a port, a query, a hash, another path, a dot repository, a host outside the pattern and a number of zero", () => {
    for (const url of [
      "http://github.com/example-org/verify-repo/pull/12",
      "https://user@github.com/example-org/verify-repo/pull/12",
      "https://user:secret@github.com/example-org/verify-repo/pull/12",
      "https://github.com:8443/example-org/verify-repo/pull/12",
      `${address}?x=1`,
      `${address}?`,
      `${address}#discussion_r1`,
      `${address}#`,
      `${address}/files`,
      `${address}/`,
      "https://github.com/example-org/verify-repo/issues/12",
      "https://github.com/example-org/verify-repo/pull/0",
      "https://github.com/example-org/verify-repo/pull/012",
      "https://github.com/example-org/verify-repo/pull/12345678901",
      "https://github.com/example-org/./pull/12",
      "https://github.com/example-org/../pull/12",
      "https://github.com/-example/verify-repo/pull/12",
      "https://github.com/example org/verify-repo/pull/12",
      "https://exa mple.com/example-org/verify-repo/pull/12",
      "https://-bad.example.com/example-org/verify-repo/pull/12",
      "https://github.com\\@evil.example/example-org/verify-repo/pull/12",
      "file:///example-org/verify-repo/pull/12",
      "javascript:alert(1)",
      "not an address",
      "",
    ]) {
      expect(placeOf(url), url).toBeNull();
    }
  });
});

describe("callOf", () => {
  it("names what the builders make and nothing else", () => {
    expect(callOf(viewArguments())).toBe("pull-request");
    expect(callOf(threadsArguments(place))).toBe("threads");
    expect(callOf(logArguments(place, "2001"))).toBe("failed-log");

    const threads = threadsArguments(place);
    const log = logArguments(place, "2001");
    const withValue = (args: string[], index: number, value: string) =>
      args.map((arg, at) => (at === index ? value : arg));
    for (const args of [
      [],
      ["pr", "view"],
      [...viewArguments(), "--web"],
      withValue(viewArguments(), 5, `${viewProjection} `),
      [...threads, "--paginate"],
      withValue(threads, 3, "-oProxyCommand=x"),
      withValue(threads, 3, "github.com:8443"),
      withValue(threads, 5, "owner=-bad"),
      withValue(threads, 7, "repo=.."),
      withValue(threads, 9, "number=0"),
      withValue(threads, 9, "number=1a"),
      withValue(threads, 11, `query=${threadsQuery}x`),
      withValue(threads, 11, `query=${threadsQuery.replace("isResolved", "isResolveD")}`),
      withValue(threads, 2, "--hostnames"),
      [...log, "--extra"],
      withValue(log, 3, "20a1"),
      withValue(log, 3, "--repo"),
      withValue(log, 6, "example-org/verify-repo"),
      withValue(log, 6, "github.com/example-org/verify-repo/extra"),
      withValue(log, 6, "github.com/example-org/.."),
      withValue(log, 6, "--hostname/x/y"),
      withValue(log, 5, "--repo"),
      withValue(log, 4, "--log"),
      ["pr", "list"],
      ["api", "graphql", "--hostname", "-oProxyCommand=x"],
      ["run", "rerun", "2001"],
    ]) {
      expect(callOf(args), args.join(" ")).toBeNull();
    }
  });
});
