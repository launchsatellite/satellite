import { useCallback, useState } from "react";
import type { Notify } from "../ui/toast.tsx";
import {
  guideClosedSentence,
  settledStep,
  stepAfter,
  type GuideFacts,
  type GuideStep,
} from "./guide-steps.ts";

export interface Guide {
  step: GuideStep | null;
  focusAsk: number;
  next: () => void;
  done: () => void;
  close: () => void;
  show: () => void;
}

export function useGuide({
  seen,
  listed,
  facts,
  onSeen,
  notify,
}: {
  seen: boolean;
  listed: boolean;
  facts: GuideFacts;
  onSeen: () => void;
  notify: Notify;
}): Guide {
  const [again, setAgain] = useState(false);
  const [at, setAt] = useState<GuideStep | null>(null);
  const [focusAsk, setFocusAsk] = useState(0);
  const open = listed && (!seen || again);
  const step = open ? settledStep(at ?? 1, facts) : null;
  if (at !== step) setAt(step);
  const next = () => {
    if (step === 1 || step === 2 || step === 3) setAt(stepAfter(step, facts));
  };
  const done = () => {
    setAgain(false);
    if (!seen) onSeen();
  };
  const close = () => {
    done();
    notify(guideClosedSentence, "info");
  };
  const show = useCallback(() => {
    setAgain(true);
    setFocusAsk((count) => count + 1);
  }, []);
  return { step, focusAsk, next, done, close, show };
}
