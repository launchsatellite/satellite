import { pullRequestLimits } from "../../shared/bridge-contract.ts";

export function checkedAddress(text: string | null | undefined, host?: string): URL | null {
  if (typeof text !== "string" || text.length > pullRequestLimits.urlChars) return null;
  const parsed = URL.parse(text);
  if (parsed?.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (host !== undefined && parsed.host !== host) return null;
  return parsed.href.length <= pullRequestLimits.urlChars ? parsed : null;
}
