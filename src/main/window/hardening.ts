import { app, type Session } from "electron";

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

export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
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
  });
}
