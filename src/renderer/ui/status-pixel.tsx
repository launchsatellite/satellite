export type PixelState = "idle" | "working" | "ready" | "done" | "needs-you";

const looks: Record<PixelState, string> = {
  idle: "bg-dim",
  working: "bg-accent",
  ready: "bg-volt shadow-[inset_0_0_0_1.5px_var(--volt-edge)]",
  done: "bg-lilac shadow-[inset_0_0_0_1.5px_var(--lilac-edge)]",
  "needs-you": "bg-signal",
};

export function StatusPixel({ state, size = 8 }: { state: PixelState; size?: 6 | 8 }) {
  return (
    <span
      aria-hidden
      className={`flex-none rounded-[2px] ${size === 6 ? "size-[6px]" : "size-2"} ${looks[state]}`}
    />
  );
}
