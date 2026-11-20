import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import type { BridgeResult } from "../../shared/bridge-contract.ts";
import { bridgeIpc } from "../../shared/satellite-api.ts";
import { createPageOwners, type PageOwners } from "./page-owners.ts";
import { createBridgeRouter, type BridgeHandlers } from "./registry.ts";
import { isAllowedSender } from "./sender-check.ts";

const refusedSender: BridgeResult<never> = {
  ok: false,
  error: { code: "refused-sender", message: "Satellite refused a request from an unknown page." },
};

function isTrustedSender(event: IpcMainInvokeEvent, allowedOrigin: string): boolean {
  try {
    const frame = event.senderFrame;
    if (frame === null) return false;
    return isAllowedSender(frame.url, frame === event.sender.mainFrame, allowedOrigin);
  } catch {
    return false;
  }
}

function watchPage(contents: WebContents, pages: PageOwners<WebContents>): void {
  const end = () => {
    pages.end(contents);
  };
  contents.on("destroyed", end);
  contents.on("render-process-gone", end);
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) end();
  });
}

export function registerBridge(handlers: BridgeHandlers, allowedOrigin: string): void {
  const route = createBridgeRouter(handlers);
  const pages = createPageOwners<WebContents>((contents, event, payload) => {
    if (!contents.isDestroyed()) contents.send(bridgeIpc.event, event, payload);
  });
  const watched = new WeakSet<WebContents>();
  ipcMain.handle(bridgeIpc.invoke, (event, channel: unknown, payload: unknown) => {
    if (!isTrustedSender(event, allowedOrigin)) return refusedSender;
    if (!watched.has(event.sender)) {
      watched.add(event.sender);
      watchPage(event.sender, pages);
    }
    return route(channel, payload, pages.ownerFor(event.sender));
  });
}
