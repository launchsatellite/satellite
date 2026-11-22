import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { GuideCard } from "./guide-card.tsx";
import { bandOf, placeGuide, type Placement } from "./guide-placement.ts";
import { guideSteps, stepSpoken, type GuideSide, type GuideStep } from "./guide-steps.ts";

interface GuideLayerProps {
  step: GuideStep | null;
  covered: boolean;
  focusAsk: number;
  onNext: () => void;
  onDone: () => void;
  onClose: () => void;
}

const fallbackFocus =
  "[aria-label='Sidebar'] nav button, [aria-label='Sidebar'] button[aria-label='Add a project']";
const tailStyles: Record<GuideSide, (tail: number) => CSSProperties> = {
  right: (tail) => ({ left: -25, top: tail - 3 }),
  left: (tail) => ({ right: -25, top: tail - 3 }),
  below: (tail) => ({ top: -25, left: tail - 3 }),
};

function samePlacement(a: Placement | null, b: Placement | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.tail === b.tail &&
    a.card.left === b.card.left &&
    a.card.top === b.card.top &&
    a.ring.left === b.ring.left &&
    a.ring.top === b.ring.top &&
    a.ring.width === b.ring.width &&
    a.ring.height === b.ring.height
  );
}

function controlOf(step: GuideStep, held: Element | null): Element | null {
  const { anchor } = guideSteps[step];
  if (held?.isConnected === true && held.getAttribute("data-guide") === anchor) return held;
  return document.querySelector(`[data-guide="${anchor}"]`);
}

function carries(node: Node, anchor: string): boolean {
  if (!(node instanceof Element)) return false;
  const selector = `[data-guide="${anchor}"]`;
  return node.matches(selector) || node.querySelector(selector) !== null;
}

function anchorTurnedUp(records: MutationRecord[], anchor: string): boolean {
  return records.some(
    (record) =>
      (record.type === "attributes" &&
        record.target instanceof Element &&
        record.target.getAttribute("data-guide") === anchor) ||
      [...record.addedNodes].some((node) => carries(node, anchor)),
  );
}

export function GuideLayer({ step, covered, focusAsk, onNext, onDone, onClose }: GuideLayerProps) {
  const card = useRef<HTMLDivElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  const held = useRef<Placement | null>(null);
  const found = useRef<Element | null>(null);
  const watcher = useRef<ResizeObserver | null>(null);
  const placeable = useRef(false);
  const byMouse = useRef(false);
  const asked = useRef(0);
  const wantFocus = useRef(false);
  const inside = useRef(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [announced, setAnnounced] = useState<GuideStep | null>(null);
  const titleId = useId();
  const textId = useId();

  const moveFocusOut = useCallback(() => {
    const from = cameFrom.current;
    cameFrom.current = null;
    if (from?.isConnected === true) {
      from.focus({ preventScroll: true });
      return;
    }
    const control = step === null ? null : controlOf(step, found.current);
    const button = control?.querySelector<HTMLElement>("button:not([tabindex='-1'])");
    const place =
      button ??
      control?.parentElement?.closest<HTMLElement>("[tabindex]") ??
      document.querySelector<HTMLElement>(fallbackFocus);
    place?.focus({ preventScroll: true });
  }, [step]);

  const returnFocus = useCallback(() => {
    if (card.current?.contains(document.activeElement) === true) moveFocusOut();
  }, [moveFocusOut]);

  const measure = useCallback(() => {
    if (document.hidden) return;
    const element = card.current;
    const control = step === null ? null : controlOf(step, found.current);
    if (control !== found.current) {
      if (found.current !== null) watcher.current?.unobserve(found.current);
      if (control !== null) watcher.current?.observe(control);
      found.current = control;
    }
    const fits =
      step === null || element === null || control === null
        ? null
        : placeGuide(
            bandOf(control.getBoundingClientRect(), guideSteps[step].band),
            { width: element.offsetWidth, height: element.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight },
            guideSteps[step].side,
          );
    placeable.current = fits !== null;
    if (fits === null) {
      wantFocus.current = false;
      if (!covered) returnFocus();
    }
    const next = covered ? null : fits;
    if (step === null) setAnnounced(null);
    else if (next !== null) setAnnounced(step);
    if (samePlacement(held.current, next)) return;
    held.current = next;
    setPlacement(next);
  }, [step, covered, returnFocus]);

  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    if (step === null) return;
    const { anchor } = guideSteps[step];
    const resizes = new ResizeObserver(measure);
    watcher.current = resizes;
    if (found.current !== null) resizes.observe(found.current);
    const appears = new MutationObserver((records) => {
      if (anchorTurnedUp(records, anchor)) measure();
    });
    appears.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-guide"],
    });
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    document.addEventListener("visibilitychange", measure);
    return () => {
      resizes.disconnect();
      appears.disconnect();
      watcher.current = null;
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, { capture: true });
      document.removeEventListener("visibilitychange", measure);
    };
  }, [step, measure]);

  const onScreen = placement !== null;
  useEffect(() => {
    if (!onScreen) return;
    let frame = requestAnimationFrame(function loop() {
      measure();
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [onScreen, measure]);

  useLayoutEffect(() => {
    if (focusAsk > asked.current) {
      asked.current = focusAsk;
      wantFocus.current = placeable.current;
    }
    if (wantFocus.current && placement !== null) {
      wantFocus.current = false;
      byMouse.current = false;
      card.current?.focus({ preventScroll: true });
    }
  }, [focusAsk, placement]);

  useLayoutEffect(() => {
    if (step !== null || !inside.current) return;
    inside.current = false;
    const active = document.activeElement;
    if (!byMouse.current && (active === null || active === document.body)) moveFocusOut();
  }, [step, moveFocusOut]);

  const ending = (end: () => void) => () => {
    if (!byMouse.current) returnFocus();
    end();
  };
  const remember = (event: FocusEvent<HTMLDivElement>) => {
    const from = event.relatedTarget;
    inside.current = true;
    if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
      cameFrom.current = from;
    }
  };
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget;
    if (!event.currentTarget.contains(to instanceof Node ? to : null)) inside.current = false;
  };
  const escape = (event: KeyboardEvent<HTMLDivElement>) => {
    byMouse.current = false;
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    ending(onClose)();
  };

  return (
    <div data-testid="guide" className="fixed top-0 left-0 z-40">
      <p role="status" data-testid="guide-status" className="sr-only">
        {step !== null && announced === step
          ? `${stepSpoken(step)}. ${guideSteps[step].title}. ${guideSteps[step].text}`
          : ""}
      </p>
      {step !== null && (
        <>
          {placement !== null && (
            <div
              aria-hidden="true"
              data-testid="guide-ring"
              className="pointer-events-none fixed rounded-[8px] border border-fg2"
              style={placement.ring}
            />
          )}
          <div
            ref={card}
            role="group"
            tabIndex={-1}
            data-testid="guide-card"
            data-step={step}
            data-side={guideSteps[step].side}
            aria-labelledby={titleId}
            aria-describedby={textId}
            onPointerDown={() => {
              byMouse.current = true;
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onFocus={remember}
            onBlur={leave}
            onKeyDown={escape}
            className={`fixed flex w-[300px] flex-col gap-2 rounded-[10px] border border-line bg-raised pt-3 pr-3 pb-4 pl-4 text-[13px] leading-5 font-normal text-fg shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${placement === null ? "invisible" : ""}`}
            style={placement?.card ?? { left: 0, top: 0 }}
          >
            {placement !== null && (
              <span
                aria-hidden="true"
                data-testid="guide-tail"
                className={`pointer-events-none absolute flex gap-1 ${guideSteps[step].side === "below" ? "flex-col" : "flex-row"}`}
                style={tailStyles[guideSteps[step].side](placement.tail)}
              >
                <span className="size-1 bg-fg2" />
                <span className="size-1 bg-fg2" />
                <span className="size-1 bg-fg2" />
              </span>
            )}
            <GuideCard
              step={step}
              titleId={titleId}
              textId={textId}
              onNext={onNext}
              onDone={ending(onDone)}
              onClose={ending(onClose)}
            />
          </div>
        </>
      )}
    </div>
  );
}
