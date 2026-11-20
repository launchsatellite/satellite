import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import { bridgeIpc, type SatelliteApi } from "../shared/satellite-api.ts";

const api: SatelliteApi = {
  invoke(channel, payload) {
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
