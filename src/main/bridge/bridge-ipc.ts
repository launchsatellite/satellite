import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { bridgeIpc } from "../../shared/satellite-api.ts";
import { createBridgeRouter, type BridgeHandlers, type BridgeOwner } from "./registry.ts";

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return undefined;
  }
}

function isTrustedSender(event: IpcMainInvokeEvent, allowedOrigin: string): boolean {
  const frame = event.senderFrame;
  if (frame === null || frame !== event.sender.mainFrame) return false;
  return originOf(frame.url) === allowedOrigin;
}

function createOwner(contents: WebContents): BridgeOwner {
  let goneListeners: (() => void)[] = [];
  const gone = () => {
    const listeners = goneListeners;
    goneListeners = [];
    for (const listener of listeners) listener();
  };
  contents.on("destroyed", gone);
  contents.on("render-process-gone", gone);
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) gone();
  });
  return {
    id: contents.id,
    emit(event, payload) {
      if (!contents.isDestroyed()) contents.send(bridgeIpc.event, event, payload);
    },
    onGone(listener) {
      goneListeners.push(listener);
    },
  };
}

export function registerBridge(handlers: BridgeHandlers, allowedOrigin: string): void {
  const route = createBridgeRouter(handlers);
  const owners = new WeakMap<WebContents, BridgeOwner>();
  const ownerFor = (contents: WebContents) => {
    const known = owners.get(contents);
    if (known !== undefined) return known;
    const owner = createOwner(contents);
    owners.set(contents, owner);
    return owner;
  };
  ipcMain.handle(bridgeIpc.invoke, (event, channel: unknown, payload: unknown) => {
    if (!isTrustedSender(event, allowedOrigin)) {
      return {
        ok: false,
        error: {
          code: "refused-sender",
          message: "Satellite refused a request from an unknown page.",
        },
      };
    }
    return route(channel, payload, ownerFor(event.sender));
  });
}
