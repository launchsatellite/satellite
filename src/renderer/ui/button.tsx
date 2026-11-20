import type { ReactNode } from "react";

export function Button({
  children,
  onClick,
  testId,
  autoFocus,
}: {
  children: ReactNode;
  onClick: () => void;
  testId?: string;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      autoFocus={autoFocus}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-pri-bg px-3 font-sans text-[13px] font-medium text-pri-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}
