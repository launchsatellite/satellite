import type { SessionStatus } from "../../shared/bridge-contract.ts";
import type { PixelState } from "../ui/status-pixel.tsx";

const urgency: readonly PixelState[] = ["needs-you", "working", "done"];

export function pixelOf(status: SessionStatus): PixelState {
  return status === "stopped" ? "idle" : status;
}

export function mostUrgent(statuses: readonly SessionStatus[]): PixelState {
  const shown = new Set(statuses.map(pixelOf));
  return urgency.find((state) => shown.has(state)) ?? "idle";
}
