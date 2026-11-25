import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { KeyHint } from "./key-hint.tsx";

const openDelayMs = 500;
const movingKeys = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);
let focusMovedByKeys = false;

export function TooltipProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      focusMovedByKeys = movingKeys.has(event.key);
    };
    const point = () => {
      focusMovedByKeys = false;
    };
    window.addEventListener("keydown", press, { capture: true });
    window.addEventListener("pointerdown", point, { capture: true });
    return () => {
      window.removeEventListener("keydown", press, { capture: true });
      window.removeEventListener("pointerdown", point, { capture: true });
    };
  }, []);
  return <TooltipPrimitive.Provider delay={openDelayMs}>{children}</TooltipPrimitive.Provider>;
}

interface Tip {
  text: string;
  shortcut?: string;
}

function keepAppFocusQuiet(open: boolean, details: { reason: string; cancel: () => void }) {
  if (open && details.reason === "trigger-focus" && !focusMovedByKeys) details.cancel();
}

function TipPopup({ tip, anchor }: { tip: Tip; anchor?: Element }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        anchor={anchor}
        side="bottom"
        sideOffset={6}
        collisionPadding={8}
        className="pointer-events-none z-[60]"
      >
        <TooltipPrimitive.Popup
          data-testid="tooltip"
          className="flex max-w-[320px] items-center gap-2 rounded-[6px] border border-line bg-raised px-2 py-1 text-[12px] [overflow-wrap:anywhere] text-fg transition-opacity duration-[120ms] select-none data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
        >
          <span>{tip.text}</span>
          {tip.shortcut !== undefined && <KeyHint keys={tip.shortcut} />}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
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
  if (text === undefined) return children;
  return (
    <TooltipPrimitive.Root disableHoverablePopup onOpenChange={keepAppFocusQuiet}>
      <TooltipPrimitive.Trigger render={children} />
      <TipPopup tip={{ text, shortcut }} />
    </TooltipPrimitive.Root>
  );
}

interface Shown {
  anchor: Element;
  text: string;
}

export function useListTooltip() {
  const [shown, setShown] = useState<Shown>();
  const timer = useRef(0);
  const pending = useRef<Element | null>(null);
  const hide = () => {
    window.clearTimeout(timer.current);
    pending.current = null;
    setShown(undefined);
  };
  const anchorOf = (target: EventTarget) =>
    target instanceof Element
      ? (target.closest("[data-tip]") ?? target.querySelector(":scope > [data-tip]"))
      : null;
  const show = (target: EventTarget, wait: number) => {
    const anchor = anchorOf(target);
    const text = anchor?.getAttribute("data-tip");
    if (anchor === pending.current) return;
    window.clearTimeout(timer.current);
    pending.current = anchor;
    if (anchor === null || text === null || text === undefined) {
      setShown(undefined);
      return;
    }
    if (wait === 0) setShown({ anchor, text });
    else
      timer.current = window.setTimeout(() => {
        setShown({ anchor, text });
      }, wait);
  };
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (shown === undefined) return;
    const press = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", press, { capture: true });
    return () => {
      window.removeEventListener("keydown", press, { capture: true });
    };
  }, [shown]);
  const events = {
    onPointerOver: (event: PointerEvent) => {
      show(event.target, shown === undefined ? openDelayMs : 0);
    },
    onPointerLeave: hide,
    onPointerDown: (event: PointerEvent) => {
      hide();
      pending.current = anchorOf(event.target);
    },
    onFocus: (event: FocusEvent) => {
      if (focusMovedByKeys) show(event.target, 0);
    },
    onBlur: hide,
  };
  const tip = (
    <TooltipPrimitive.Root open={shown !== undefined} disableHoverablePopup>
      {shown !== undefined && <TipPopup tip={shown} anchor={shown.anchor} />}
    </TooltipPrimitive.Root>
  );
  return { events, tip };
}
