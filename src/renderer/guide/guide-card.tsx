import type { ReactNode } from "react";
import { Button } from "../ui/button.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { guideLegend, guideSteps, stepReadout, stepSpoken, type GuideStep } from "./guide-steps.ts";

export function GuideCard({
  step,
  titleId,
  textId,
  onNext,
  onDone,
  onClose,
}: {
  step: GuideStep;
  titleId: string;
  textId: string;
  onNext: () => void;
  onDone: () => void;
  onClose: () => void;
}): ReactNode {
  const { title, text } = guideSteps[step];
  const last = step === 4;
  return (
    <>
      <div className="flex h-6 items-center justify-between">
        <span
          aria-hidden="true"
          data-testid="guide-readout"
          className="font-pixel text-[12px] text-dim uppercase"
        >
          {stepReadout(step)}
        </span>
        <span className="sr-only">{stepSpoken(step)}</span>
        <Button
          variant="ghost"
          size="small"
          icon="close"
          label="Close the guide"
          testId="guide-close"
          onClick={onClose}
        />
      </div>
      <h2
        id={titleId}
        data-testid="guide-title"
        className="mr-1 font-display text-[20px] leading-6 font-bold tracking-[-0.04em]"
      >
        {title}
      </h2>
      <p id={textId} data-testid="guide-text" className="mr-1 text-fg2">
        {text}
      </p>
      {last && (
        <ul
          data-testid="guide-legend"
          className="mr-1 grid grid-cols-2 gap-x-3 gap-y-1 rounded-[8px] border border-line px-3 py-2 text-[12px] text-fg2"
        >
          {guideLegend.map(({ state, word }) => (
            <li key={state} className="flex items-center gap-2">
              <StatusPixel state={state} size={6} />
              {word}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 mr-1 flex justify-end">
        <Button
          variant={last ? "primary" : "secondary"}
          testId={last ? "guide-done" : "guide-next"}
          onClick={last ? onDone : onNext}
        >
          {last ? "Done" : "Next"}
        </Button>
      </div>
    </>
  );
}
