import type { ToolRun } from "../platform/tools.ts";

export type GhSignIn =
  { signedIn: true; account: string | null } | { signedIn: false; reason: "none" | "failed" };

const signedInLine = /Logged in to \S+ (?:account|as) ([A-Za-z0-9-]{1,39})\b/;

export function parseGhAuthStatus(run: ToolRun): GhSignIn {
  const output = `${run.stdout}\n${run.stderr}`;
  if (run.exitCode === 0) {
    return { signedIn: true, account: signedInLine.exec(output)?.[1] ?? null };
  }
  return { signedIn: false, reason: output.includes("not logged into any") ? "none" : "failed" };
}
