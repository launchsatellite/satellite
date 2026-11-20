import { app, type Session } from "electron";

export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });
}

export function hardenWebContents(): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    contents.on("will-frame-navigate", (event) => {
      event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
}
