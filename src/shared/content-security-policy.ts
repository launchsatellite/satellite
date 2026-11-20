export function contentSecurityPolicy(mode: "production" | "development"): string {
  const development = mode === "development";
  return [
    "default-src 'none'",
    development ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    development ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}
