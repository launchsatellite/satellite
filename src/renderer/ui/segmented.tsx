import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

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
  wide?: boolean;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  wide = false,
}: SegmentedProps<T>) {
  return (
    <RadioGroup<T>
      aria-label={label}
      value={value}
      onValueChange={onChange}
      className={`h-7 items-center gap-[2px] rounded-[7px] bg-hover p-[2px] ${wide ? "flex" : "inline-flex"}`}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <Radio.Root
            key={option.value}
            value={option.value}
            nativeButton
            render={<button type="button" />}
            data-testid={option.testId}
            className={`h-6 rounded-[5px] px-[10px] text-[12px] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${wide ? "flex-1" : ""} ${checked ? "bg-bg text-fg shadow-[0_0_0_1px_var(--ctl)]" : "text-dim hover:text-fg2"}`}
          >
            {option.label}
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}
