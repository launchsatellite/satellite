import { cn } from "cn";
import {
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

interface DialogShellProps {
  testId: string;
  onClose: () => void;
  closable: boolean;
  returnFocusTo?: string;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  release?: Ref<() => void>;
  className: string;
  children: ReactNode;
}

interface DialogProps {
  title: string;
  description?: string;
  testId: string;
  onClose: () => void;
  closable: boolean;
  children: ReactNode;
  footer: ReactNode;
  returnFocusTo?: string;
}

const focusable =
  ":is(a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]):not([tabindex='-1'])";
const popup = "[data-popup]";

function popupOpen(panel: HTMLElement): boolean {
  return (
    panel.querySelector("[data-menu-opening]") !== null ||
    document.querySelector(`${popup} [data-open]`) !== null
  );
}

function moveFocus(panel: HTMLElement, backwards: boolean): boolean {
  const targets = [...panel.querySelectorAll<HTMLElement>(focusable)];
  const first = targets[0];
  const last = targets.at(-1);
  const active = document.activeElement;
  if (first === undefined || last === undefined) {
    panel.focus();
    return true;
  }
  if (active === null || active === panel || !panel.contains(active)) {
    (backwards ? last : first).focus();
    return true;
  }
  const edge = backwards ? first : last;
  if (active !== edge) return false;
  (backwards ? last : first).focus();
  return true;
}

export function DialogShell({
  testId,
  onClose,
  closable,
  returnFocusTo,
  label,
  labelledBy,
  describedBy,
  release,
  className,
  children,
}: DialogShellProps) {
  const panel = useRef<HTMLDivElement>(null);
  const pressedOverPopup = useRef(false);
  const uncover = useRef<(() => void) | null>(null);
  const coveredOnce = useRef(false);
  const [focusedAtRender] = useState(() => document.activeElement);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const releaseNow = useCallback(() => {
    const undo = uncover.current;
    uncover.current = null;
    undo?.();
    rerender();
  }, []);
  useImperativeHandle(release, () => releaseNow, [releaseNow]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null) return;
    const covered = () => uncover.current === null || element.closest("[inert]") !== null;
    const press = (event: KeyboardEvent) => {
      if (event.isComposing || covered()) return;
      if (popupOpen(element)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (closable) onClose();
      } else if (event.key === "Tab" && moveFocus(element, event.shiftKey)) {
        event.preventDefault();
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (covered()) return;
      if (
        event.target instanceof Element &&
        event.target.closest(`[role='dialog'], ${popup}`) !== null
      ) {
        return;
      }
      if (event.target instanceof Node && !element.contains(event.target)) element.focus();
    };
    const point = () => {
      pressedOverPopup.current = popupOpen(element);
    };
    document.addEventListener("keydown", press, { capture: true });
    document.addEventListener("focusin", keepFocus);
    window.addEventListener("pointerdown", point, { capture: true });
    return () => {
      document.removeEventListener("keydown", press, { capture: true });
      document.removeEventListener("focusin", keepFocus);
      window.removeEventListener("pointerdown", point, { capture: true });
    };
  }, [closable, onClose]);
  useLayoutEffect(() => {
    const element = panel.current;
    const overlay = element?.parentElement;
    if (uncover.current !== null || element === null || overlay === null || overlay === undefined) {
      return;
    }
    const focused = document.activeElement;
    const priorFocus =
      !coveredOnce.current &&
      focusedAtRender instanceof HTMLElement &&
      focusedAtRender !== document.body &&
      focusedAtRender.isConnected
        ? focusedAtRender
        : focused;
    coveredOnce.current = true;
    const opener = priorFocus === document.body || element.contains(priorFocus) ? null : priorFocus;
    const behind = [...(overlay.parentElement?.children ?? [])].filter(
      (sibling) =>
        sibling !== overlay &&
        !sibling.hasAttribute("inert") &&
        !sibling.hasAttribute("data-stays-live"),
    );
    for (const sibling of behind) sibling.setAttribute("inert", "");
    if (!element.contains(focused)) element.focus();
    uncover.current = () => {
      for (const sibling of behind) sibling.removeAttribute("inert");
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
        return;
      }
      if (returnFocusTo !== undefined) {
        document.querySelector<HTMLElement>(`[data-testid="${returnFocusTo}"]`)?.focus();
      }
    };
  });
  useLayoutEffect(() => releaseNow, [releaseNow]);

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-bg/60"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          if (closable && !pressedOverPopup.current) onClose();
        }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        data-testid={testId}
        tabIndex={-1}
        className={cn(
          "absolute top-[12vh] left-1/2 -translate-x-1/2 overflow-hidden rounded-[12px] border border-line bg-raised shadow-raised outline-none",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function Dialog({
  title,
  description,
  testId,
  onClose,
  closable,
  children,
  footer,
  returnFocusTo,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <DialogShell
      testId={testId}
      onClose={onClose}
      closable={closable}
      returnFocusTo={returnFocusTo}
      labelledBy={titleId}
      describedBy={description === undefined ? undefined : descriptionId}
      className="flex max-h-[calc(100%-24vh)] w-[min(480px,calc(100%-32px))] flex-col"
    >
      <div className="px-[18px] pt-4 pb-[6px]">
        <h2 id={titleId} className="text-[17px] font-semibold break-words">
          {title}
        </h2>
      </div>
      {description !== undefined && (
        <p id={descriptionId} className="px-[18px] text-[13px] break-words text-dim">
          {description}
        </p>
      )}
      <div className="mr-1 flex min-h-0 flex-col gap-[14px] overflow-y-auto py-4 pr-1 pl-[18px] [scrollbar-gutter:stable]">
        {children}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line bg-side px-[18px] py-3">
        {footer}
      </div>
    </DialogShell>
  );
}
