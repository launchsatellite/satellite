export type LinkFollow = { ask: string } | { refuse: string };

const notAnAddress = "Satellite opens only web addresses that start with http or https.";

export function linkFollow(text: string, modified: boolean): LinkFollow | null {
  if (!modified) return null;
  const href = URL.parse(text)?.href;
  return href === undefined ? { refuse: notAnAddress } : { ask: href };
}
