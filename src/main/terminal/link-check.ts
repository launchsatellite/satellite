const unsafeCharacter = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]/u;
const webProtocols = new Set(["http:", "https:"]);
const hostChars = 253;

export function checkedLink(raw: string): URL | null {
  if (unsafeCharacter.test(raw)) return null;
  const url = URL.parse(raw);
  if (url === null || !webProtocols.has(url.protocol) || url.hostname === "") return null;
  if (url.hostname.length > hostChars) return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.href === raw ? url : null;
}
