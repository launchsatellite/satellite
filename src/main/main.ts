import { join } from "node:path";
import { app, session } from "electron";
import { prepareSatelliteHome } from "./platform/satellite-home.ts";
import { handleAppProtocol, registerAppScheme, rendererEntryUrl } from "./window/app-protocol.ts";
import { hardenSession, hardenWebContents } from "./window/hardening.ts";
import { createMainWindow } from "./window/main-window.ts";

app.setPath("userData", join(prepareSatelliteHome(), "app-data"));
registerAppScheme();

void app.whenReady().then(() => {
  hardenSession(session.defaultSession);
  hardenWebContents();
  handleAppProtocol(join(app.getAppPath(), "out/renderer"));
  createMainWindow(rendererEntryUrl());
});

app.on("window-all-closed", () => {
  app.quit();
});
