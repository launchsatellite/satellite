export function isAllowedSender(url: string, isMainFrame: boolean, allowedOrigin: string): boolean {
  if (!isMainFrame) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") return false;
  return `${parsed.protocol}//${parsed.host}` === allowedOrigin;
}
