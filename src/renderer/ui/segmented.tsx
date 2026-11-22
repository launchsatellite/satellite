import type { KeyboardEvent } from "react";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  testId: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}

const steps: Record<string, number | undefined> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = steps[event.key];
    const at = options.findIndex((option) => option.value === value);
    if (step === undefined || at === -1) return;
    event.preventDefault();
    const next = (at + step + options.length) % options.length;
    const option = options[next];
    if (option === undefined) return;
    onChange(option.value);
    event.currentTarget.querySelectorAll<HTMLElement>("[role='radio']")[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={move}
      className="flex h-7 items-center rounded-[6px] border border-ctl bg-side p-px"
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-testid={option.testId}
            onClick={() => {
              onChange(option.value);
            }}
            className={`h-[24px] rounded-[5px] px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${checked ? "bg-sel text-fg" : "text-fg2"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
