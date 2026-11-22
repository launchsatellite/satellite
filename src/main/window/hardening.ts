import { app, type Session } from "electron";

const unreachableProxy = "http://127.0.0.1:0";

function isEntryReload(target: string, entry: URL): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  return (
    url.protocol === entry.protocol && url.host === entry.host && url.pathname === entry.pathname
  );
}

export async function hardenSession(session: Session, entryUrl: string): Promise<void> {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });
  const entry = new URL(entryUrl);
  const devServer = entry.protocol === "http:" ? [entry.host] : [];
  await session.setProxy({
    mode: "fixed_servers",
    proxyRules: unreachableProxy,
    proxyBypassRules: ["<-loopback>", ...devServer].join(","),
  });
  session.on("will-download", (event) => {
    event.preventDefault();
  });
}

export function hardenWebContents(entryUrl: string): void {
  const entry = new URL(entryUrl);
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event) => {
      if (!isEntryReload(event.url, entry)) event.preventDefault();
    });
    contents.on("will-frame-navigate", (event) => {
      if (!event.isMainFrame || !isEntryReload(event.url, entry)) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    contents.on("select-bluetooth-device", (event, _devices, callback) => {
      event.preventDefault();
      callback("");
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  });
}
