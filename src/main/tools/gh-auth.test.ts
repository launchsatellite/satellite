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
  stdout:
    "github.com\n  ✓ Logged in to github.com as octo-verify (oauth_token)\n  ✓ Token: gho_************************************\n",
  stderr: "",
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

describe("parseGhAuthStatus", () => {
  it("reads the account from the current format", () => {
    expect(parseGhAuthStatus(currentFormat)).toEqual({ signedIn: true, account: "octo-verify" });
  });

  it("reads the account from the older format", () => {
    expect(parseGhAuthStatus(olderFormat)).toEqual({ signedIn: true, account: "octo-verify" });
  });

  it("reports no sign-in", () => {
    expect(parseGhAuthStatus(noSignIn)).toEqual({ signedIn: false, reason: "none" });
  });

  it("reports a failed sign-in as unconfirmed", () => {
    expect(parseGhAuthStatus(failedSignIn)).toEqual({ signedIn: false, reason: "failed" });
  });

  it("keeps no token text", () => {
    for (const run of [currentFormat, olderFormat, noSignIn, failedSignIn]) {
      const kept = JSON.stringify(parseGhAuthStatus(run));
      expect(kept).not.toContain("gho_");
      expect(kept).not.toContain("Token");
    }
  });
});
