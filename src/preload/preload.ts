import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import {
  bridgeIpc,
  bridgeRequestChars,
  oversizeRefusal,
  type SatelliteApi,
} from "../shared/satellite-api.ts";

function fits(payload: unknown): boolean {
  try {
    return JSON.stringify(payload === undefined ? null : payload).length <= bridgeRequestChars;
  } catch {
    return false;
  }
}

const api: SatelliteApi = {
  invoke(channel, payload) {
    if (!fits(payload)) {
      return Promise.resolve({
        ok: false,
        error: { code: "invalid-request", message: oversizeRefusal },
      });
    }
    return ipcRenderer.invoke(bridgeIpc.invoke, channel, payload);
  },
  onEvent(listener) {
    const forward = (_event: IpcRendererEvent, name: unknown, payload: unknown) => {
      if (typeof name === "string") listener(name, payload);
    };
    ipcRenderer.on(bridgeIpc.event, forward);
    return () => {
      ipcRenderer.removeListener(bridgeIpc.event, forward);
    };
  },
  pathForFile(file) {
    if (!(file instanceof File)) return "";
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
};

contextBridge.exposeInMainWorld("satellite", api);
