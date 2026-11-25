import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";
import type { ComponentProps } from "react";

export const fieldLook =
  "h-8 rounded-[8px] border border-ctl bg-side px-3 text-[13px] text-fg outline-none disabled:opacity-[0.38]";

export function Input({
  testId,
  className,
  ...props
}: Omit<ComponentProps<typeof InputPrimitive>, "className"> & {
  testId: string;
  className?: string;
}) {
  return (
    <InputPrimitive
      data-testid={testId}
      className={cn(
        fieldLook,
        "focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}
