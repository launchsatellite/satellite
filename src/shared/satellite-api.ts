export interface SatelliteApi {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  onEvent(listener: (event: string, payload: unknown) => void): () => void;
  pathForFile(file: unknown): string;
}

export const bridgeRequestChars = 8_388_608;
export const oversizeRefusal = "Satellite refused a request far larger than any it takes.";

export const bridgeIpc = { invoke: "satellite:bridge", event: "satellite:event" };
