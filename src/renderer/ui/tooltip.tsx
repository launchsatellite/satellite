import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { KeyHint } from "./key-hint.tsx";

const openDelayMs = 500;

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delay={openDelayMs}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  text,
  shortcut,
  children,
}: {
  text: string | undefined;
  shortcut?: string;
  children: ReactElement;
}) {
  return (
    <TooltipPrimitive.Root disabled={text === undefined}>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal data-popup="">
        <TooltipPrimitive.Positioner
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
          className="z-[60]"
        >
          <TooltipPrimitive.Popup
            data-testid="tooltip"
            className="flex max-w-[320px] items-center gap-2 rounded-[6px] border border-line bg-raised px-2 py-1 text-[12px] [overflow-wrap:anywhere] text-fg transition-opacity duration-[120ms] select-none data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            <span>{text}</span>
            {shortcut !== undefined && <KeyHint keys={shortcut} />}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
