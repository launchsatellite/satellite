import { describe, expect, it } from "vitest";
import {
  logArguments,
  threadsArguments,
  threadsQuery,
  viewArguments,
  viewProjection,
  type PullRequestPlace,
} from "../../src/main/pull-request/gh-arguments.ts";
import { callOf } from "./gh-call.ts";

const place: PullRequestPlace = {
  host: "github.com",
  owner: "example-org",
  repo: "verify-repo",
  number: 12,
};

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
