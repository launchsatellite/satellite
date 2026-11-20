import { describe, expect, it } from "vitest";
import { parseGhAuthStatus } from "./gh-auth.ts";

const currentFormat = {
  exitCode: 0,
  stdout:
    "github.com\n  ✓ Logged in to github.com account octo-verify (keyring)\n  - Active account: true\n  - Token: gho_************************************\n",
  stderr: "",
};
const olderFormat = {
  exitCode: 0,
  stdout: "",
  stderr:
    "github.com\n  ✓ Logged in to github.com as octo-verify (oauth_token)\n  ✓ Token: gho_************************************\n",
};
const noSignIn = {
  exitCode: 1,
  stdout: "",
  stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n",
};
const failedSignIn = {
  exitCode: 1,
  stdout: "",
  stderr:
    "github.com\n  X Failed to log in to github.com account octo-verify (keyring)\n  - Active account: true\n  - The token in keyring is invalid.\n  - To re-authenticate, run: gh auth login -h github.com\n",
};
const oneHostFailing = {
  exitCode: 1,
  stdout: "",
  stderr:
    "ghe.example.com\n  X Failed to log in to ghe.example.com account octo-work (keyring)\n  - Active account: true\n  - The token in keyring is invalid.\n\ngithub.com\n  ✓ Logged in to github.com account octo-verify (keyring)\n  - Active account: true\n  - Token: gho_************************************\n",
};
const enterpriseOnly = {
  exitCode: 0,
  stdout:
    "ghe.example.com\n  ✓ Logged in to ghe.example.com account octo-work (keyring)\n  - Active account: true\n  - Token: gho_************************************\n",
  stderr: "",
};
const refusedToken = {
  exitCode: 1,
  stdout: "",
  stderr:
    "github.com\n  X Failed to log in to github.com using token (GH_TOKEN)\n  - Active account: true\n  - The token in GH_TOKEN is invalid.\n",
};
const recorded = [
  currentFormat,
  olderFormat,
  noSignIn,
  failedSignIn,
  oneHostFailing,
  enterpriseOnly,
  refusedToken,
];

describe("parseGhAuthStatus", () => {
  it("reads the account from the current format", () => {
    expect(parseGhAuthStatus(currentFormat)).toEqual({
      state: "signed-in",
      host: null,
      account: "octo-verify",
    });
  });

  it("reads the account from the older format", () => {
    expect(parseGhAuthStatus(olderFormat)).toEqual({
      state: "signed-in",
      host: null,
      account: "octo-verify",
    });
  });

  it("reports no sign-in", () => {
    expect(parseGhAuthStatus(noSignIn)).toEqual({ state: "none" });
  });

  it("reports a failed sign-in as unconfirmed", () => {
    expect(parseGhAuthStatus(failedSignIn)).toEqual({ state: "failed" });
  });

  it("stays signed in when another host fails", () => {
    expect(parseGhAuthStatus(oneHostFailing)).toEqual({
      state: "signed-in",
      host: null,
      account: "octo-verify",
    });
  });

  it("names the host of an account outside github.com", () => {
    expect(parseGhAuthStatus(enterpriseOnly)).toEqual({
      state: "signed-in",
      host: "ghe.example.com",
      account: "octo-work",
    });
  });

  it("names the environment variable whose token gh refused", () => {
    expect(parseGhAuthStatus(refusedToken)).toEqual({
      state: "token-refused",
      variable: "GH_TOKEN",
    });
  });

  it("keeps no token text", () => {
    for (const run of recorded) {
      const kept = JSON.stringify(parseGhAuthStatus(run));
      expect(kept).not.toContain("gho_");
      expect(kept).not.toContain("Token");
    }
  });
});
