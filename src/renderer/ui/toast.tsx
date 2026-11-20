import { useEffect, useState } from "react";
import { Button } from "./button.tsx";

export type ToastTone = "info" | "error";
export type Notify = (message: string, tone: ToastTone) => void;

interface ToastProps {
  message: string;
  tone: ToastTone;
  onDismiss: () => void;
}

const showMs = 6000;

export function Toast({ message, tone, onDismiss }: ToastProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, showMs);
    return () => {
      clearTimeout(timer);
    };
  }, [paused, onDismiss]);
  return (
    <div
      data-testid="toast"
      role={tone === "error" ? "alert" : "status"}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      className="fixed bottom-4 left-1/2 z-40 flex max-w-[min(420px,calc(100%-32px))] -translate-x-1/2 items-center gap-[10px] rounded-[10px] border border-line bg-raised py-[10px] pr-[10px] pl-3 text-[13px] font-medium text-fg shadow-raised"
    >
      {tone === "error" && <span className="size-2 flex-none rounded-[2px] bg-signal" />}
      <span className="min-w-0">{message}</span>
      <Button
        onClick={onDismiss}
        variant="ghost"
        size="small"
        icon="close"
        label="Dismiss"
        testId="toast-dismiss"
      />
    </div>
  );
}
