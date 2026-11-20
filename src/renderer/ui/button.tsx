import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { KeyHint } from "./key-hint.tsx";

type ButtonVariant = "primary" | "secondary" | "ghost";
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
  autoFocus?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-[7px] rounded-[6px] border font-sans font-semibold whitespace-nowrap transition-[background-color,filter] duration-[120ms] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&>kbd]:ml-1";
const variants: Record<ButtonVariant, { look: string; hover: string }> = {
  primary: {
    look: "border-transparent bg-pri-bg text-pri-fg [&>kbd]:border-current [&>kbd]:text-current [&>kbd]:opacity-55",
    hover: "hover:brightness-110 active:brightness-90",
  },
  secondary: { look: "border-ctl bg-bg text-fg", hover: "hover:bg-hover" },
  ghost: { look: "border-transparent text-fg2", hover: "hover:bg-hover" },
};
const sizes: Record<ButtonSize, { text: string; square: string }> = {
  default: { text: "h-7 px-3 text-[13px]", square: "h-7 w-7" },
  small: { text: "h-6 px-[9px] text-[12px]", square: "h-6 w-6" },
};

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
  autoFocus,
}: ButtonProps) {
  const iconOnly = label !== undefined && children === undefined;
  const { look, hover } = variants[variant];
  const state = disabled ? "opacity-[0.38]" : `${hover} active:translate-y-px`;
  return (
    <button
      type="button"
      data-testid={testId}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={iconOnly ? label : undefined}
      onClick={onClick}
      className={`${base} ${look} ${state} ${iconOnly ? sizes[size].square : sizes[size].text}`}
    >
      {icon !== undefined && <Icon name={icon} />}
      {children}
      {shortcut !== undefined && <KeyHint keys={shortcut} />}
    </button>
  );
}
