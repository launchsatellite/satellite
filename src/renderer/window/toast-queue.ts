import type { ToastTone } from "../ui/toast.tsx";

export interface QueuedToast {
  id: number;
  message: string;
  tone: ToastTone;
  queuedAt: number;
}

const queueLimit = 32;
const longestWaitMs = 10_000;

export function withToast(
  queue: readonly QueuedToast[],
  message: string,
  tone: ToastTone,
  now: number,
): QueuedToast[] {
  const shown = {
    id: Math.max(0, ...queue.map((queued) => queued.id)) + 1,
    message,
    tone,
    queuedAt: now,
  };
  if (tone === "error") {
    const replaced = queue[0]?.tone === "error" ? queue[0] : undefined;
    if (replaced === undefined) return [shown, ...queue].slice(0, queueLimit);
    return [{ ...shown, id: replaced.id }, ...queue.slice(1)];
  }
  const [head, , ...rest] = queue;
  return queue.length < queueLimit || head === undefined
    ? [...queue, shown]
    : [head, ...rest, shown];
}

export function afterDismiss(queue: readonly QueuedToast[], now: number): QueuedToast[] {
  return queue.slice(1).filter((queued) => now - queued.queuedAt <= longestWaitMs);
}
