import type { WindowFrame } from "../../shared/bridge-contract.ts";
import type { BridgeHandlers, BridgeOwner } from "../bridge/registry.ts";

const watching = new Set<BridgeOwner>();
let current: WindowFrame = { frame: "native", fullScreen: false };

export function setWindowFrame(next: WindowFrame): void {
  if (next.frame === current.frame && next.fullScreen === current.fullScreen) return;
  current = next;
  for (const owner of watching) owner.emit("window.frame", next);
}

export const windowFrameHandlers: Pick<BridgeHandlers, "window.frame"> = {
  "window.frame": (_request, owner) => {
    if (!watching.has(owner)) {
      watching.add(owner);
      owner.onGone(() => {
        watching.delete(owner);
      });
    }
    return Promise.resolve(current);
  },
};
