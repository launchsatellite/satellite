export function requestedPath(method: string, url: string): string | undefined {
  const parsed = new URL(url);
  if (method !== "GET" || parsed.host !== "satellite") return undefined;
  try {
    return decodeURIComponent(parsed.pathname === "/" ? "/index.html" : parsed.pathname);
  } catch {
    return undefined;
  }
}
