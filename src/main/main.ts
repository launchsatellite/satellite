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
import { installAppMenu } from "./window/app-menu.ts";
import { hardenSession, hardenWebContents } from "./window/hardening.ts";
import { createMainWindow } from "./window/main-window.ts";

function noTerminal(): Promise<never> {
  return Promise.reject(new BridgeFailure("not-found", "Terminals are not available yet."));
}

function allowedOrigin(entryUrl: string): string {
  return entryUrl.startsWith(`${appOrigin}/`) ? appOrigin : new URL(entryUrl).origin;
}

async function start(): Promise<void> {
  await app.whenReady();
  const entryUrl = rendererEntryUrl();
  installAppMenu();
  hardenSession(session.defaultSession);
  hardenWebContents(entryUrl);
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
  await createMainWindow(entryUrl);
}

app.setPath("userData", join(prepareSatelliteHome(), "app-data"));
registerAppScheme();

start().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Satellite could not open its window and is quitting. ${reason}`);
  app.exit(1);
});

app.on("window-all-closed", () => {
  app.quit();
});
