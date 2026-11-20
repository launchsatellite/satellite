import { join } from "node:path";
import { app, session } from "electron";
import { registerBridge } from "./bridge/bridge-ipc.ts";
import { BridgeFailure } from "./bridge/registry.ts";
import { prepareSatelliteHome } from "./platform/satellite-home.ts";
import { toolVersions } from "./tools/tool-versions.ts";
import {
  appOrigin,
  handleAppProtocol,
  registerAppScheme,
  rendererEntryUrl,
} from "./window/app-protocol.ts";
import { hardenSession, hardenWebContents } from "./window/hardening.ts";
import { createMainWindow } from "./window/main-window.ts";

function noTerminal(): Promise<never> {
  return Promise.reject(new BridgeFailure("not-found", "Terminals are not available yet."));
}

function allowedOrigin(entryUrl: string): string {
  return entryUrl.startsWith(`${appOrigin}/`) ? appOrigin : new URL(entryUrl).origin;
}

app.setPath("userData", join(prepareSatelliteHome(), "app-data"));
registerAppScheme();

void app.whenReady().then(() => {
  const entryUrl = rendererEntryUrl();
  hardenSession(session.defaultSession);
  hardenWebContents();
  handleAppProtocol(join(app.getAppPath(), "out/renderer"));
  registerBridge(
    {
      "tools.versions": toolVersions,
      "terminal.start": noTerminal,
      "terminal.write": noTerminal,
      "terminal.resize": noTerminal,
      "terminal.close": noTerminal,
    },
    allowedOrigin(entryUrl),
  );
  createMainWindow(entryUrl);
});

app.on("window-all-closed", () => {
  app.quit();
});
