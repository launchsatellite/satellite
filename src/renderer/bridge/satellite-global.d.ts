import type { SatelliteApi } from "../../shared/satellite-api.ts";

declare global {
  interface Window {
    readonly satellite: SatelliteApi;
  }
}
