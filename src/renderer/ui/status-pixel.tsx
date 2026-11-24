export type PixelState = "idle" | "working" | "ready" | "done" | "needs-you";

interface StatusPixelProps {
  state: PixelState;
  size?: 6 | 8;
  testId?: string;
  label?: string;
}

const looks: Record<PixelState, string> = {
  idle: "bg-idle",
  working: "bg-working",
  ready: "bg-volt shadow-[inset_0_0_0_1.5px_var(--volt-edge)]",
  done: "bg-lilac shadow-[inset_0_0_0_1.5px_var(--lilac-edge)]",
  "needs-you": "bg-signal shadow-[inset_0_0_0_1.5px_var(--sigfg)]",
};

export function StatusPixel({ state, size = 8, testId, label }: StatusPixelProps) {
  return (
    <span
      data-testid={testId}
      data-state={state}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={`flex-none rounded-[2px] ${size === 6 ? "size-[6px]" : "size-2"} ${looks[state]}`}
    />
  );
}
