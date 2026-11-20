import { linkRefusal } from "../../shared/bridge-contract.ts";

export type LinkFollow = { ask: string } | { refuse: string };

export function linkFollow(text: string, modified: boolean): LinkFollow | null {
  if (!modified) return null;
  const href = URL.parse(text)?.href;
  return href === undefined ? { refuse: linkRefusal } : { ask: href };
}
