import { describe, expect, it } from "vitest";
import {
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

  it("the view arguments name a pull request only by its number", () => {
    expect(viewArguments(7)).toEqual([
      "pr",
      "view",
      "7",
      "--json",
      viewFields,
      "--jq",
      viewProjection,
    ]);
  });

  it("the threads arguments carry only a checked host, owner, repository and number", () => {
    expect(threadsArguments(place, "alpha", true)).toEqual([
      "api",
      "graphql",
      "--hostname",
      "github.com",
      "-f",
      "owner=example-org",
      "-f",
      "repo=verify-repo",
      "-f",
      "head=alpha",
      "-F",
      "number=12",
      "-F",
      "detail=true",
      "-f",
      `query=${threadsQuery}`,
    ]);
  });

  it("the log arguments name one job of the repository with its host and use no cache", () => {
    expect(logArguments(place, "2001")).toEqual([
      "api",
      "--hostname",
      "github.com",
      "repos/example-org/verify-repo/actions/jobs/2001/logs",
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
