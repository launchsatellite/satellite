import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "cn";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "./icon.tsx";
import { Tooltip } from "./tooltip.tsx";

interface TabsProps {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  testId: string;
  activateOnFocus?: boolean;
  className?: string;
  children: ReactNode;
  [data: `data-${string}`]: string | undefined;
}

interface TabClose {
  label: string;
  testId: string;
  onClose: () => void;
}

interface TabProps {
  value: string;
  id: string;
  testId: string;
  panel?: string;
  size?: "default" | "small";
  label?: string;
  tooltip?: string;
  description?: string;
  close?: TabClose;
  className?: string;
  children: ReactNode;
  [data: `data-${string}`]: string | number | undefined;
}

const Shown = createContext<{ value: string | null; focusInside: boolean }>({
  value: null,
  focusInside: false,
});

function focusSelectedIfLost(list: Element | null): void {
  requestAnimationFrame(() => {
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body && focused.isConnected) return;
    list?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")?.focus();
  });
}

export function Tabs({
  label,
  value,
  onChange,
  testId,
  activateOnFocus = false,
  className,
  children,
  ...data
}: TabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const [focusInside, setFocusInside] = useState(false);
  useEffect(() => {
    const follow = (event: FocusEvent) => {
      setFocusInside(event.target instanceof Node && list.current?.contains(event.target) === true);
    };
    document.addEventListener("focusin", follow);
    return () => {
      document.removeEventListener("focusin", follow);
    };
  }, []);
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(next: unknown) => {
        if (typeof next === "string") onChange(next);
      }}
      className="contents"
    >
      <TabsPrimitive.List
        {...data}
        aria-label={label}
        data-testid={testId}
        activateOnFocus={activateOnFocus}
        ref={list}
        onBlur={(event) => {
          setFocusInside(event.currentTarget.contains(event.relatedTarget));
        }}
        className={cn("flex items-center gap-0.5", className)}
      >
        <Shown value={{ value, focusInside }}>{children}</Shown>
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

export function Tab({
  value,
  id,
  testId,
  panel,
  size = "default",
  label,
  tooltip,
  description,
  close,
  className,
  children,
  ...data
}: TabProps) {
  const shown = useContext(Shown);
  const selected = shown.value === value;
  const stop = shown.focusInside || shown.value === null ? {} : { tabIndex: selected ? 0 : -1 };
  const closeTab = (from: Element) => {
    if (close === undefined) return;
    const list = from.closest("[role='tablist']");
    close.onClose();
    focusSelectedIfLost(list);
  };
  const press = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Delete" || close === undefined) return;
    event.preventDefault();
    closeTab(event.currentTarget);
  };
  return (
    <div
      role="presentation"
      className={cn(
        "group flex flex-none items-center rounded-[6px] text-[12px] font-medium whitespace-nowrap",
        size === "default" ? "h-7" : "h-6",
        selected ? "bg-sel text-fg" : "text-dim hover:bg-hover",
        className,
      )}
    >
      <Tooltip text={tooltip}>
        <TabsPrimitive.Tab
          {...data}
          {...stop}
          value={value}
          id={id}
          aria-controls={panel}
          aria-label={label}
          aria-description={description}
          aria-keyshortcuts={close === undefined ? undefined : "Delete"}
          data-testid={testId}
          onKeyDown={press}
          className={cn(
            "flex h-full min-w-0 items-center gap-[6px] rounded-[6px] pl-[9px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
            close === undefined ? "pr-[9px]" : "pr-1",
          )}
        >
          {children}
        </TabsPrimitive.Tab>
      </Tooltip>
      {close !== undefined && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          aria-label={close.label}
          data-testid={close.testId}
          onClick={(event) => {
            closeTab(event.currentTarget);
          }}
          className={`group/close flex size-6 flex-none items-center rounded-[4px] text-dim outline-none ${selected ? "" : "opacity-0 group-hover:opacity-100"}`}
        >
          <span className="flex size-5 items-center justify-center rounded-[4px] group-hover/close:bg-fg/20 group-hover/close:text-fg group-focus-visible/close:outline-2 group-focus-visible/close:outline-offset-2 group-focus-visible/close:outline-accent">
            <Icon name="close" size={12} />
          </span>
        </button>
      )}
    </div>
  );
}
