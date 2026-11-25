import type { ReactNode } from "react";

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[12px] font-semibold text-fg2">
      {children}
    </label>
  );
}
