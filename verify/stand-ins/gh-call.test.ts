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
    expect(callOf(viewArguments(7))).toBe("pull-request");
    expect(callOf(threadsArguments(place, "alpha", false))).toBe("threads");
    expect(callOf(logArguments(place, "2001"))).toBe("failed-log");

    const threads = threadsArguments(place, "alpha", true);
    const log = logArguments(place, "2001");
    const withValue = (args: string[], index: number, value: string) =>
      args.map((arg, at) => (at === index ? value : arg));
    for (const args of [
      [],
      ["pr", "view"],
      ["pr", "view", "0", ...viewArguments().slice(2)],
      ["pr", "view", "07", ...viewArguments().slice(2)],
      ["pr", "view", "-R", "evil/x", ...viewArguments().slice(2)],
      [...viewArguments(), "--web"],
      withValue(viewArguments(), 5, `${viewProjection} `),
      [...threads, "--paginate"],
      withValue(threads, 3, "-oProxyCommand=x"),
      withValue(threads, 3, "github.com:8443"),
      withValue(threads, 5, "owner=-bad"),
      withValue(threads, 7, "repo=.."),
      withValue(threads, 9, "head=-oProxyCommand=x"),
      withValue(threads, 9, "head=a b"),
      withValue(threads, 11, "number=0"),
      withValue(threads, 11, "number=1a"),
      withValue(threads, 13, "detail=yes"),
      withValue(threads, 15, `query=${threadsQuery}x`),
      withValue(threads, 15, `query=${threadsQuery.replace("isResolved", "isResolveD")}`),
      withValue(threads, 2, "--hostnames"),
      [...log, "--extra"],
      [...log, "--method", "DELETE"],
      withValue(log, 1, "--hostnames"),
      withValue(log, 2, "-oProxyCommand=x"),
      withValue(log, 3, "repos/example-org/verify-repo/actions/jobs/20a1/logs"),
      withValue(log, 3, "repos/example-org/verify-repo/actions/jobs/2001/logs?per_page=1"),
      withValue(log, 3, "repos/example-org/verify-repo/actions/jobs/2001/logs/extra"),
      withValue(log, 3, "repos/example-org/../actions/jobs/2001/logs"),
      withValue(log, 3, "repos/example-org/verify-repo/actions/runs/2001/logs"),
      withValue(log, 3, "repos/example-org/verify-repo/actions/jobs/2001/rerun"),
      withValue(log, 3, "orgs/example-org/actions/secrets"),
      withValue(log, 3, "user"),
      ["pr", "list"],
      ["api", "graphql", "--hostname", "-oProxyCommand=x"],
      ["run", "rerun", "2001"],
    ]) {
      expect(callOf(args), args.join(" ")).toBeNull();
    }
  });
});
