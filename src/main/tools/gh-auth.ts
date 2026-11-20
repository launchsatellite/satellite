import {
  ghHost,
  ghLogin,
  ghTokenVariable,
  type GhTokenVariable,
} from "../../shared/bridge-contract.ts";
import type { ToolRun } from "../platform/tools.ts";

export type GhSignIn =
  | { state: "signed-in"; host: string | null; account: string | null }
  | { state: "none" }
  | { state: "failed" }
  | { state: "token-refused"; variable: GhTokenVariable };

const defaultHost = "github.com";
const signedInLine = /Logged in to (\S+) (?:account|as) ([A-Za-z0-9-]+)/;
const refusedToken = /The token in ([A-Z_]+) is invalid/;

function workingAccounts(output: string): { host: string; account: string }[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const [, host = "", account = ""] = signedInLine.exec(line) ?? [];
    return ghHost.test(host) && ghLogin.test(account) ? [{ host, account }] : [];
  });
}

export function parseGhAuthStatus(run: ToolRun): GhSignIn {
  const output = `${run.stdout}\n${run.stderr}`;
  const working = workingAccounts(output);
  const chosen = working.find(({ host }) => host === defaultHost) ?? working[0];
  if (chosen !== undefined) {
    return {
      state: "signed-in",
      host: chosen.host === defaultHost ? null : chosen.host,
      account: chosen.account,
    };
  }
  if (run.exitCode === 0) return { state: "signed-in", host: null, account: null };
  const variable = ghTokenVariable.safeParse(refusedToken.exec(output)?.[1]);
  if (variable.success) return { state: "token-refused", variable: variable.data };
  return output.includes("not logged into any") ? { state: "none" } : { state: "failed" };
}
