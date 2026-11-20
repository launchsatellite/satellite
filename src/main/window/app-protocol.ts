import { pathToFileURL } from "node:url";
import { app, net, protocol } from "electron";
import { contentSecurityPolicy } from "../../shared/content-security-policy.ts";
import { resolveInside } from "../platform/paths.ts";

export const appOrigin = "app://satellite";

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

async function serve(request: Request, rendererRoot: string): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.host !== "satellite") return notFound();
  let requested: string;
  try {
    requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    return notFound();
  }
  const file = await resolveInside(rendererRoot, requested);
  if (file === undefined) return notFound();
  const response = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy("production"));
  headers.set("X-Content-Type-Options", "nosniff");
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
