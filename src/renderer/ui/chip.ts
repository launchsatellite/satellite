import type { PixelState } from "./status-pixel.tsx";

const tones: Record<PixelState, string> = {
  idle: "border-ctl text-fg2",
  working: "border-[color:color-mix(in_srgb,var(--working)_45%,transparent)] text-fg2",
  ready: "border-[color:color-mix(in_srgb,var(--volt-edge)_45%,transparent)] text-fg",
  done: "border-[color:color-mix(in_srgb,var(--lilac-edge)_45%,transparent)] text-fg",
  "needs-you": "border-[color:color-mix(in_srgb,var(--signal)_45%,transparent)] text-sigfg",
};

export function chipLook(state: PixelState): string {
  return `inline-flex h-[22px] items-center gap-[6px] rounded-[5px] border px-[7px] text-[11.5px] whitespace-nowrap ${tones[state]}`;
}
