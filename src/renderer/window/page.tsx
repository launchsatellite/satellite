import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "../ui/button.tsx";
import { TopRow, type Frame } from "./top-row.tsx";

interface PageProps {
  title: string;
  lead?: string;
  testId: string;
  back: string;
  onBack: () => void;
  frame: Frame;
  edges: { left: number; right: number };
  start?: ReactNode;
  focusFirst: string;
  children: ReactNode;
}

const heldElsewhere = "[role='dialog'], [data-popup] [data-open], [data-menu-opening]";

export function usePageEscape(onBack: () => void): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  }, [onBack]);
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      if (document.activeElement?.closest(".xterm") != null) return;
      if (document.querySelector(heldElsewhere) !== null) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", press);
    return () => {
      document.removeEventListener("keydown", press);
    };
  }, []);
}

export function useReturnFocus(
  root: RefObject<HTMLElement | null>,
  first: string,
  fallback: string,
): void {
  useLayoutEffect(() => {
    const opener = document.activeElement;
    root.current?.querySelector<HTMLElement>(first)?.focus();
    return () => {
      requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        if (
          opener instanceof HTMLElement &&
          opener !== document.body &&
          opener.isConnected &&
          opener.checkVisibility()
        ) {
          opener.focus();
          return;
        }
        document.querySelector<HTMLElement>(`[data-testid="${fallback}"]`)?.focus();
      });
    };
  }, [root, first, fallback]);
}

export function Page({
  title,
  lead,
  testId,
  back,
  onBack,
  frame,
  edges,
  start,
  focusFirst,
  children,
}: PageProps) {
  const body = useRef<HTMLElement>(null);
  usePageEscape(onBack);
  useReturnFocus(body, focusFirst, "sidebar-new-workspace");
  return (
    <section
      ref={body}
      data-testid={testId}
      aria-label={title}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TopRow frame={frame} left={edges.left} right={edges.right} pad={[16, 10]} className="h-12">
        {start}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="small"
          shortcut="Esc"
          onClick={onBack}
          testId={`${testId}-back`}
        >
          {back}
        </Button>
      </TopRow>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-8 pt-8 pb-12">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-[22px] leading-7 font-bold tracking-[-0.02em]">
              {title}
            </h2>
            {lead !== undefined && <p className="text-[13px] text-fg2">{lead}</p>}
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}
