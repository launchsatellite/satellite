export interface SatelliteApi {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  onEvent(listener: (event: string, payload: unknown) => void): () => void;
}

export const bridgeIpc = { invoke: "satellite:bridge", event: "satellite:event" };
