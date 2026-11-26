import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { KeyHint } from "./key-hint.tsx";
import { Tooltip } from "./tooltip.tsx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
type ButtonSize = "default" | "small";

export interface ButtonProps {
  children?: ReactNode;
  onClick: () => void;
  testId?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  label?: string;
  tooltip?: string;
  autoFocus?: boolean;
  expanded?: boolean;
  controls?: string;
  className?: string;
  [data: `data-${string}`]: string | number | undefined;
}

const linkLook =
  "inline rounded-[2px] text-left font-[inherit] text-fg underline decoration-dim underline-offset-2 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-[6px] border font-sans font-semibold whitespace-nowrap transition-[background-color,filter] duration-[120ms] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&>kbd]:ml-1",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-pri-bg text-pri-fg [&>kbd]:border-current [&>kbd]:text-current [&>kbd]:opacity-55",
        secondary: "border-ctl bg-bg text-fg",
        ghost: "border-transparent text-fg2",
        danger: "border-ctl bg-bg text-danger",
      },
      size: {
        default: "h-7 gap-2 px-3 text-[13px]",
        small: "h-6 gap-1.5 px-2 text-[12px]",
      },
      square: { true: "px-0", false: "" },
      disabled: { true: "opacity-[0.38]", false: "active:translate-y-px" },
    },
    compoundVariants: [
      { square: true, size: "default", className: "w-7" },
      { square: true, size: "small", className: "w-6" },
      {
        disabled: false,
        variant: "primary",
        className: "hover:brightness-110 active:brightness-90",
      },
      { disabled: false, variant: ["secondary", "ghost", "danger"], className: "hover:bg-hover" },
    ],
  },
);

export function Button({
  children,
  onClick,
  testId,
  variant = "primary",
  size = "default",
  icon,
  shortcut,
  disabled = false,
  label,
  tooltip,
  autoFocus,
  expanded,
  controls,
  className,
  ...data
}: ButtonProps) {
  const square = label !== undefined && children === undefined;
  const tip = tooltip !== undefined && shortcut !== undefined ? `${tooltip} ${shortcut}` : tooltip;
  const button = (
    <ButtonPrimitive
      {...data}
      type="button"
      data-testid={testId}
      autoFocus={autoFocus}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      aria-description={tip === label ? undefined : tip}
      disabled={disabled}
      focusableWhenDisabled
      onClick={onClick}
      className={cn(
        variant === "link" ? linkLook : buttonVariants({ variant, size, square, disabled }),
        className,
      )}
    >
      {icon !== undefined && <Icon name={icon} />}
      {children}
      {shortcut !== undefined && !square && tooltip === undefined && <KeyHint keys={shortcut} />}
    </ButtonPrimitive>
  );
  if (tooltip === undefined) return button;
  return (
    <Tooltip text={tooltip} shortcut={shortcut}>
      {button}
    </Tooltip>
  );
}
