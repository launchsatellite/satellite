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
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <RadioGroup<T>
      aria-label={label}
      value={value}
      onValueChange={onChange}
      className="flex h-7 items-center rounded-[6px] border border-ctl bg-side p-px"
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
            className={`h-6 rounded-[5px] px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${checked ? "bg-sel text-fg" : "text-fg2 hover:bg-hover"}`}
          >
            {option.label}
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}
