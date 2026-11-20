import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { app, net, protocol } from "electron";
import { contentSecurityPolicy } from "../../shared/content-security-policy.ts";
import { resolveInside } from "../platform/paths.ts";
import { requestedPath } from "./app-request.ts";

export const appOrigin = "app://satellite";

function withSecurityHeaders(headers: Headers): Headers {
  headers.set("Content-Security-Policy", contentSecurityPolicy("production"));
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: withSecurityHeaders(new Headers()) });
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function serve(request: Request, rendererRoot: string): Promise<Response> {
  const requested = requestedPath(request.method, request.url);
  if (requested === undefined) return notFound();
  const file = await resolveInside(rendererRoot, requested);
  if (file === undefined || !(await isRegularFile(file))) return notFound();
  const response = await net.fetch(pathToFileURL(file).toString());
  const headers = withSecurityHeaders(new Headers(response.headers));
  return new Response(response.body, { status: response.status, headers });
}

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

export function handleAppProtocol(rendererRoot: string): void {
  protocol.handle("app", (request) => serve(request, rendererRoot));
}

export function rendererEntryUrl(): string {
  const developmentUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && developmentUrl !== undefined) return developmentUrl;
  return `${appOrigin}/index.html`;
}
