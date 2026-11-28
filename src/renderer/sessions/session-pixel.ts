import type { SessionStatus } from "../../shared/bridge-contract.ts";
import type { PixelState } from "../ui/status-pixel.tsx";

const urgency: readonly PixelState[] = ["needs-you", "working", "done"];
const labels: Partial<Record<PixelState, string>> = {
  working: "Working",
  "needs-you": "Needs you",
  done: "Done",
};

export function pixelLabel(state: PixelState): string | undefined {
  return labels[state];
}

export function pixelOf(status: SessionStatus): PixelState {
  return status === "stopped" ? "idle" : status;
}

export function mostUrgentPixel(pixels: readonly PixelState[]): PixelState {
  return urgency.find((state) => pixels.includes(state)) ?? "idle";
}

export function mostUrgent(statuses: readonly SessionStatus[]): PixelState {
  return mostUrgentPixel(statuses.map(pixelOf));
}
