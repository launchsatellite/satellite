import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "cn";
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Icon } from "./icon.tsx";
import { fieldLook } from "./input.tsx";

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  testId: string;
  id?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  testId,
  id,
  label,
  disabled = false,
  className,
}: SelectProps<T>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const open = useRef(false);
  const cancelled = useRef(false);
  const [shown, setShown] = useState(false);
  const opening = (on: boolean) => {
    trigger.current?.toggleAttribute("data-menu-opening", on);
  };
  const show = (next: boolean) => {
    open.current = next;
    opening(next);
    setShown(next);
  };
  const press = (event: MouseEvent) => {
    if (event.button !== 0 || disabled || open.current) return;
    cancelled.current = false;
    opening(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!open.current) opening(false);
      });
    });
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (open.current) {
      show(false);
      return;
    }
    if (trigger.current?.hasAttribute("data-menu-opening") !== true) return;
    cancelled.current = true;
    opening(false);
  };
  return (
    <SelectPrimitive.Root
      value={value}
      items={options}
      disabled={disabled}
      open={shown}
      onValueChange={(chosen) => {
        if (chosen !== null) onChange(chosen);
      }}
      onOpenChange={(next, details) => {
        if (next && cancelled.current) {
          cancelled.current = false;
          details.cancel();
          return;
        }
        show(next);
      }}
    >
      <SelectPrimitive.Trigger
        ref={trigger}
        onMouseDown={press}
        onKeyDown={key}
        id={id}
        aria-label={label}
        data-testid={testId}
        className={cn(
          fieldLook,
          "flex min-w-0 items-center justify-between gap-2 text-left focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] data-popup-open:border-accent",
          className,
        )}
      >
        <SelectPrimitive.Value className="min-w-0 truncate" />
        <SelectPrimitive.Icon className="flex flex-none text-dim">
          <Icon name="chevron-down" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal data-popup="">
        <SelectPrimitive.Positioner
          alignItemWithTrigger={false}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[60] outline-none"
        >
          <SelectPrimitive.Popup
            data-testid={`${testId}-options`}
            className="max-h-(--available-height) max-w-(--available-width) min-w-(--anchor-width) overflow-y-auto rounded-[10px] border border-line bg-raised p-1 shadow-raised outline-none"
          >
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="flex h-7 items-center gap-2 rounded-[6px] px-2 text-[13px] whitespace-nowrap text-fg outline-none select-none data-highlighted:bg-accent data-highlighted:text-on-accent"
                >
                  <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="flex flex-none">
                    <Icon name="check" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
