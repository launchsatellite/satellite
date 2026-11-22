import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import {
  bridgeIpc,
  bridgeRequestChars,
  oversizeRefusal,
  type SatelliteApi,
} from "../shared/satellite-api.ts";

function isPlain(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return Array.isArray(value)
    ? prototype === Array.prototype
    : prototype === Object.prototype || prototype === null;
}

function plainOnly(this: object, key: string, value: unknown): unknown {
  const raw: unknown = Reflect.get(this, key);
  if (typeof raw === "object" && raw !== null && !isPlain(raw)) throw new TypeError(key);
  return value;
}

function fits(payload: unknown): boolean {
  try {
    return JSON.stringify({ payload }, plainOnly).length <= bridgeRequestChars;
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
